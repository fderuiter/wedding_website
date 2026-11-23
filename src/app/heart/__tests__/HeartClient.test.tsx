import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import HeartClient, { isWebGLAvailable } from '../HeartClient';
import { HEART_FONT_URL, resolveHeartFontUrl } from '../constants';

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
let canvasRenderCount = 0;
let pendingPhysicsPromise: Promise<void> | null = null;

jest.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => {
    canvasRenderCount += 1;
    return <div data-testid="canvas">{children}</div>;
  },
  useFrame: (cb: (state: any, delta: number) => void) => {
    frameCallbacks.push(cb);
  },
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
  Html: ({ children }: { children: React.ReactNode }) => <div data-testid="html-overlay">{children}</div>,
  Text: ({ children, font }: { children: React.ReactNode; font?: string }) => (
    <div data-testid="webgl-text" data-font={font}>
      {children}
    </div>
  ),
  Points: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PointMaterial: () => null,
}));

jest.mock('@react-three/postprocessing', () => ({
  EffectComposer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
    Physics: ({ children }: { children: React.ReactNode }) => {
      if (pendingPhysicsPromise) {
        throw pendingPhysicsPromise;
      }
      return <div>{children}</div>;
    },
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
    canvasRenderCount = 0;
    pendingPhysicsPromise = null;
    delete (window as Window & { __mockWebGLSupport?: boolean }).__mockWebGLSupport;
    delete (window as Window & { WebGL2RenderingContext?: unknown }).WebGL2RenderingContext;
    frameCallbacks.length = 0;
    mockMainBodyApi.__triggerContactForce = null;
    mockMainBodyApi.translation.mockReturnValue({ x: 0, y: 0, z: 0 });
    mockMainBodyApi.rotation.mockReturnValue({ x: 0, y: 0, z: 0, w: 1 });
  });

  it('renders initial live region with "Heart is whole." and does not render easter egg DOM node', () => {
    render(<HeartClient partner1Name="Abbi" partner2Name="Fred" />);

    expect(
      screen.getByRole('heading', { level: 1, name: /Interactive 3D Heart — Abbi & Fred/i })
    ).toBeInTheDocument();

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

  it('passes local bundled WOFF font URL to partner and easter egg Text meshes and normalizes NEXT_PUBLIC_BASE_PATH', () => {
    render(<HeartClient partner1Name="Abbi" partner2Name="Fred" />);

    expect(HEART_FONT_URL).toMatch(/\.woff$/);
    expect(HEART_FONT_URL).not.toMatch(/https?:\/\//);

    const fontDiskPath = path.join(
      process.cwd(),
      'public',
      HEART_FONT_URL.replace(/^\/+/, ''),
    );
    expect(fs.existsSync(fontDiskPath)).toBe(true);
    const header = fs.readFileSync(fontDiskPath).subarray(0, 4).toString('ascii');
    expect(header).toBe('wOFF');

    const partnerTexts = screen.getAllByTestId('webgl-text');
    expect(partnerTexts.length).toBeGreaterThanOrEqual(2);
    for (const node of partnerTexts) {
      expect(node).toHaveAttribute('data-font', HEART_FONT_URL);
    }

    // Reveal easter egg and check its Text font prop
    mockMainBodyApi.translation.mockReturnValue({ x: 4, y: 2.5, z: 0 });
    advancePhysicsFrame();

    const easterEggMesh = screen
      .getAllByTestId('webgl-text')
      .find((node) => node.textContent?.includes('I love you!'));
    expect(easterEggMesh).toBeDefined();
    expect(easterEggMesh).toHaveAttribute('data-font', HEART_FONT_URL);

    // Verify subpath normalization parity with next.config.ts
    expect(resolveHeartFontUrl(undefined)).toBe('/fonts/noto-sans-latin-400-normal.woff');
    expect(resolveHeartFontUrl('')).toBe('/fonts/noto-sans-latin-400-normal.woff');
    expect(resolveHeartFontUrl('/')).toBe('/fonts/noto-sans-latin-400-normal.woff');
    expect(resolveHeartFontUrl('/wedding_website/demo')).toBe(
      '/wedding_website/demo/fonts/noto-sans-latin-400-normal.woff',
    );
    expect(resolveHeartFontUrl('wedding_website/demo/')).toBe(
      '/wedding_website/demo/fonts/noto-sans-latin-400-normal.woff',
    );
  });

  it('uses procedural Lightformer Environment without remote HDRI preset', () => {
    render(<HeartClient partner1Name="Abbi" partner2Name="Fred" />);

    const env = screen.getByTestId('environment');
    expect(env).toHaveAttribute('data-frames', '1');
    expect(env).toHaveAttribute('data-resolution', '256');
    expect(env).not.toHaveAttribute('data-preset');

    const lightformers = screen.getAllByTestId('lightformer');
    expect(lightformers.length).toBeGreaterThanOrEqual(3);
  });

  it('renders plain DOM Loading… overlay outside Canvas without role="status" while Suspense is pending', async () => {
    let resolvePhysics!: () => void;
    pendingPhysicsPromise = new Promise<void>((resolve) => {
      resolvePhysics = () => {
        pendingPhysicsPromise = null;
        resolve();
      };
    });

    await act(async () => {
      render(<HeartClient partner1Name="Abbi" partner2Name="Fred" />);
    });

    const loader = screen.getByTestId('heart-loading-overlay');
    const canvas = screen.getByTestId('canvas');
    expect(loader).toHaveTextContent('Loading…');
    expect(canvas.contains(loader)).toBe(false);
    expect(loader).not.toHaveAttribute('role');
    expect(screen.queryAllByRole('status')).toHaveLength(0);

    await act(async () => {
      resolvePhysics();
      await Promise.resolve();
    });

    expect(screen.queryByTestId('heart-loading-overlay')).not.toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('gates Canvas mounting synchronously on WebGL 2 and falls back when only WebGL 1 is available', () => {
    const getContextSpy = jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(((contextId: string) => {
        if (contextId === 'webgl') {
          return {} as WebGLRenderingContext;
        }
        return null;
      }) as typeof HTMLCanvasElement.prototype.getContext);

    Object.defineProperty(window, 'WebGL2RenderingContext', {
      value: class MockWebGL2RenderingContext {},
      configurable: true,
      writable: true,
    });

    expect(isWebGLAvailable()).toBe(false);

    render(<HeartClient partner1Name="Abbi" partner2Name="Fred" />);

    expect(canvasRenderCount).toBe(0);
    expect(screen.queryByTestId('canvas')).not.toBeInTheDocument();
    expect(screen.getByTestId('webgl-fallback-container')).toBeInTheDocument();

    const loseContext = jest.fn();
    getContextSpy.mockImplementation(((contextId: string) => {
      if (contextId === 'webgl2') {
        return {
          getExtension: (name: string) =>
            name === 'WEBGL_lose_context' ? { loseContext } : null,
        } as unknown as WebGL2RenderingContext;
      }
      return null;
    }) as typeof HTMLCanvasElement.prototype.getContext);

    expect(isWebGLAvailable()).toBe(true);
    expect(loseContext).toHaveBeenCalledTimes(1);

    getContextSpy.mockRestore();
    delete (window as Window & { WebGL2RenderingContext?: unknown }).WebGL2RenderingContext;
  });
});
