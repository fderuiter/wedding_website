import { render, screen, act, fireEvent, renderHook } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import { ToastProvider, useToast, useOptionalToast } from '../ToastProvider';
import { Dialog } from '../Dialog';

expect.extend(toHaveNoViolations);

const TestComponent = () => {
  const { addToast } = useToast();
  return (
    <div>
      <button onClick={() => addToast('Info notification', 'info')}>Add Info</button>
      <button onClick={() => addToast('Success notification', 'success')}>Add Success</button>
      <button onClick={() => addToast('Error notification', 'error')}>Add Error</button>
    </div>
  );
};

describe('ToastProvider', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      jest.clearAllTimers();
    });
    jest.useRealTimers();
  });

  test('renders children without crashing', () => {
    render(
      <ToastProvider>
        <div>Test Child</div>
      </ToastProvider>
    );
    expect(screen.getByText('Test Child')).toBeInTheDocument();
  });

  test('assigns role="status" to info and success toasts and role="alert" to error toasts', () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('Add Info'));
    const statusToast = screen.getByRole('status');
    expect(statusToast).toBeInTheDocument();
    expect(statusToast).toHaveTextContent('Info notification');

    fireEvent.click(screen.getByText('Add Error'));
    const alertToast = screen.getByRole('alert');
    expect(alertToast).toBeInTheDocument();
    expect(alertToast).toHaveTextContent('Error notification');
  });

  test('applies CSS custom property styles for background, text color, and border radius on toast card while scoping live role to message span', () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('Add Info'));
    const statusToast = screen.getByRole('status');
    expect(statusToast.tagName).toBe('SPAN');
    expect(statusToast.querySelector('button')).toBeNull();
    expect(statusToast.closest('[data-toast-item]')).toHaveStyle({
      backgroundColor: 'var(--toast-info-bg)',
      color: 'var(--toast-info-text)',
      borderRadius: 'var(--toast-radius)',
    });

    fireEvent.click(screen.getByText('Add Error'));
    const alertToast = screen.getByRole('alert');
    expect(alertToast.tagName).toBe('SPAN');
    expect(alertToast.querySelector('button')).toBeNull();
    expect(alertToast.closest('[data-toast-item]')).toHaveStyle({
      backgroundColor: 'var(--toast-error-bg)',
      color: 'var(--toast-error-text)',
      borderRadius: 'var(--toast-radius)',
    });

    fireEvent.click(screen.getByText('Add Success'));
    const toasts = screen.getAllByRole('status');
    const successToast = toasts.find(t => t.textContent?.includes('Success notification'));
    expect(successToast?.tagName).toBe('SPAN');
    expect(successToast?.closest('[data-toast-item]')).toHaveStyle({
      backgroundColor: 'var(--toast-success-bg)',
      color: 'var(--toast-success-text)',
      borderRadius: 'var(--toast-radius)',
    });
  });

  test('applies --toast-close-hover-bg to close button hover state', () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('Add Info'));
    const closeButton = screen.getByRole('button', { name: /close notification/i });
    expect(closeButton).toBeInTheDocument();
    expect(closeButton.className).toContain('hover:bg-[var(--toast-close-hover-bg)]');
  });

  test('auto-dismisses toasts after 5000ms', () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('Add Info'));
    expect(screen.getByRole('status')).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  test('clears timer on manual toast dismissal', () => {
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('Add Info'));
    expect(screen.getByRole('status')).toBeInTheDocument();

    const closeButton = screen.getByRole('button', { name: /close notification/i });
    fireEvent.click(closeButton);

    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    clearTimeoutSpy.mockRestore();
  });

  test('clears active timers on ToastProvider unmount', () => {
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

    const { unmount } = render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('Add Info'));
    fireEvent.click(screen.getByText('Add Error'));

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();

    unmount();

    // Only the timed info toast starts a setTimeout; persistent error toasts do not
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);

    clearTimeoutSpy.mockRestore();
  });

  test('renders error toasts in aria-live="assertive" region and info/success in aria-live="polite" region', () => {
    const { container } = render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('Add Info'));
    fireEvent.click(screen.getByText('Add Success'));
    fireEvent.click(screen.getByText('Add Error'));

    const assertiveContainer = container.querySelector('[aria-live="assertive"]');
    const politeContainer = container.querySelector('[aria-live="polite"]');

    expect(assertiveContainer).toBeInTheDocument();
    expect(politeContainer).toBeInTheDocument();
    expect(assertiveContainer).not.toHaveAttribute('aria-atomic');
    expect(politeContainer).not.toHaveAttribute('aria-atomic');

    const notificationRegion = screen.getByRole('region', { name: 'Notifications' });
    expect(notificationRegion).toHaveAttribute('data-toast-container');

    expect(assertiveContainer).toHaveTextContent('Error notification');
    expect(assertiveContainer).not.toHaveTextContent('Info notification');

    expect(politeContainer).toHaveTextContent('Info notification');
    expect(politeContainer).toHaveTextContent('Success notification');
    expect(politeContainer).not.toHaveTextContent('Error notification');
  });

  test('pauses timer on hover and resumes with remaining duration on mouse leave', () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('Add Info'));
    const toast = screen.getByRole('status');

    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(toast).toBeInTheDocument();

    fireEvent.mouseEnter(toast);

    act(() => {
      jest.advanceTimersByTime(10000);
    });
    expect(toast).toBeInTheDocument();

    fireEvent.mouseLeave(toast);

    act(() => {
      jest.advanceTimersByTime(2900);
    });
    expect(toast).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  test('pauses timer on focus and resumes with remaining duration on blur', () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('Add Info'));
    const toast = screen.getByRole('status');
    const closeButton = screen.getByRole('button', { name: /close notification/i });

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    fireEvent.focus(closeButton);

    act(() => {
      jest.advanceTimersByTime(10000);
    });
    expect(toast).toBeInTheDocument();

    fireEvent.blur(toast, { relatedTarget: null });

    act(() => {
      jest.advanceTimersByTime(3900);
    });
    expect(toast).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  test('keeps timer paused when both hover and focus occur until both end', () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('Add Info'));
    const toast = screen.getByRole('status');

    fireEvent.mouseEnter(toast);
    fireEvent.focus(toast);

    fireEvent.mouseLeave(toast);

    act(() => {
      jest.advanceTimersByTime(10000);
    });
    expect(toast).toBeInTheDocument();

    fireEvent.blur(toast, { relatedTarget: null });

    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  describe('useOptionalToast', () => {
    test('returns null cleanly without throwing when rendered outside ToastProvider', () => {
      const { result } = renderHook(() => useOptionalToast());
      expect(result.current).toBeNull();

      const OutsideComponent = () => {
        const toast = useOptionalToast();
        return <div data-testid="toast-status">{toast === null ? 'null' : 'defined'}</div>;
      };

      expect(() => {
        render(<OutsideComponent />);
      }).not.toThrow();

      expect(screen.getByTestId('toast-status')).toHaveTextContent('null');
    });

    test('returns active toast context with all helper methods when rendered inside ToastProvider', () => {
      const { result } = renderHook(() => useOptionalToast(), {
        wrapper: ToastProvider,
      });

      expect(result.current).not.toBeNull();
      expect(typeof result.current?.addToast).toBe('function');
      expect(typeof result.current?.removeToast).toBe('function');
      expect(typeof result.current?.confirm).toBe('function');
      expect(Array.isArray(result.current?.toasts)).toBe(true);
    });

    test('allows dispatching toasts through useOptionalToast context inside ToastProvider', () => {
      const InsideComponent = () => {
        const toast = useOptionalToast();
        return (
          <div>
            <div data-testid="toast-status">{toast ? 'available' : 'null'}</div>
            {toast && (
              <button onClick={() => toast.addToast('Optional toast works', 'info')}>
                Dispatch Optional Toast
              </button>
            )}
          </div>
        );
      };

      render(
        <ToastProvider>
          <InsideComponent />
        </ToastProvider>
      );

      expect(screen.getByTestId('toast-status')).toHaveTextContent('available');
      fireEvent.click(screen.getByText('Dispatch Optional Toast'));
      expect(screen.getByRole('status')).toHaveTextContent('Optional toast works');
    });
  });

  test('renders toast action button with opaque inverse variant (without translucent bg-white/20), invokes callback, and passes jest-axe', async () => {
    jest.useRealTimers();
    const onUndo = jest.fn();

    const ActionToastTrigger = () => {
      const { addToast } = useToast();
      return (
        <button
          type="button"
          onClick={() =>
            addToast('Photo removed', 'info', undefined, undefined, {
              label: 'Undo',
              onClick: onUndo,
            })
          }
        >
          Trigger Action Toast
        </button>
      );
    };

    const { container } = render(
      <ToastProvider>
        <ActionToastTrigger />
      </ToastProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Trigger Action Toast' }));
    const undoButton = screen.getByRole('button', { name: 'Undo' });

    expect(undoButton).toHaveClass('bg-[var(--toast-action-bg,#ffffff)]');
    expect(undoButton).toHaveClass('text-[var(--toast-action-text,#111827)]');
    expect(undoButton).not.toHaveClass('bg-white/20');

    expect(await axe(container)).toHaveNoViolations();

    fireEvent.click(undoButton);
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  test('deduplicates identical active error toasts so only one role="alert" mounts per error message', () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    const addErrorBtn = screen.getByText('Add Error');
    fireEvent.click(addErrorBtn);
    fireEvent.click(addErrorBtn);

    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent('Error notification');

    // Once dismissed, identical error message can be dispatched again
    fireEvent.click(screen.getByRole('button', { name: /close notification/i }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(addErrorBtn);
    expect(screen.getByRole('alert')).toHaveTextContent('Error notification');
  });

  test('persists error and action toasts indefinitely by default while honoring explicit duration overrides', () => {
    const DurationHarness = () => {
      const { addToast } = useToast();
      return (
        <div>
          <button onClick={() => addToast('Persistent error', 'error')}>Add Persistent Error</button>
          <button
            onClick={() =>
              addToast('Action info', 'info', undefined, undefined, {
                label: 'Undo',
                onClick: () => {},
              })
            }
          >
            Add Action Toast
          </button>
          <button
            onClick={() => addToast('Timed error', 'error', undefined, undefined, undefined, 2000)}
          >
            Add Timed Error
          </button>
          <button
            onClick={() => addToast('Persistent info', 'info', undefined, undefined, undefined, null)}
          >
            Add Persistent Info
          </button>
        </div>
      );
    };

    render(
      <ToastProvider>
        <DurationHarness />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('Add Persistent Error'));
    fireEvent.click(screen.getByText('Add Action Toast'));
    fireEvent.click(screen.getByText('Add Persistent Info'));

    act(() => {
      jest.advanceTimersByTime(60_000);
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Persistent error');
    const statuses = screen.getAllByRole('status');
    expect(statuses.map((el) => el.textContent)).toEqual(
      expect.arrayContaining(['Action info', 'Persistent info'])
    );

    // Explicit numeric duration on error toast still auto-dismisses
    fireEvent.click(screen.getByText('Add Timed Error'));
    expect(screen.getAllByRole('alert')).toHaveLength(2);

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    const remainingAlerts = screen.getAllByRole('alert');
    expect(remainingAlerts).toHaveLength(1);
    expect(remainingAlerts[0]).toHaveTextContent('Persistent error');
  });

  test('toggles focus between prior control and active toast controls via Alt+T and F6', () => {
    const ShortcutHarness = () => {
      const { addToast } = useToast();
      return (
        <div>
          <button
            type="button"
            onClick={() =>
              addToast('Failed to dispatch test broadcast', 'error', undefined, undefined, {
                label: 'Retry',
                onClick: () => {},
              })
            }
          >
            Send Test to Me
          </button>
        </div>
      );
    };

    render(
      <ToastProvider>
        <ShortcutHarness />
      </ToastProvider>
    );

    const triggerBtn = screen.getByRole('button', { name: 'Send Test to Me' });
    triggerBtn.focus();
    expect(triggerBtn).toHaveFocus();

    // Alt+T does nothing when no visible toasts exist
    fireEvent.keyDown(document, { key: 't', code: 'KeyT', altKey: true });
    expect(triggerBtn).toHaveFocus();

    fireEvent.click(triggerBtn);
    expect(screen.getByText('Notifications · Alt+T')).toBeInTheDocument();

    const retryBtn = screen.getByRole('button', { name: 'Retry' });

    // Alt+T jumps focus into the active toast's first interactive control
    fireEvent.keyDown(document, { key: 't', code: 'KeyT', altKey: true });
    expect(retryBtn).toHaveFocus();

    // Pressing Alt+T again returns focus to the prior element
    fireEvent.keyDown(document, { key: 't', code: 'KeyT', altKey: true });
    expect(triggerBtn).toHaveFocus();

    // F6 also toggles focus into the notification region and back
    fireEvent.keyDown(document, { key: 'F6' });
    expect(retryBtn).toHaveFocus();

    fireEvent.keyDown(document, { key: 'F6' });
    expect(triggerBtn).toHaveFocus();
  });

  test('dismisses focused or hovered toast on Escape with stopPropagation and restores focus to active Dialog without closing it', () => {
    const onDialogClose = jest.fn();
    const onRetry = jest.fn();

    const ModalWithToastHarness = () => {
      const { addToast } = useToast();
      return (
        <Dialog isOpen={true} onClose={onDialogClose} title="Compose Multi-Channel Broadcast">
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
    };

    render(
      <ToastProvider>
        <ModalWithToastHarness />
      </ToastProvider>
    );

    const sendTestBtn = screen.getByRole('button', { name: 'Send Test to Me' });
    sendTestBtn.focus();
    fireEvent.click(sendTestBtn);

    const retryBtn = screen.getByRole('button', { name: 'Retry' });

    // Jump to toast via Alt+T, then press Escape on focused toast control
    fireEvent.keyDown(document, { key: 't', code: 'KeyT', altKey: true });
    expect(retryBtn).toHaveFocus();

    const escapeOnFocused = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    const stopPropSpy = jest.spyOn(escapeOnFocused, 'stopPropagation');
    fireEvent(retryBtn, escapeOnFocused);

    expect(stopPropSpy).toHaveBeenCalled();
    expect(escapeOnFocused.defaultPrevented).toBe(true);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onDialogClose).not.toHaveBeenCalled();
    expect(sendTestBtn).toHaveFocus();

    // Re-trigger toast and dismiss via Escape while hovered (with focus still inside Dialog)
    fireEvent.click(sendTestBtn);
    const hoveredAlertCard = screen.getByRole('alert').closest('[data-toast-item]')!;
    fireEvent.mouseEnter(hoveredAlertCard);
    expect(sendTestBtn).toHaveFocus();

    fireEvent.keyDown(sendTestBtn, { key: 'Escape' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onDialogClose).not.toHaveBeenCalled();
    expect(sendTestBtn).toHaveFocus();

    // Re-trigger toast, focus Retry, and click Retry -> invokes action and restores focus to Dialog
    fireEvent.click(sendTestBtn);
    const retryBtnAgain = screen.getByRole('button', { name: 'Retry' });
    retryBtnAgain.focus();
    fireEvent.click(retryBtnAgain);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onDialogClose).not.toHaveBeenCalled();
    expect(sendTestBtn).toHaveFocus();
  });

  test('avoids duplicate Notifications landmarks when multiple standalone Dialogs mount EnsureToastProvider', async () => {
    jest.useRealTimers();
    const { container } = render(
      <div>
        <Dialog isOpen={true} onClose={() => {}} title="First Dialog">
          <button type="button">First Action</button>
        </Dialog>
        <Dialog isOpen={false} onClose={() => {}} title="Second Dialog">
          <button type="button">Second Action</button>
        </Dialog>
      </div>
    );

    const results = await axe(container, {
      rules: {
        'landmark-unique': { enabled: true },
      },
    });
    expect(results).toHaveNoViolations();
  });

  test('suppresses empty Notifications landmark inside ?preview=true studio preview iframes', () => {
    const originalUrl = window.location.href;
    window.history.replaceState({}, '', '/?preview=true');
    try {
      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      expect(screen.queryByRole('region', { name: /notifications/i })).not.toBeInTheDocument();

      fireEvent.click(screen.getByText('Add Error'));
      expect(screen.getByRole('region', { name: 'Preview Notifications' })).toBeInTheDocument();
    } finally {
      window.history.replaceState({}, '', originalUrl);
    }
  });
});
