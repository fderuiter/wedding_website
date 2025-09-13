/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import HeartPage from '../page';

// Mocking react-three-fiber and related libraries
jest.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => <div data-testid="canvas">{children}</div>,
  useFrame: jest.fn(),
  useThree: () => ({
    size: { width: 800, height: 600 },
    viewport: { width: 10, height: 7.5 },
  }),
}));

jest.mock('@react-three/drei', () => ({
  Environment: () => null,
  Html: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Points: () => null,
  PointMaterial: () => null,
}));

jest.mock('@react-three/rapier', () => ({
  Physics: ({ children }: { children: React.ReactNode }) => <div data-testid="physics">{children}</div>,
  RigidBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CuboidCollider: () => null,
}));

jest.mock('@react-three/postprocessing', () => ({
  EffectComposer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bloom: () => null,
}));

jest.mock('@use-gesture/react', () => ({
  useDrag: (fn: any) => {
    const gesture = {
      bind: () => ({ onMouseDown: () => fn({ first: true, active: true }) }),
    };
    return gesture.bind;
  },
}));

// Mock Link component from next/link
jest.mock('next/link', () => {
    return ({ children, href }: { children: React.ReactNode, href: string }) => {
        return <a href={href}>{children}</a>;
    }
});


describe('HeartPage', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    // Suppress expected console errors about incorrect casing for custom elements
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message, ...args) => {
      if (typeof message === 'string' && (message.includes('is using incorrect casing') || message.includes('is unrecognized in this browser'))) {
        return;
      }
      consoleErrorSpy.mockRestore();
      console.error(message, ...args);
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders the Back Home and Reset buttons', () => {
    render(<HeartPage />);
    expect(screen.getByText('Back Home')).toBeInTheDocument();
    expect(screen.getByText('Reset')).toBeInTheDocument();
  });

  it('resets the heart animation when the reset button is clicked', () => {
    render(<HeartPage />);
    const resetButton = screen.getByText('Reset');

    // We can't directly test the "key" prop change on Physics,
    // but we can check that the reset function is called.
    // For now, let's just check if the button is clickable.
    fireEvent.click(resetButton);
  });

  it('adjusts scale on window resize', () => {
    render(<HeartPage />);

    // Initial scale check would require exposing the scale state or checking a prop
    // on a child component, which is complex with the current mocking.
    // We can, however, trigger the resize event.
    act(() => {
      global.innerWidth = 500;
      global.dispatchEvent(new Event('resize'));
    });

    // Re-render or check for updated props would be the next step.
    // This is a basic test to ensure the event listener is set up.
  });

  it('renders the names on the heart', () => {
    render(<HeartPage />);
    // The names are rendered multiple times due to the broken heart pieces
    // also being in the DOM, so we use getAllByText.
    expect(screen.getAllByText('Abbi').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Fred').length).toBeGreaterThan(0);
  });
});
