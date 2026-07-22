import { render } from '@testing-library/react';
import { ToastProvider } from '../ToastProvider';
test('ToastProvider renders without crashing', () => {
  render(<ToastProvider>Content</ToastProvider>);
});
