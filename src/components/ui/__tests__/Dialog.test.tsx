import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Dialog } from '../Dialog';
import { ToastProvider, useToast } from '../ToastProvider';

describe('Dialog', () => {
  test('Dialog renders without crashing', () => {
    render(<Dialog isOpen={true} onClose={() => {}}>Content</Dialog>);
  });

  test('forwards ref, sets tabIndex=-1 on modal panel, and merges custom className via cn()', () => {
    const ref = React.createRef<HTMLDivElement>();
    render(
      <Dialog ref={ref} isOpen={true} onClose={() => {}} className="custom-dialog-class">
        Content
      </Dialog>
    );

    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    expect(ref.current).toHaveClass('custom-dialog-class');
    expect(ref.current).toHaveClass('bg-white');
    expect(ref.current).toHaveAttribute('tabindex', '-1');
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

  test('forwards aria-label when title is omitted', () => {
    render(
      <Dialog isOpen={true} onClose={() => {}} aria-label="Accessible Custom Dialog">
        <button type="button">Action</button>
      </Dialog>
    );

    expect(screen.getByRole('dialog', { name: 'Accessible Custom Dialog' })).toBeInTheDocument();
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

  test('recovers focus into Dialog when Tab or Shift+Tab is pressed from document.body', () => {
    render(
      <Dialog isOpen={true} onClose={() => {}} title="Focus Recovery">
        <button type="button">Primary</button>
        <button type="button">Secondary</button>
      </Dialog>
    );

    const primaryBtn = screen.getByRole('button', { name: 'Primary' });
    const secondaryBtn = screen.getByRole('button', { name: 'Secondary' });

    primaryBtn.blur();
    expect(document.activeElement).toBe(document.body);

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(primaryBtn).toHaveFocus();

    primaryBtn.blur();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(secondaryBtn).toHaveFocus();
  });

  test('keeps background inert across stacked ToastProvider confirmation Dialogs and preserves live toast regions', async () => {
    function StackedConfirmHarness() {
      const [modalOpen, setModalOpen] = React.useState(true);
      const { confirm, addToast } = useToast();
      return (
        <div>
          <div data-testid="background-content">
            <button type="button">Page Link</button>
          </div>
          <Dialog isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Parent Modal">
            <button
              type="button"
              onClick={async () => {
                const ok = await confirm('Delete this item?');
                if (ok) {
                  addToast('Deleted', 'success');
                }
              }}
            >
              Trigger Confirm
            </button>
            <button type="button" onClick={() => setModalOpen(false)}>
              Close Parent
            </button>
          </Dialog>
        </div>
      );
    }

    const { container } = render(
      <ToastProvider>
        <StackedConfirmHarness />
      </ToastProvider>
    );

    const background = screen.getByTestId('background-content');
    const toastRegion = container.querySelector('[data-toast-region="true"]');

    expect(background).toHaveAttribute('inert');
    expect(toastRegion).toBeInTheDocument();
    expect(toastRegion).not.toHaveAttribute('inert');

    // Open stacked ToastProvider confirmation dialog
    fireEvent.click(screen.getByRole('button', { name: 'Trigger Confirm' }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(background).toHaveAttribute('inert');
    expect(toastRegion).not.toHaveAttribute('inert');

    // Confirm closes the stacked alertdialog, while Parent Modal stays open
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });

    // Background MUST remain inert while Parent Modal is still open, and live toast stays non-inert
    expect(background).toHaveAttribute('inert');
    expect(toastRegion).not.toHaveAttribute('inert');
    expect(await screen.findByText('Deleted')).toBeInTheDocument();

    // Closing Parent Modal releases background inert cleanly
    fireEvent.click(screen.getByRole('button', { name: 'Close Parent' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(background).not.toHaveAttribute('inert');
    });
  });
});

