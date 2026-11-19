import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import { Overlay } from '../Overlay';

expect.extend(toHaveNoViolations);

describe('Overlay', () => {
  test('Overlay renders without crashing', () => {
    render(<Overlay isOpen={true} onClose={() => {}}>Content</Overlay>);
  });

  test('forwards ref to inner panel and merges custom className via cn()', () => {
    const ref = React.createRef<HTMLDivElement>();
    render(
      <Overlay ref={ref} isOpen={true} onClose={() => {}} className="custom-overlay-content">
        <div>Content</div>
      </Overlay>
    );

    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    expect(ref.current).toHaveClass('custom-overlay-content');
  });

  test('does not default to dialog role, aria-modal, tabIndex=-1, or background inert', () => {
    const ref = React.createRef<HTMLDivElement>();
    const { queryAllByRole } = render(
      <div>
        <button type="button" data-testid="sibling-btn">
          Background Button
        </button>
        <Overlay ref={ref} isOpen={true} onClose={() => {}}>
          <button type="button">Menu Action</button>
        </Overlay>
      </div>
    );

    expect(queryAllByRole('dialog')).toHaveLength(0);
    expect(ref.current).not.toHaveAttribute('tabindex');
    expect(screen.getByTestId('sibling-btn')).not.toHaveAttribute('inert');
  });

  test('correctly forwards optional role, aria-modal, and aria-label props and sets tabIndex=-1 on modal panel', () => {
    const ref = React.createRef<HTMLDivElement>();
    const { getByRole } = render(
      <Overlay
        ref={ref}
        isOpen={true}
        onClose={() => {}}
        role="dialog"
        aria-modal="true"
        aria-label="Custom Modal Label"
      >
        <div>Content</div>
      </Overlay>
    );

    const dialog = getByRole('dialog', { name: 'Custom Modal Label' });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(ref.current).toHaveAttribute('tabindex', '-1');
  });

  test('renders standalone dialog role without duplicate dialog roles', () => {
    const { getAllByRole } = render(
      <Overlay isOpen={true} onClose={() => {}} role="dialog" aria-modal="true">
        <div>Content</div>
      </Overlay>
    );

    const dialogs = getAllByRole('dialog');
    expect(dialogs).toHaveLength(1);
  });

  test('recovers focus into active modal on Tab and Shift+Tab when document.activeElement is document.body or modal panel', () => {
    const panelRef = React.createRef<HTMLDivElement>();
    render(
      <Overlay ref={panelRef} isOpen={true} onClose={() => {}} isModal={true} role="dialog" aria-modal="true">
        <button type="button" data-testid="first-btn">
          First
        </button>
        <button type="button" data-testid="second-btn">
          Second
        </button>
      </Overlay>
    );

    const firstBtn = screen.getByTestId('first-btn');
    const secondBtn = screen.getByTestId('second-btn');

    // Simulate focus falling to document.body -> Tab focuses first control
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(firstBtn).toHaveFocus();

    // Simulate focus falling to document.body -> Shift+Tab focuses last control
    firstBtn.blur();
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(secondBtn).toHaveFocus();

    // Simulate clicking non-interactive panel area (tabIndex=-1) -> Tab focuses first control
    panelRef.current?.focus();
    expect(panelRef.current).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(firstBtn).toHaveFocus();
  });

  test('recovers focus inside modal via MutationObserver and focusin when active child unmounts or focus escapes', async () => {
    function DynamicModal() {
      const [step, setStep] = React.useState<'one' | 'two'>('one');
      const [disabled, setDisabled] = React.useState(false);
      return (
        <div>
          <button type="button" data-testid="outside-btn">
            Outside
          </button>
          <Overlay isOpen={true} onClose={() => {}} isModal={true} role="dialog" aria-modal="true">
            {step === 'one' ? (
              <button type="button" onClick={() => setStep('two')}>
                Advance Step
              </button>
            ) : (
              <button
                type="button"
                disabled={disabled}
                onClick={() => setDisabled(true)}
                data-testid="step-two-primary"
              >
                Disable Me
              </button>
            )}
            <button type="button" data-testid="fallback-close">
              Close Modal
            </button>
          </Overlay>
        </div>
      );
    }

    render(<DynamicModal />);

    const advanceBtn = screen.getByRole('button', { name: 'Advance Step' });
    expect(advanceBtn).toHaveFocus();

    // Unmounting focused button recovers focus inside modal
    fireEvent.click(advanceBtn);
    await waitFor(() => {
      expect(screen.getByTestId('step-two-primary')).toHaveFocus();
    });

    // Disabling focused button recovers focus to remaining enabled button
    fireEvent.click(screen.getByTestId('step-two-primary'));
    await waitFor(() => {
      expect(screen.getByTestId('fallback-close')).toHaveFocus();
    });

    // External focusin event pulls focus back inside modal
    const outsideBtn = screen.getByTestId('outside-btn');
    fireEvent.focusIn(outsideBtn);
    expect(screen.getByTestId('fallback-close')).toHaveFocus();
  });

  test('applies reference-counted inert to background siblings and cleans up when last modal closes', async () => {
    function StackedOverlays({ openFirst, openSecond }: { openFirst: boolean; openSecond: boolean }) {
      return (
        <div>
          <div data-testid="page-background">
            <button type="button">Background Action</button>
          </div>
          <div data-toast-region="true" data-testid="live-toast-region">
            <div aria-live="polite" />
          </div>
          <Overlay isOpen={openFirst} onClose={() => {}} isModal={true} role="dialog" aria-modal="true">
            <button type="button">First Modal Action</button>
          </Overlay>
          <Overlay isOpen={openSecond} onClose={() => {}} isModal={true} role="dialog" aria-modal="true">
            <button type="button">Second Modal Action</button>
          </Overlay>
        </div>
      );
    }

    const { rerender } = render(<StackedOverlays openFirst={true} openSecond={false} />);
    const background = screen.getByTestId('page-background');
    const toastRegion = screen.getByTestId('live-toast-region');

    expect(background).toHaveAttribute('inert');
    expect(toastRegion).not.toHaveAttribute('inert');

    // Open second modal on top
    rerender(<StackedOverlays openFirst={true} openSecond={true} />);
    expect(background).toHaveAttribute('inert');
    expect(toastRegion).not.toHaveAttribute('inert');

    // Close second modal while first remains open -> background stays inert
    rerender(<StackedOverlays openFirst={true} openSecond={false} />);
    expect(background).toHaveAttribute('inert');

    // Close last modal -> background inert removed cleanly
    rerender(<StackedOverlays openFirst={false} openSecond={false} />);
    await waitFor(() => {
      expect(background).not.toHaveAttribute('inert');
    });
  });

  test('passes automated axe accessibility audits when open as a dialog', async () => {
    const { container } = render(
      <Overlay isOpen={true} onClose={() => {}} role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <h2 id="dialog-title">Dialog Title</h2>
        <p>Dialog body content</p>
      </Overlay>
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

