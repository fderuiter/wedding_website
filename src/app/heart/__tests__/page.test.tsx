import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import HeartPage from '../HeartPageClient';
import { RigidBodyType } from '@dimforge/rapier3d-compat';

import { ContactForceEvent } from '@react-three/rapier';

let onContactForceCallback: (payload: ContactForceEvent) => void;

const mockRigidBodyApi = {
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
};

jest.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => <div data-testid="canvas">{children}</div>,
  useFrame: jest.fn(),
  useThree: jest.fn(() => ({
    size: { width: 800, height: 600 },
    viewport: { width: 10, height: 7.5 },
  })),
}));

jest.mock('@react-three/drei', () => ({
    Environment: () => null,
    Html: ({ children }: { children: React.ReactNode }) => <div data-testid="html">{children}</div>,
    Text: ({ children }: { children: React.ReactNode }) => <div data-testid="text">{children}</div>,
    Points: ({ children, positions }: { children: React.ReactNode, positions: Float32Array }) => (
        <div data-testid="points" data-positions-length={positions ? positions.length : 0}>
            {children}
        </div>
    ),
    PointMaterial: () => null,
}));

jest.mock('@react-three/postprocessing', () => ({
  EffectComposer: ({ children }: { children: React.ReactNode }) => <div data-testid="effect-composer">{children}</div>,
  Bloom: () => null,
}));

jest.mock('@react-three/rapier', () => {
    const RigidBodyMock = React.forwardRef(({ children, onContactForce }: { children: React.ReactNode, onContactForce: (payload: ContactForceEvent) => void }, ref: React.Ref<unknown>) => {
        if (ref) {
            // @ts-expect-error This is a mock implementation
            ref.current = mockRigidBodyApi;
        }
        if (onContactForce) {
            onContactForceCallback = onContactForce;
        }
        return <div data-testid="rigidbody">{children}</div>;
    });
    RigidBodyMock.displayName = 'RigidBody';

    return {
        Physics: ({ children }: { children: React.ReactNode }) => <div data-testid="physics">{children}</div>,
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
        }
    }
});

jest.mock('maath/random', () => ({
  inSphere: jest.fn((buffer, { radius }) => {
    if(!buffer) return new Float32Array(0);
    const count = buffer.length / 3;
    const newBuffer = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) {
        newBuffer[i] = (Math.random() - 0.5) * 2 * radius;
    }
    return newBuffer;
  }),
}));

jest.mock('@use-gesture/react', () => ({
  useDrag: jest.fn((callback) => {
    return () => ({
      onMouseDown: (event: React.MouseEvent) => {
        callback({ active: true, xy: [event.clientX, event.clientY], velocity: [0,0], first: true, last: false });
      },
      onMouseUp: (event: React.MouseEvent) => {
        callback({ active: false, xy: [event.clientX, event.clientY], velocity: [1,1], first: false, last: true });
      }
    });
  }),
}));


jest.mock('next/link', () => {
    const MockLink = ({ children, href }: { children: React.ReactNode, href: string }) => {
        return <a href={href}>{children}</a>;
    };
    MockLink.displayName = 'MockLink';
    return MockLink;
})

// Mock three.js because JSDOM doesn't have a canvas
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
      setFromQuaternion() { return this; }
    },
    Quaternion: class {
      setFromEuler() {}
    },
  };
});

describe('HeartPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Suppress console errors for React warnings about casing
    jest.spyOn(console, 'error').mockImplementation((...args) => {
        const msg = args[0];
        if (typeof msg === 'string' && (
            msg.includes('incorrect casing') ||
            msg.includes('The tag <%s> is unrecognized') ||
            (args.length > 1 && (args[1] === 'ambientLight' || args[1] === 'directionalLight'))
        )) {
            return;
        }
        console.warn(...args); // fallback
    });

    const useThree = jest.requireMock('@react-three/fiber').useThree;
    useThree.mockReturnValue({
      size: { width: 800, height: 600 },
      viewport: { width: 10, height: 7.5 },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders the page without crashing', () => {
    render(<HeartPage />);
    expect(screen.getByText('Back Home')).toBeInTheDocument();
    expect(screen.getByText('Reset')).toBeInTheDocument();
  });

  it('handles reset button clicks', () => {
    const { rerender } = render(<HeartPage />);
    const resetButton = screen.getByText('Reset');
    fireEvent.click(resetButton);
    rerender(<HeartPage />);
    expect(screen.getByText('Back Home')).toBeInTheDocument();
  });

  it('responds to window resize', () => {
    render(<HeartPage />);
    global.innerWidth = 500;
    fireEvent(window, new Event('resize'));
    expect(screen.getByText('Back Home')).toBeInTheDocument();
  });

  it('should call onInteract when the heart is dragged', () => {
    render(<HeartPage />);
    const rigidBody = screen.getAllByTestId('rigidbody')[0];
    fireEvent.mouseDown(rigidBody);
  });

  it('renders Sparkles component with default number of points', () => {
    render(<HeartPage />);
    const points = screen.getByTestId('points');
    expect(points).toBeInTheDocument();
    // Default count is 200
    expect(points.dataset.positionsLength).toBe(String(200 * 3));
  });

  it('renders the Heart3D component with the names', () => {
    render(<HeartPage />);
    expect(screen.getAllByText('Abbi').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Fred').length).toBeGreaterThan(0);
  });

  it('breaks when colliding with force and reforms after a timeout', () => {
    jest.useFakeTimers();
    render(<HeartPage />);

    expect(onContactForceCallback).toBeDefined();

    act(() => {
        onContactForceCallback({ totalForceMagnitude: 300 });
    });

    expect(mockRigidBodyApi.setBodyType).toHaveBeenCalledWith(RigidBodyType.Fixed, true);

    act(() => {
        jest.advanceTimersByTime(3000);
    });

    expect(mockRigidBodyApi.setBodyType).toHaveBeenCalledWith(RigidBodyType.Dynamic, true);
    jest.useRealTimers();
  });

  it('renders the ScreenBounds component with four walls', () => {
    render(<HeartPage />);
    const colliders = screen.getAllByTestId('cuboid-collider');
    expect(colliders.length).toBe(4);
  });
});
