import React from 'react';
import { render, screen, act } from '@testing-library/react';
import HeartClient from '../HeartClient';

const mockCreateRigidBodyApi = () => ({
  setBodyType: jest.fn(),
  setTranslation: jest.fn(),
  setRotation: jest.fn(),
  setLinvel: jest.fn(),
  setAngvel: jest.fn(),
  applyImpulse: jest.fn(),
  applyTorqueImpulse: jest.fn(),
  translation: jest.fn(() => ({ x: 0, y: 0, z: 0 })),
  rotation: jest.fn(() => ({ x: 0, y: 0, z: 0, w: 1 })),
  linvel: jest.fn(() => ({ x: 0, y: 0, z: 0 })),
  angvel: jest.fn(() => ({ x: 0, y: 0, z: 0 })),
  setNextKinematicTranslation: jest.fn(),
  addForce: jest.fn(),
  setEnabled: jest.fn(),
  __triggerContactForce: null as ((payload: any) => void) | null,
});

const mockMainBodyApi = mockCreateRigidBodyApi();
const mockLeftBodyApi = mockCreateRigidBodyApi();
const mockRightBodyApi = mockCreateRigidBodyApi();

const frameCallbacks: ((state: any, delta: number) => void)[] = [];

jest.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => <div data-testid="canvas">{children}</div>,
  useFrame: (cb: (state: any, delta: number) => void) => {
    frameCallbacks.push(cb);
  },
  useThree: jest.fn(() => ({
    size: { width: 800, height: 600 },
    viewport: { width: 10, height: 7.5 },
  })),
}));

jest.mock('@react-three/drei', () => ({
  Environment: () => null,
  Html: ({ children }: { children: React.ReactNode }) => <div data-testid="html-overlay">{children}</div>,
  Text: ({ children }: { children: React.ReactNode }) => <div data-testid="webgl-text">{children}</div>,
  Points: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PointMaterial: () => null,
}));

jest.mock('@react-three/postprocessing', () => ({
  EffectComposer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bloom: () => null,
}));

jest.mock('@react-three/rapier', () => {
  const RigidBodyMock = React.forwardRef(
    ({ children, onContactForce, userData }: { children: React.ReactNode; onContactForce?: (payload: any) => void; userData?: { id: string } }, ref: React.Ref<unknown>) => {
      if (ref) {
        if (userData?.id === 'main') (ref as any).current = mockMainBodyApi;
        else if (userData?.id === 'left') (ref as any).current = mockLeftBodyApi;
        else if (userData?.id === 'right') (ref as any).current = mockRightBodyApi;
      }
      if (onContactForce && userData?.id === 'main') {
        mockMainBodyApi.__triggerContactForce = onContactForce;
      }
      return <div data-testid="rigidbody">{children}</div>;
    }
  );
  RigidBodyMock.displayName = 'RigidBody';

  return {
    Physics: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    RigidBody: RigidBodyMock,
    CuboidCollider: () => <div data-testid="cuboid-collider" />,
    RapierRigidBody: jest.fn(),
    CuboidColliderProps: jest.fn(),
    ActiveCollisionTypes: {
      CONTACT_FORCE_EVENTS: 0,
    },
    RigidBodyType: {
      Dynamic: 0,
      Fixed: 1,
      KinematicPositionBased: 2,
    },
  };
});

jest.mock('next/link', () => {
  const MockLink = ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>;
  MockLink.displayName = 'MockLink';
  return MockLink;
});

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn(),
}));

jest.mock('three', () => {
  const THREE = jest.requireActual('three');
  return {
    ...THREE,
    Shape: class {
      moveTo() {}
      bezierCurveTo() {}
    },
    ExtrudeGeometry: class {
      center() {}
    },
    Plane: class {},
    Vector3: class {},
    MeshPhysicalMaterial: class {},
    Euler: class {
      setFromQuaternion() {
        return this;
      }
    },
    Quaternion: class {
      setFromEuler() {}
    },
  };
});

