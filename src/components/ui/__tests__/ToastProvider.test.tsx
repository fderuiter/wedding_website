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
});
