import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Dialog } from '../Dialog';
import { ToastProvider, useToast } from '../ToastProvider';

describe('Dialog', () => {
  test('Dialog renders without crashing', () => {
    render(<Dialog isOpen={true} onClose={() => {}}>Content</Dialog>);
  });

  test('forwards ref and merges custom className via cn()', () => {
    const ref = React.createRef<HTMLDivElement>();
    render(
      <Dialog ref={ref} isOpen={true} onClose={() => {}} className="custom-dialog-class">
        Content
      </Dialog>
    );

    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    expect(ref.current).toHaveClass('custom-dialog-class');
    expect(ref.current).toHaveClass('bg-white');
  });

  test('renders with a single dialog role and modal attributes', () => {
    const { getAllByRole, getByRole } = render(
      <Dialog isOpen={true} onClose={() => {}} title="Test Title" description="Test Description">
        Content
      </Dialog>
    );

    const dialogs = getAllByRole('dialog');
    expect(dialogs).toHaveLength(1);

    const dialog = getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby');
    expect(dialog).toHaveAttribute('aria-describedby');
  });

  test('renders with alertdialog role when role prop is alertdialog', () => {
    const { getAllByRole, queryAllByRole, getByRole } = render(
      <Dialog isOpen={true} onClose={() => {}} role="alertdialog" title="Alert Title">
        Alert Content
      </Dialog>
    );

    expect(queryAllByRole('dialog')).toHaveLength(0);
    const alertdialogs = getAllByRole('alertdialog');
    expect(alertdialogs).toHaveLength(1);

    const alertdialog = getByRole('alertdialog');
    expect(alertdialog).toHaveAttribute('aria-modal', 'true');
  });

  test('uses preset CSS variable bindings for background and border', () => {
    const ref = React.createRef<HTMLDivElement>();
    render(
      <Dialog ref={ref} isOpen={true} onClose={() => {}}>
        Content
      </Dialog>
    );

    expect(ref.current).toHaveStyle({
      backgroundColor: 'var(--dialog-bg, var(--background, #ffffff))',
      borderColor: 'var(--dialog-border-color, var(--color-border, #e5e7eb))',
    });
  });

  test('marks dialog body container with data-scroll-region by default and supports scrollRegion=false', () => {
    const { getByRole, rerender } = render(
      <Dialog isOpen={true} onClose={() => {}} title="Scrollable Dialog">
        <div data-testid="dialog-inner-child">Body</div>
      </Dialog>
    );

    const dialog = getByRole('dialog');
    const scrollRegionEl = dialog.querySelector('[data-scroll-region]');
    expect(scrollRegionEl).not.toBeNull();
    expect(scrollRegionEl).toHaveClass('overflow-y-auto');

    rerender(
      <Dialog isOpen={true} onClose={() => {}} title="Scrollable Dialog" scrollRegion={false}>
        <div data-testid="dialog-inner-child">Body</div>
      </Dialog>
    );

    expect(getByRole('dialog').querySelector('[data-scroll-region]')).toBeNull();
    expect(screen.getByTestId('dialog-inner-child').parentElement).not.toHaveClass('overflow-y-auto');
  });

  test('prompts via ToastProvider.confirm when isDirty=true on Escape or outside click and closes cleanly when isDirty=false', async () => {
    const onClose = jest.fn();

    const { rerender } = render(
      <ToastProvider>
        <Dialog isOpen={true} onClose={onClose} isDirty={false} title="Clean Dialog">
          <button type="button">Inner Action</button>
        </Dialog>
      </ToastProvider>
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    onClose.mockClear();

    rerender(
      <ToastProvider>
        <Dialog isOpen={true} onClose={onClose} isDirty={true} title="Dirty Dialog">
          <button type="button">Inner Action</button>
        </Dialog>
      </ToastProvider>
    );

    const innerBtn = screen.getByRole('button', { name: 'Inner Action' });
    innerBtn.focus();
    expect(document.activeElement).toBe(innerBtn);

    fireEvent.keyDown(document, { key: 'Escape' });
    const alertDialog = await screen.findByRole('alertdialog');
    expect(onClose).not.toHaveBeenCalled();

    // Cancel keeps Dialog open and restores focus back inside the underlying Dialog
    fireEvent.click(within(alertDialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(innerBtn);

    // Outside mousedown on dirty Dialog prompts; Confirm closes underlying Dialog
    fireEvent.mouseDown(document.body);
    const secondAlert = await screen.findByRole('alertdialog');
    fireEvent.click(within(secondAlert).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  test('traps Tab focus within topmost stacked ToastProvider.confirm alertdialog over an open Dialog', async () => {
    function StackedHarness() {
      const { confirm } = useToast();
      return (
        <Dialog isOpen={true} onClose={() => {}} title="Base Dialog">
          <button type="button" onClick={() => void confirm('Confirm destructive action?')}>
            Trigger Confirm
          </button>
          <button type="button">Secondary Dialog Button</button>
        </Dialog>
      );
    }

    render(
      <ToastProvider>
        <StackedHarness />
      </ToastProvider>
    );

    const triggerBtn = screen.getByRole('button', { name: 'Trigger Confirm' });
    triggerBtn.focus();
    fireEvent.click(triggerBtn);

    const alertDialog = await screen.findByRole('alertdialog');
    const cancelBtn = within(alertDialog).getByRole('button', { name: 'Cancel' });
    const confirmBtn = within(alertDialog).getByRole('button', { name: 'Confirm' });

    // Initial focus moves inside the topmost alertdialog
    expect(alertDialog.contains(document.activeElement)).toBe(true);

    // Tab from last focusable element (Confirm) wraps to first focusable element (Cancel) inside alertdialog
    confirmBtn.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: false });
    expect(document.activeElement).toBe(cancelBtn);

    // Shift+Tab from first focusable element (Cancel) wraps to Confirm inside alertdialog
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirmBtn);

    // Escape closes only the topmost alertdialog and restores focus to trigger inside Base Dialog
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('dialog', { name: 'Base Dialog' })).toBeInTheDocument();
    expect(document.activeElement).toBe(triggerBtn);
  });
});

