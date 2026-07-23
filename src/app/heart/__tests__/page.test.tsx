import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import HeartClient from '../HeartClient';
import { RigidBodyType } from '@dimforge/rapier3d-compat';
import { getAppConfig } from '@/lib/config';

import { ContactForceEvent } from '@react-three/rapier';

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
  __triggerContactForce: null as ((payload: ContactForceEvent) => void) | null,
});

const mockMainBodyApi = mockCreateRigidBodyApi();
const mockLeftBodyApi = mockCreateRigidBodyApi();
const mockRightBodyApi = mockCreateRigidBodyApi();

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
  const RigidBodyMock = React.forwardRef(({ children, onContactForce, userData }: { children: React.ReactNode, onContactForce: (payload: ContactForceEvent) => void, userData?: { id: string } }, ref: React.Ref<unknown>) => {
    if (ref) {
      // @ts-expect-error This is a mock implementation
      if (userData?.id === 'main') ref.current = mockMainBodyApi;
      // @ts-expect-error This is a mock implementation
      else if (userData?.id === 'left') ref.current = mockLeftBodyApi;
      // @ts-expect-error This is a mock implementation
      else if (userData?.id === 'right') ref.current = mockRightBodyApi;
    }
    if (onContactForce && userData?.id === 'main') {
      mockMainBodyApi.__triggerContactForce = onContactForce;
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
  };
});

jest.mock('next/link', () => {
  const MockLink = ({ children, href }: { children: React.ReactNode, href: string }) => {
    return <a href={href}>{children}</a>;
  };
  MockLink.displayName = 'MockLink';
  return MockLink;
});

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn(),
}));

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

const HeartPage = () => <HeartClient brideName="Abbi" groomName="Fred" />;

describe('HeartPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMainBodyApi.__triggerContactForce = null;
    const useThree = jest.requireMock('@react-three/fiber').useThree;
    useThree.mockReturnValue({
      size: { width: 800, height: 600 },
      viewport: { width: 10, height: 7.5 },
    });
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
    const group = screen.getAllByTestId('rigidbody')[0].querySelector('group') || screen.getAllByTestId('rigidbody')[0].firstChild;
    if (group) {
      fireEvent.pointerDown(group as Element, { clientX: 100, clientY: 100, pointerId: 1 });
    }
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

    expect(mockMainBodyApi.__triggerContactForce).not.toBeNull();

    act(() => {
      if (mockMainBodyApi.__triggerContactForce) {
        mockMainBodyApi.__triggerContactForce({ totalForceMagnitude: 300 } as ContactForceEvent);
      }
    });

    expect(mockMainBodyApi.setEnabled).toHaveBeenCalledWith(false);
    expect(mockLeftBodyApi.setEnabled).toHaveBeenCalledWith(true);
    expect(mockLeftBodyApi.setBodyType).toHaveBeenCalledWith(RigidBodyType.Dynamic, true);
    expect(mockRightBodyApi.setEnabled).toHaveBeenCalledWith(true);
    expect(mockRightBodyApi.setBodyType).toHaveBeenCalledWith(RigidBodyType.Dynamic, true);

    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(mockLeftBodyApi.setEnabled).toHaveBeenCalledWith(false);
    expect(mockLeftBodyApi.setBodyType).toHaveBeenCalledWith(RigidBodyType.Fixed, true);
    expect(mockRightBodyApi.setEnabled).toHaveBeenCalledWith(false);
    expect(mockRightBodyApi.setBodyType).toHaveBeenCalledWith(RigidBodyType.Fixed, true);

    expect(mockMainBodyApi.setEnabled).toHaveBeenCalledWith(true);
    expect(mockMainBodyApi.setBodyType).toHaveBeenCalledWith(RigidBodyType.Dynamic, true);
    jest.useRealTimers();
  });

  it('renders the ScreenBounds component with four walls', () => {
    render(<HeartPage />);
    const colliders = screen.getAllByTestId('cuboid-collider');
    // 4 walls + 1 main heart + 2 shards = 7 colliders
    expect(colliders.length).toBe(7);
  });

  it('should pass config names from getAppConfig to HeartClient', async () => {
    // Mock getAppConfig to return sentinel values
    const mockConfig = {
      brideName: 'SentinelA',
      groomName: 'SentinelB',
    };
    (getAppConfig as jest.Mock).mockResolvedValue(mockConfig);

    // Import the actual page component
    const HeartPageModule = await import('../page');
    const HeartPage = HeartPageModule.default;

    // Render the page component
    render(await HeartPage());

    // Verify sentinel names are rendered (which means they were passed to HeartClient)
    expect(screen.getAllByText('SentinelA').length).toBeGreaterThan(0);
    expect(screen.getAllByText('SentinelB').length).toBeGreaterThan(0);
  });
});
