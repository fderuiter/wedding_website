import { createJestAxeMock } from './jest-a11y-reporter.cjs';

jest.mock('jest-axe', () => createJestAxeMock(jest));

import '@testing-library/jest-dom';
import { toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);

const originalConsoleError = console.error;
console.error = (...args) => {
  if (typeof args[0] === 'string') {
    if (
      args[0].includes('is using incorrect casing.') ||
      args[0].includes('is unrecognized in this browser.') ||
      args[0].includes('for a non-boolean attribute') ||
      args[0].includes('is not recognized in this browser')
    ) {
      return;
    }
  }
  originalConsoleError(...args);
};

// Mock ResizeObserver
global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));

// Mock HTMLCanvasElement getContext for JSDOM
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = jest.fn().mockReturnValue({
    fillRect: jest.fn(),
    clearRect: jest.fn(),
    getImageData: jest.fn(() => ({ data: new Array(4) })),
    putImageData: jest.fn(),
    createImageData: jest.fn(() => []),
    setTransform: jest.fn(),
    drawImage: jest.fn(),
    save: jest.fn(),
    fillText: jest.fn(),
    restore: jest.fn(),
    beginPath: jest.fn(),
    clip: jest.fn(),
    arc: jest.fn(),
    stroke: jest.fn(),
    fill: jest.fn(),
    measureText: jest.fn(() => ({ width: 0 })),
    transform: jest.fn(),
    rect: jest.fn(),
    scale: jest.fn(),
  });
}

jest.mock('@stripe/stripe-js', () => ({
  loadStripe: jest.fn().mockResolvedValue({
    elements: jest.fn(),
    confirmPayment: jest.fn().mockResolvedValue({
      paymentIntent: { id: 'pi_mock_123', status: 'succeeded' },
    }),
    confirmCardPayment: jest.fn().mockResolvedValue({
      paymentIntent: { id: 'pi_mock_123', status: 'succeeded' },
    }),
  }),
}));

jest.mock('@stripe/react-stripe-js', () => {
  const React = jest.requireActual('react');
  return {
    Elements: ({ children }) =>
      React.createElement('div', { 'data-testid': 'stripe-elements-container' }, children),
    PaymentElement: (props) =>
      React.createElement(
        'div',
        { 'data-testid': 'stripe-payment-element', ...props },
        React.createElement(
          'div',
          { 'data-testid': 'embedded-stripe-elements' },
          'Stripe Payment Element (Cards, Apple Pay, Google Pay)'
        )
      ),
    CardElement: (props) => React.createElement('div', { 'data-testid': 'stripe-card-element', ...props }),
    useStripe: () => ({
      confirmPayment: jest.fn().mockResolvedValue({
        paymentIntent: { id: 'pi_test_mock_intent', status: 'succeeded' },
      }),
    }),
    useElements: () => ({
      submit: jest.fn().mockResolvedValue({}),
      getElement: jest.fn(),
    }),
  };
});
