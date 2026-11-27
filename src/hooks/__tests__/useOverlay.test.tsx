import { useRef, useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useOverlay } from '../useOverlay';
import { Dialog } from '@/components/ui/Dialog';
import { ToastProvider, useToast } from '@/components/ui/ToastProvider';

function ToggleDropdownFixture({ excludeTrigger = true }: { excludeTrigger?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { overlayRef } = useOverlay(
    isOpen,
    () => setIsOpen(false),
    excludeTrigger ? { triggerRef } : undefined
  );

  return (
    <div>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <span>Toggle Menu</span>
      </button>
      {isOpen && (
        <div ref={overlayRef} role="menu">
          <button type="button" role="menuitem">
            First Action
          </button>
          <button type="button" role="menuitem">
            Second Action
          </button>
        </div>
      )}
    </div>
  );
}

describe('useOverlay', () => {
  it('closes cleanly on first pointer click (mousedown + mouseup + click) when triggerRef is provided', () => {
    render(<ToggleDropdownFixture excludeTrigger={true} />);

    const trigger = screen.getByRole('button', { name: 'Toggle Menu' });
    const triggerLabel = screen.getByText('Toggle Menu');

    // Open via pointer sequence
    fireEvent.mouseDown(trigger);
    fireEvent.mouseUp(trigger);
    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu')).toBeInTheDocument();

    // Click open trigger (including nested child target) -> closes cleanly without reopening
    fireEvent.mouseDown(triggerLabel);
    fireEvent.mouseUp(triggerLabel);
    fireEvent.click(triggerLabel);

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('still dismisses on outside mousedown when clicking outside both overlayRef and triggerRef', () => {
    render(<ToggleDropdownFixture excludeTrigger={true} />);

    const trigger = screen.getByRole('button', { name: 'Toggle Menu' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    fireEvent.mouseUp(document.body);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('wraps Tab and Shift+Tab focus within overlayRef and closes on Escape', () => {
    render(<ToggleDropdownFixture excludeTrigger={true} />);

    const trigger = screen.getByRole('button', { name: 'Toggle Menu' });
    trigger.focus();
    fireEvent.click(trigger);

    const first = screen.getByRole('menuitem', { name: 'First Action' });
    const second = screen.getByRole('menuitem', { name: 'Second Action' });
    expect(first).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(second).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(first).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('keeps an open Dialog mounted when clicking, tabbing through, and pressing Escape on [data-toast-container]', () => {
    function DialogWithToastFixture() {
      const [isDialogOpen, setIsDialogOpen] = useState(true);
      const [isToastVisible, setIsToastVisible] = useState(true);
      const { overlayRef } = useOverlay(isDialogOpen, () => setIsDialogOpen(false));

      return (
        <div>
          <button type="button">Background Button</button>
          {isDialogOpen && (
            <div ref={overlayRef} role="dialog" aria-modal="true" aria-label="Compose Broadcast">
              <input aria-label="Subject" defaultValue="RSVP Reminder" />
              <button type="button">Send Test</button>
            </div>
          )}
          {isToastVisible && (
            <div data-toast-container role="region" aria-label="Notifications">
              <div data-toast-item tabIndex={-1}>
                <span role="alert">Failed to dispatch test broadcast</span>
                <button type="button">Retry</button>
                <button
                  type="button"
                  aria-label="Close notification"
                  onClick={() => setIsToastVisible(false)}
                >
                  ×
                </button>
              </div>
            </div>
          )}
        </div>
      );
    }

    render(<DialogWithToastFixture />);

    const dialog = screen.getByRole('dialog', { name: 'Compose Broadcast' });
    const subjectInput = screen.getByLabelText('Subject');
    const sendTestBtn = screen.getByRole('button', { name: 'Send Test' });
    const retryBtn = screen.getByRole('button', { name: 'Retry' });
    const closeToastBtn = screen.getByRole('button', { name: 'Close notification' });

    expect(subjectInput).toHaveFocus();

    // 1. Pointer click inside [data-toast-container] keeps Dialog open
    fireEvent.mouseDown(retryBtn);
    fireEvent.mouseUp(retryBtn);
    fireEvent.click(retryBtn);
    expect(dialog).toBeInTheDocument();

    // 2. Tab cycling bridges Dialog <-> [data-toast-container] without escaping to Background Button
    sendTestBtn.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(retryBtn).toHaveFocus();

    // Shift+Tab from first toast control returns to last Dialog control
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(sendTestBtn).toHaveFocus();

    // Shift+Tab from first Dialog control wraps to last toast control
    subjectInput.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(closeToastBtn).toHaveFocus();

    // Tab from last toast control wraps back to first Dialog control
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(subjectInput).toHaveFocus();
    expect(dialog).toBeInTheDocument();

    // 3. Pressing Escape while focused inside [data-toast-container] skips closing Dialog
    retryBtn.focus();
    fireEvent.keyDown(retryBtn, { key: 'Escape' });
    expect(dialog).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(dialog).toBeInTheDocument();

    // Pressing Escape when focus returns to Dialog closes Dialog normally
    subjectInput.focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Compose Broadcast' })).not.toBeInTheDocument();
  });

  it('isolates real Dialog overlays from ToastProvider clicks, Tab cycling, and Escape toast dismissal', () => {
    const onClose = jest.fn();
    const onRetry = jest.fn();

    function RealDialogWithToast() {
      const { addToast } = useToast();
      return (
        <Dialog isOpen={true} onClose={onClose} title="Compose Multi-Channel Broadcast">
          <input aria-label="Subject" defaultValue="RSVP Reminder" />
          <button
            type="button"
            onClick={() =>
              addToast('Failed to dispatch test broadcast', 'error', undefined, undefined, {
                label: 'Retry',
                onClick: onRetry,
              })
            }
          >
            Send Test to Me
          </button>
        </Dialog>
      );
    }

    render(
      <ToastProvider>
        <RealDialogWithToast />
      </ToastProvider>
    );

    const subjectInput = screen.getByLabelText('Subject');
    const sendTestBtn = screen.getByRole('button', { name: 'Send Test to Me' });

    fireEvent.click(sendTestBtn);
    const retryBtn = screen.getByRole('button', { name: 'Retry' });
    const closeToastBtn = screen.getByRole('button', { name: /close notification/i });

    // Clicking inside [data-toast-container] does not close Dialog
    const toastRegion = screen.getByRole('region', { name: 'Notifications' });
    fireEvent.mouseDown(toastRegion);
    fireEvent.mouseUp(toastRegion);
    expect(onClose).not.toHaveBeenCalled();

    // Tabbing from last Dialog control enters [data-toast-container]
    sendTestBtn.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(retryBtn).toHaveFocus();

    // Tabbing from last toast control wraps back to first Dialog control
    closeToastBtn.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(subjectInput).toHaveFocus();

    // Escape on focused toast dismisses toast without closing Dialog
    retryBtn.focus();
    fireEvent.keyDown(retryBtn, { key: 'Escape' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(subjectInput).toHaveFocus();
  });

  test('includes trailing aria-disabled="true" busy controls in Tab wrapping so focus never escapes modal', () => {
    render(
      <Dialog isOpen={true} onClose={jest.fn()} title="Busy Action Modal">
        <input aria-label="Passcode" defaultValue="WED2026" />
        <button type="button" aria-disabled="true" aria-busy="true">
          Access Portal
        </button>
      </Dialog>
    );

    const passcodeInput = screen.getByLabelText('Passcode');
    const busySubmitBtn = screen.getByRole('button', { name: 'Access Portal' });

    expect(passcodeInput).toHaveFocus();

    // Shift+Tab from first element wraps to trailing aria-disabled button
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(busySubmitBtn).toHaveFocus();

    // Tab from trailing aria-disabled button wraps back to first element inside modal
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: false });
    expect(passcodeInput).toHaveFocus();
  });

  test('recovers focus inside the active dialog when the currently focused control unmounts', () => {
    function StepModal() {
      const [step, setStep] = useState<'one' | 'two'>('one');
      return (
        <Dialog isOpen={true} onClose={jest.fn()} title="Multi-Step Dialog">
          {step === 'one' ? (
            <button type="button" onClick={() => setStep('two')}>
              Continue to Step 2
            </button>
          ) : (
            <div>
              <button type="button" onClick={() => setStep('one')}>
                Back to Step 1
              </button>
              <button type="button">Finish</button>
            </div>
          )}
        </Dialog>
      );
    }

    render(<StepModal />);
    const dialog = screen.getByRole('dialog', { name: 'Multi-Step Dialog' });
    const continueBtn = screen.getByRole('button', { name: 'Continue to Step 2' });
    continueBtn.focus();
    expect(continueBtn).toHaveFocus();

    fireEvent.click(continueBtn);

    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(screen.getByRole('button', { name: 'Back to Step 1' })).toHaveFocus();
  });
});
