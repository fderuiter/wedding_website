import React from 'react';
import { render, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  useStickyOffset,
  StickyBar,
  type UseStickyOffsetOptions,
  type StickyBarProps,
} from '../useStickyOffset';

describe('useStickyOffset and StickyBar', () => {
  let resizeCallbacks: ResizeObserverCallback[] = [];
  const originalResizeObserver = global.ResizeObserver;

  beforeEach(() => {
    resizeCallbacks = [];
    document.documentElement.removeAttribute('style');
    global.ResizeObserver = jest.fn().mockImplementation((cb: ResizeObserverCallback) => {
      resizeCallbacks.push(cb);
      return {
        observe: jest.fn(),
        unobserve: jest.fn(),
        disconnect: jest.fn(),
      };
    });
  });

  afterEach(() => {
    document.documentElement.removeAttribute('style');
    global.ResizeObserver = originalResizeObserver;
  });

  function mockElementRect(el: HTMLElement, height: number) {
    Object.defineProperty(el, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 300,
        bottom: height,
        width: 300,
        height,
        toJSON: () => ({}),
      }),
    });
  }

  test('syncs measured top bar height into document CSS variable and cleans up on unmount', () => {
    const measured: number[] = [];

    function HeaderProbe(props: UseStickyOffsetOptions<HTMLElement>) {
      const ref = useStickyOffset<HTMLElement>({
        ...props,
        onMeasure: (h) => measured.push(h),
      });
      return <header ref={ref} data-testid="sticky-header">Header</header>;
    }

    const { getByTestId, unmount } = render(
      <HeaderProbe edge="top" scope="document" cssVar="--header-h" combineMode="max" />
    );

    const headerEl = getByTestId('sticky-header');
    mockElementRect(headerEl, 81);

    act(() => {
      resizeCallbacks.forEach((cb) => cb([], {} as ResizeObserver));
    });

    expect(document.documentElement.style.getPropertyValue('--header-h')).toBe('81px');
    expect(measured[measured.length - 1]).toBe(81);

    mockElementRect(headerEl, 225);
    act(() => {
      resizeCallbacks.forEach((cb) => cb([], {} as ResizeObserver));
    });

    expect(document.documentElement.style.getPropertyValue('--header-h')).toBe('225px');
    expect(measured[measured.length - 1]).toBe(225);

    unmount();
    expect(document.documentElement.style.getPropertyValue('--header-h')).toBe('');
  });

  test('binds StickyBar to nearest [data-scroll-region] ancestor and forwards ref + className', () => {
    const forwardedRef = React.createRef<HTMLElement>();
    const barProps: StickyBarProps = {
      edge: 'bottom',
      scope: 'scroll-region',
      className: 'sticky bottom-0 py-4',
    };

    const { getByTestId, unmount } = render(
      <div id="studio-left-pane" data-testid="scroll-pane" data-scroll-region="">
        <StickyBar ref={forwardedRef} data-testid="sticky-footer" {...barProps}>
          Save Settings
        </StickyBar>
      </div>
    );

    const pane = getByTestId('scroll-pane');
    const footer = getByTestId('sticky-footer');
    expect(forwardedRef.current).toBe(footer);
    expect(footer).toHaveClass('sticky', 'bottom-0', 'py-4');

    mockElementRect(footer, 72);
    act(() => {
      resizeCallbacks.forEach((cb) => cb([], {} as ResizeObserver));
    });

    expect(pane.style.getPropertyValue('--local-sticky-bottom')).toBe('72px');
    expect(document.documentElement.style.getPropertyValue('--local-sticky-bottom')).toBe('');

    unmount();
    expect(pane.style.getPropertyValue('--local-sticky-bottom')).toBe('');
  });

  test('includes fixed bottom inset and preserves max clearance across multiple bottom toolbars', () => {
    const { getByTestId, rerender } = render(
      <>
        <StickyBar
          as="aside"
          edge="bottom"
          scope="document"
          data-testid="demo-bar"
          style={{ position: 'fixed', bottom: '0px' }}
        >
          Demo Controls
        </StickyBar>
        <StickyBar
          edge="bottom"
          scope="document"
          data-testid="batch-bar"
          style={{ position: 'fixed', bottom: '24px' }}
        >
          Batch Actions
        </StickyBar>
      </>
    );

    const demoBar = getByTestId('demo-bar');
    const batchBar = getByTestId('batch-bar');
    mockElementRect(demoBar, 52);
    mockElementRect(batchBar, 68);

    act(() => {
      resizeCallbacks.forEach((cb) => cb([], {} as ResizeObserver));
    });

    // Batch bar is 68px + 24px fixed bottom offset = 92px (> 52px demo bar)
    expect(document.documentElement.style.getPropertyValue('--sticky-bottom-extra')).toBe('92px');

    // Unmounting batch bar retains demo bar's 52px clearance instead of wiping token
    rerender(
      <StickyBar
        as="aside"
        edge="bottom"
        scope="document"
        data-testid="demo-bar"
        style={{ position: 'fixed', bottom: '0px' }}
      >
        Demo Controls
      </StickyBar>
    );

    expect(document.documentElement.style.getPropertyValue('--sticky-bottom-extra')).toBe('52px');
  });

  test('disables sticky offset CSS variable when viewport height is at or below disableAtMaxHeight', () => {
    const originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 500,
    });

    try {
      const { getByTestId } = render(
        <StickyBar
          as="nav"
          edge="top"
          scope="document"
          disableAtMaxHeight={560}
          data-testid="registry-filters-bar"
        >
          Filters
        </StickyBar>
      );

      const navBar = getByTestId('registry-filters-bar');
      mockElementRect(navBar, 64);

      act(() => {
        resizeCallbacks.forEach((cb) => cb([], {} as ResizeObserver));
      });

      // At 500px tall (<= 560px), --sticky-top-extra is suppressed so sticky chrome stays minimal
      expect(document.documentElement.style.getPropertyValue('--sticky-top-extra')).toBe('');

      // Resize viewport taller than 560px -> restores --sticky-top-extra measurement
      window.innerHeight = 800;
      act(() => {
        window.dispatchEvent(new Event('resize'));
      });
      expect(document.documentElement.style.getPropertyValue('--sticky-top-extra')).toBe('64px');

      // Resize back down to 256px -> clears --sticky-top-extra immediately
      window.innerHeight = 256;
      act(() => {
        window.dispatchEvent(new Event('resize'));
      });
      expect(document.documentElement.style.getPropertyValue('--sticky-top-extra')).toBe('');
    } finally {
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        writable: true,
        value: originalInnerHeight,
      });
    }
  });
});