describe('HeartClient Easter Egg Accessibility and Live Region', () => {
  const mockState = {
    clock: {
      getElapsedTime: () => 1.0,
    },
  };

  const advancePhysicsFrame = () => {
    act(() => {
      frameCallbacks.forEach((cb) => {
        try {
          cb(mockState, 0.016);
        } catch {
          // ignore any unrelated errors
        }
      });
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    frameCallbacks.length = 0;
    mockMainBodyApi.__triggerContactForce = null;
    mockMainBodyApi.translation.mockReturnValue({ x: 0, y: 0, z: 0 });
    mockMainBodyApi.rotation.mockReturnValue({ x: 0, y: 0, z: 0, w: 1 });
  });

  it('renders initial live region with "Heart is whole." and does not render easter egg DOM node', () => {
    render(<HeartClient partner1Name="Abbi" partner2Name="Fred" />);

    const liveRegion = screen.getByRole('status');
    expect(liveRegion).toBeInTheDocument();
    expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    expect(liveRegion).toHaveTextContent('Heart is whole.');

    // Easter egg DOM text node should not be present
    const htmlOverlay = screen.getByTestId('html-overlay');
    const secretDomNodes = htmlOverlay.querySelectorAll('.sr-only');
    const hasSecretText = Array.from(secretDomNodes).some((node) => node.textContent === 'I love you!');
    expect(hasSecretText).toBe(false);
  });

  it('renders accessible DOM text node in Drei Html wrapper and updates live region when secret state triggers (WCAG 1.1.1 & 4.1.3)', () => {
    render(<HeartClient partner1Name="Abbi" partner2Name="Fred" />);

    const liveRegion = screen.getByRole('status');
    expect(liveRegion).toHaveTextContent('Heart is whole.');

    // Move heart into secret spot: viewportWidth=10, viewportHeight=7.5
    // threshold: x > 10/2 - 2 = 3, y > 7.5/2 - 2 = 1.75
    mockMainBodyApi.translation.mockReturnValue({ x: 4, y: 2.5, z: 0 });
    advancePhysicsFrame();

    // 1. Live region announces secret message politely
    expect(liveRegion).toHaveTextContent('I love you!');
    expect(liveRegion).toHaveAttribute('aria-live', 'polite');

    // 2. Accessible DOM node is rendered inside Drei Html overlay for screen readers
    const htmlOverlay = screen.getByTestId('html-overlay');
    const secretDomNode = Array.from(htmlOverlay.querySelectorAll('.sr-only')).find(
      (node) => node.textContent === 'I love you!' && node !== liveRegion
    );
    expect(secretDomNode).toBeDefined();
    expect(secretDomNode).toBeInTheDocument();
  });

  it('does not move or hijack focus when the secret state triggers', () => {
    render(<HeartClient partner1Name="Abbi" partner2Name="Fred" />);

    const resetButton = screen.getByText('Reset');
    act(() => {
      resetButton.focus();
    });
    expect(document.activeElement).toBe(resetButton);

    // Trigger secret spot
    mockMainBodyApi.translation.mockReturnValue({ x: 4, y: 2.5, z: 0 });
    advancePhysicsFrame();

    // Focus must remain on the Reset button without moving
    expect(document.activeElement).toBe(resetButton);
  });

  it('unmounts the DOM text node and restores live region to "Heart is whole." when heart leaves secret coordinates', () => {
    render(<HeartClient partner1Name="Abbi" partner2Name="Fred" />);
    const liveRegion = screen.getByRole('status');

    // Trigger secret spot
    mockMainBodyApi.translation.mockReturnValue({ x: 4, y: 2.5, z: 0 });
    advancePhysicsFrame();

    expect(liveRegion).toHaveTextContent('I love you!');
    const htmlOverlay = screen.getByTestId('html-overlay');
    let secretDomNode = Array.from(htmlOverlay.querySelectorAll('.sr-only')).find(
      (node) => node.textContent === 'I love you!' && node !== liveRegion
    );
    expect(secretDomNode).toBeDefined();

    // Leave secret spot
    mockMainBodyApi.translation.mockReturnValue({ x: 0, y: 0, z: 0 });
    advancePhysicsFrame();

    // DOM text node must be unmounted cleanly
    secretDomNode = Array.from(htmlOverlay.querySelectorAll('.sr-only')).find(
      (node) => node.textContent === 'I love you!' && node !== liveRegion
    );
    expect(secretDomNode).toBeUndefined();

    // Live region status restored
    expect(liveRegion).toHaveTextContent('Heart is whole.');
  });

  it('prioritizes broken heart announcement in live region if heart breaks while secret message displays', () => {
    render(<HeartClient partner1Name="Abbi" partner2Name="Fred" />);
    const liveRegion = screen.getByRole('status');

    // Reveal easter egg
    mockMainBodyApi.translation.mockReturnValue({ x: 4, y: 2.5, z: 0 });
    advancePhysicsFrame();

    expect(liveRegion).toHaveTextContent('I love you!');

    // Heart shatters while secret is displayed
    act(() => {
      if (mockMainBodyApi.__triggerContactForce) {
        mockMainBodyApi.__triggerContactForce({ totalForceMagnitude: 300 } as any);
      }
    });

    // Broken announcement takes precedence over secret message
    expect(liveRegion).toHaveTextContent('Heart is broken.');
  });
});
