import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import HeartClient from '../HeartClient';
import { HEART_FONT_URL } from '../constants';
import nextConfig from '../../../../next.config';
import { RigidBodyType } from '@dimforge/rapier3d-compat';
import { getAppConfig } from '@/lib/config';

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

let canvasMountCount = 0;

jest.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => {
    canvasMountCount += 1;
    return <div data-testid="canvas">{children}</div>;
  },
  useFrame: jest.fn(),
  useThree: jest.fn(() => ({
    size: { width: 800, height: 600 },
    viewport: { width: 10, height: 7.5 },
  })),
}));

jest.mock('@react-three/drei', () => ({
  Environment: ({
    children,
    frames,
    resolution,
    preset,
  }: {
    children?: React.ReactNode;
    frames?: number;
    resolution?: number;
    preset?: string;
  }) => (
    <div
      data-testid="environment"
      data-frames={frames}
      data-resolution={resolution}
      data-preset={preset}
    >
      {children}
    </div>
  ),
  Lightformer: ({
    form,
    color,
    intensity,
  }: {
    form?: string;
    color?: string;
    intensity?: number;
  }) => (
    <div
      data-testid="lightformer"
      data-form={form}
      data-color={color}
      data-intensity={intensity}
    />
  ),
  Html: ({ children }: { children: React.ReactNode }) => <div data-testid="html">{children}</div>,
  Text: ({ children, font }: { children: React.ReactNode; font?: string }) => (
    <div data-testid="text" data-font={font}>
      {children}
    </div>
  ),
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
  function RigidBodyMock({
    children,
    onContactForce,
    userData,
    ref,
  }: {
    children: React.ReactNode;
    onContactForce?: (payload: any) => void;
    userData?: { id: string };
    ref?: React.Ref<unknown>;
  }) {
    React.useEffect(() => {
      const targetApi =
        userData?.id === 'main'
          ? mockMainBodyApi
          : userData?.id === 'left'
            ? mockLeftBodyApi
            : userData?.id === 'right'
              ? mockRightBodyApi
              : undefined;

      if (ref && targetApi) {
        if (typeof ref === 'function') {
          ref(targetApi);
        } else {
          ref.current = targetApi;
        }
      }
      if (onContactForce && userData?.id === 'main') {
        mockMainBodyApi.__triggerContactForce = onContactForce;
      }
    }, [ref, onContactForce, userData?.id]);

    return <div data-testid="rigidbody">{children}</div>;
  }

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

const HeartPage = () => <HeartClient partner1Name="Abbi" partner2Name="Fred" brideName="Abbi" groomName="Fred" />;

describe('HeartPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    canvasMountCount = 0;
    delete (window as any).__mockWebGLSupport;
    delete (window as any).__mockFps;
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

  it('renders the Heart3D component with the names and includes 3D canvas text in accessible aria-label', () => {
    render(<HeartPage />);
    expect(screen.getAllByText('Abbi').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Fred').length).toBeGreaterThan(0);
    const wholeHeartBtn = screen.getByLabelText('Interactive 3D Heart: Abbi and Fred. Status: Whole.');
    expect(wholeHeartBtn).toBeInTheDocument();
    expect(wholeHeartBtn).toHaveAttribute('type', 'button');
  });

  it('breaks when colliding with force and reforms after a timeout', () => {
    jest.useFakeTimers();
    render(<HeartPage />);

    expect(mockMainBodyApi.__triggerContactForce).not.toBeNull();

    act(() => {
      if (mockMainBodyApi.__triggerContactForce) {
        mockMainBodyApi.__triggerContactForce({ totalForceMagnitude: 300 } as any);
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
      partner1Name: 'SentinelA',
      partner2Name: 'SentinelB',
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

  it('renders 2D vector fallback when WebGL support is missing/disabled with accessible markup', async () => {
    (window as any).__mockWebGLSupport = false;

    render(<HeartPage />);

    expect(canvasMountCount).toBe(0);
    expect(screen.queryByTestId('canvas')).not.toBeInTheDocument();
    expect(screen.getByTestId('webgl-fallback-container')).toBeInTheDocument();
    const fallbackHeart = screen.getByTestId('webgl-fallback-heart');
    expect(fallbackHeart).toBeInTheDocument();
    expect(fallbackHeart).toHaveAttribute('role', 'button');

    const svg = fallbackHeart.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('role', 'img');
    expect(svg?.getAttribute('class')).toContain('motion-reduce:animate-none');

    expect(screen.getByText('Abbi')).toBeInTheDocument();
    expect(screen.getByText('Fred')).toBeInTheDocument();

    delete (window as any).__mockWebGLSupport;
  });

  it('supports dragging and keyboard movement in 2D WebGL fallback with screen reader announcements', async () => {
    (window as any).__mockWebGLSupport = false;
    render(<HeartPage />);

    const fallbackHeart = await screen.findByTestId('webgl-fallback-heart');
    expect(fallbackHeart).toBeInTheDocument();

    const downEvent = new Event('pointerdown', { bubbles: true }) as any;
    downEvent.clientX = 100;
    downEvent.clientY = 100;
    downEvent.pointerId = 1;
    fireEvent(fallbackHeart, downEvent);

    const moveEvent = new Event('pointermove', { bubbles: true }) as any;
    moveEvent.clientX = 150;
    moveEvent.clientY = 120;
    moveEvent.pointerId = 1;
    fireEvent(fallbackHeart, moveEvent);

    const upEvent = new Event('pointerup', { bubbles: true }) as any;
    upEvent.pointerId = 1;
    fireEvent(fallbackHeart, upEvent);

    expect(fallbackHeart.style.transform).toBe('translate(50px, 20px)');

    fireEvent.keyDown(fallbackHeart, { key: 'ArrowDown' });
    expect(fallbackHeart.style.transform).toBe('translate(50px, 40px)');
    expect(screen.getByRole('status')).toHaveTextContent('Moved down');

    fireEvent.keyDown(fallbackHeart, { key: 'ArrowRight' });
    expect(fallbackHeart.style.transform).toBe('translate(70px, 40px)');
    expect(screen.getByRole('status')).toHaveTextContent('Moved right');

    delete (window as any).__mockWebGLSupport;
  });

  it('degrades visual quality tier when frame rate drops and recovers on reset', () => {
    let frameCallback: ((state: any, delta: number) => void) | null = null;
    const useFrameMock = jest.requireMock('@react-three/fiber').useFrame;
    useFrameMock.mockImplementation((cb: any) => {
      if (cb && (cb.toString().includes('lowFpsAccumulator') || cb.toString().includes('fps'))) {
        frameCallback = cb;
      }
    });

    render(<HeartPage />);

    expect(frameCallback).not.toBeNull();
    expect(screen.getByTestId('effect-composer')).toBeInTheDocument();
    expect(screen.getByTestId('points')).toBeInTheDocument();
    const initialEnvironment = screen.getByTestId('environment');
    expect(initialEnvironment).toHaveAttribute('data-frames', '1');
    expect(initialEnvironment).toHaveAttribute('data-resolution', '256');
    expect(initialEnvironment).not.toHaveAttribute('data-preset');
    expect(screen.getAllByTestId('lightformer').length).toBeGreaterThan(0);

    const mockState = {
      clock: {
        getElapsedTime: () => 0
      }
    };

    act(() => {
      if (frameCallback) {
        (window as any).__mockFps = 60;
        frameCallback(mockState, 0.016);
      }
    });

    expect(screen.getByTestId('effect-composer')).toBeInTheDocument();
    expect(screen.getByTestId('points')).toBeInTheDocument();

    act(() => {
      if (frameCallback) {
        (window as any).__mockFps = 20;
        frameCallback(mockState, 1.0);
        frameCallback(mockState, 1.0);
        frameCallback(mockState, 1.1);
      }
    });

    expect(screen.queryByTestId('effect-composer')).not.toBeInTheDocument();
    expect(screen.getByTestId('points')).toBeInTheDocument();

    act(() => {
      if (frameCallback) {
        (window as any).__mockFps = 20;
        frameCallback(mockState, 1.0);
        frameCallback(mockState, 1.0);
        frameCallback(mockState, 1.1);
      }
    });

    expect(screen.queryByTestId('effect-composer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('points')).not.toBeInTheDocument();
    expect(screen.queryByTestId('environment')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId('lightformer')).toHaveLength(0);

    const resetButton = screen.getByText('Reset');
    fireEvent.click(resetButton);

    expect(screen.getByTestId('effect-composer')).toBeInTheDocument();
    expect(screen.getByTestId('points')).toBeInTheDocument();
    expect(screen.getByTestId('environment')).toBeInTheDocument();

    delete (window as any).__mockFps;
    useFrameMock.mockReset();
  });

  describe('Focus Retention', () => {
    let rafSpy: jest.SpyInstance;

    beforeEach(() => {
      rafSpy = jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });
    });

    afterEach(() => {
      rafSpy.mockRestore();
    });

    it('retains focus and shifts to left shard button when whole heart is broken', async () => {
      render(<HeartPage />);
      
      const wholeHeartBtn = screen.getByLabelText(/Interactive 3D Heart/);
      expect(wholeHeartBtn).toBeInTheDocument();
      
      // Simulate user focusing the whole heart button
      act(() => {
        wholeHeartBtn.focus();
      });
      expect(document.activeElement).toBe(wholeHeartBtn);
      
      // Trigger shatter
      act(() => {
        fireEvent.click(wholeHeartBtn);
      });
      
      // Left shard button should now be focused
      const leftShardBtn = screen.getByLabelText(/Broken heart left segment/);
      expect(leftShardBtn).toBeInTheDocument();
      expect(document.activeElement).toBe(leftShardBtn);
    });

    it('retains focus and shifts back to whole heart when shard button reconstructs the heart', async () => {
      render(<HeartPage />);
      
      // First shatter it to get the shards
      const wholeHeartBtn = screen.getByLabelText(/Interactive 3D Heart/);
      act(() => {
        wholeHeartBtn.focus();
        fireEvent.click(wholeHeartBtn);
      });
      
      const leftShardBtn = screen.getByLabelText(/Broken heart left segment/);
      expect(leftShardBtn).toBeInTheDocument();
      expect(document.activeElement).toBe(leftShardBtn);
      
      // Now activate the shard button to reconstruct
      act(() => {
        fireEvent.click(leftShardBtn);
      });
      
      // Whole heart button should now be focused again
      const reconstructedBtn = screen.getByLabelText(/Interactive 3D Heart/);
      expect(reconstructedBtn).toBeInTheDocument();
      expect(document.activeElement).toBe(reconstructedBtn);
    });

    it('does not hijack focus during automatic/background physics transitions when user is focused elsewhere', async () => {
      render(<HeartPage />);
      
      // Focus on the reset button (some other element on the page)
      const resetButton = screen.getByText('Reset');
      act(() => {
        resetButton.focus();
      });
      expect(document.activeElement).toBe(resetButton);
      
      // Simulate background collision shatter
      act(() => {
        if (mockMainBodyApi.__triggerContactForce) {
          mockMainBodyApi.__triggerContactForce({ totalForceMagnitude: 300 } as any);
        }
      });
      
      // Left shard should be mounted, but activeElement must STILL be the reset button (not hijacked)
      const leftShardBtn = screen.getByLabelText(/Broken heart left segment/);
      expect(leftShardBtn).toBeInTheDocument();
      expect(document.activeElement).toBe(resetButton);
    });
  });

  describe('Accessible Canvas Easter Egg', () => {
    let physicsFrameCallback: ((state: any, delta: number) => void) | null = null;
    let useFrameMock: jest.Mock;

    const setupGroupMock = () => {
      document.querySelectorAll('group').forEach((el: any) => {
        if (!el.scale) {
          el.scale = { set: jest.fn() };
        }
      });
    };

    beforeEach(() => {
      physicsFrameCallback = null;
      useFrameMock = jest.requireMock('@react-three/fiber').useFrame;
      useFrameMock.mockImplementation((cb: any) => {
        if (cb && cb.toString().includes('secretSpot')) {
          physicsFrameCallback = cb;
        }
      });
    });

    afterEach(() => {
      useFrameMock.mockReset();
    });

    it('exposes accessible live region announcements, hidden DOM element, and updated button label when easter egg triggers', () => {
      render(<HeartPage />);
      setupGroupMock();

      expect(physicsFrameCallback).not.toBeNull();

      // Initially, whole heart state
      expect(screen.getByText('Heart is whole.')).toBeInTheDocument();
      expect(screen.getByLabelText('Interactive 3D Heart: Abbi and Fred. Status: Whole.')).toBeInTheDocument();

      const mockState = { clock: { getElapsedTime: () => 1.0 } };

      // Move into secret spot (viewport width 10, height 7.5. Thresholds: x > 3, y > 1.75)
      mockMainBodyApi.translation.mockReturnValue({ x: 4, y: 2, z: 0 });
      act(() => {
        if (physicsFrameCallback) {
          physicsFrameCallback(mockState, 0.016);
        }
      });

      // 1. Live region announces secret message
      const liveRegion = screen.getByRole('status');
      expect(liveRegion).toHaveTextContent('I love you!');

      // 2. Hidden accessible DOM element in overlay
      const secretDomNodes = screen.getAllByText('I love you!');
      expect(secretDomNodes.length).toBeGreaterThanOrEqual(1);

      // 3. Whole heart button aria-label includes secret message status
      const wholeHeartBtn = screen.getByLabelText('Interactive 3D Heart: Abbi and Fred. Status: Whole. Secret message revealed: I love you!');
      expect(wholeHeartBtn).toBeInTheDocument();

      // 4. When leaving secret coordinates, reverts cleanly
      mockMainBodyApi.translation.mockReturnValue({ x: 0, y: 0, z: 0 });
      act(() => {
        if (physicsFrameCallback) {
          physicsFrameCallback(mockState, 0.016);
        }
      });

      expect(screen.getByText('Heart is whole.')).toBeInTheDocument();
      expect(screen.queryByLabelText('Interactive 3D Heart: Abbi and Fred. Status: Whole. Secret message revealed: I love you!')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Interactive 3D Heart: Abbi and Fred. Status: Whole.')).toBeInTheDocument();
    });

    it('does not override the broken state announcement in the live region when the heart breaks', () => {
      render(<HeartPage />);
      setupGroupMock();

      expect(physicsFrameCallback).not.toBeNull();

      const mockState = { clock: { getElapsedTime: () => 1.0 } };

      // Trigger easter egg first
      mockMainBodyApi.translation.mockReturnValue({ x: 4, y: 2, z: 0 });
      act(() => {
        if (physicsFrameCallback) {
          physicsFrameCallback(mockState, 0.016);
        }
      });

      const liveRegion = screen.getByRole('status');
      expect(liveRegion).toHaveTextContent('I love you!');

      // Now break the heart via collision force
      act(() => {
        if (mockMainBodyApi.__triggerContactForce) {
          mockMainBodyApi.__triggerContactForce({ totalForceMagnitude: 300 } as any);
        }
      });

      // Broken state must NOT be overridden by easter egg
      expect(liveRegion).toHaveTextContent('Heart is broken.');
    });

    it('appends secret message to wholeHeartLabel when no partner names are provided', () => {
      render(<HeartClient />);
      setupGroupMock();

      expect(physicsFrameCallback).not.toBeNull();

      const mockState = { clock: { getElapsedTime: () => 1.0 } };

      expect(screen.getByLabelText('Interactive 3D Heart. Status: Whole.')).toBeInTheDocument();

      mockMainBodyApi.translation.mockReturnValue({ x: 4, y: 2, z: 0 });
      act(() => {
        if (physicsFrameCallback) {
          physicsFrameCallback(mockState, 0.016);
        }
      });

      expect(screen.getByLabelText('Interactive 3D Heart. Status: Whole. Secret message revealed: I love you!')).toBeInTheDocument();
    });
  });

  it('passes HEART_FONT_URL to all partner Text meshes and allows blob: workers in next.config.ts CSP', async () => {
    render(<HeartPage />);

    const textMeshes = screen.getAllByTestId('text');
    expect(textMeshes.length).toBeGreaterThanOrEqual(2);
    for (const mesh of textMeshes) {
      expect(mesh).toHaveAttribute('data-font', HEART_FONT_URL);
    }

    expect(typeof nextConfig.headers).toBe('function');
    const routeHeaders = await nextConfig.headers!();
    const globalRule = routeHeaders.find((entry) => entry.source === '/(.*)');
    expect(globalRule).toBeDefined();
    const cspHeader = globalRule?.headers.find((h) => h.key === 'Content-Security-Policy');
    expect(cspHeader?.value).toContain("worker-src 'self' blob:");
    expect(cspHeader?.value).toMatch(/script-src[^;]*\bblob:/);
  });
});
