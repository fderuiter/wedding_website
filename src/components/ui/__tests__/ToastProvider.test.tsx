import { render, screen, act, fireEvent } from '@testing-library/react';
import { ToastProvider, useToast } from '../ToastProvider';

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

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(2);

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
});
