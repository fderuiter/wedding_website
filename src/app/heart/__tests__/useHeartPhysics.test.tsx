import React from 'react';
import { render } from '@testing-library/react';
import * as THREE from 'three';
import { useHeartPhysics } from '../hooks/useHeartPhysics';
import { PHYSICS_CONSTANTS } from '../constants';

let frameCallback: ((state: any, delta: number) => void) | null = null;

jest.mock('@react-three/fiber', () => ({
  useFrame: (cb: any) => {
    frameCallback = cb;
  },
}));

describe('useHeartPhysics Hook', () => {
  let mockMainRb: any;
  let mockLeftRb: any;
  let mockRightRb: any;
  let mockGroup: any;
  let setShowEasterEgg: jest.Mock;
  let breakHeart: jest.Mock;

  const createMockRb = () => ({
    translation: jest.fn(() => ({ x: 0, y: 0, z: 0 })),
    rotation: jest.fn(() => ({ x: 0, y: 0, z: 0, w: 1 })),
    linvel: jest.fn(() => ({ x: 0, y: 0, z: 0 })),
    angvel: jest.fn(() => ({ x: 0, y: 0, z: 0 })),
    setRotation: jest.fn(),
    addForce: jest.fn(),
    setTranslation: jest.fn(),
    setLinvel: jest.fn(),
    setAngvel: jest.fn(),
    setEnabled: jest.fn(),
    setBodyType: jest.fn(),
    applyImpulse: jest.fn(),
    applyTorqueImpulse: jest.fn(),
  });

  beforeEach(() => {
    frameCallback = null;
    setShowEasterEgg = jest.fn();
    breakHeart = jest.fn();

    mockMainRb = createMockRb();
    mockLeftRb = createMockRb();
    mockRightRb = createMockRb();
    mockGroup = {
      scale: {
        set: jest.fn(),
      },
    };
  });

  function TestComponent({ interacted = false, reduceMotion = false, isBroken = false }) {
    useHeartPhysics({
      mainRbRef: { current: mockMainRb },
      leftRbRef: { current: mockLeftRb },
      rightRbRef: { current: mockRightRb },
      groupRef: { current: mockGroup },
      isBroken,
      reduceMotion,
      interacted,
      viewportWidth: 10,
      viewportHeight: 7.5,
      pulseSpeed: 1.5,
      breakHeart,
      setShowEasterEgg,
    });
    return null;
  }

  it('updates idle rotation on each frame using static singletons without new allocations', () => {
    render(<TestComponent interacted={false} reduceMotion={false} />);
    expect(frameCallback).not.toBeNull();

    const mockState = { clock: { getElapsedTime: () => 1.0 } };
    frameCallback!(mockState, 0.016);

    expect(mockMainRb.setRotation).toHaveBeenCalledTimes(1);
    const passedRotation = mockMainRb.setRotation.mock.calls[0][0];
    expect(passedRotation).toBeInstanceOf(THREE.Quaternion);

    const expectedEuler = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(0, 0, 0, 1));
    expectedEuler.y += PHYSICS_CONSTANTS.IDLE_ROTATION_SPEED;
    const expectedQuat = new THREE.Quaternion().setFromEuler(expectedEuler);

    expect(passedRotation.x).toBeCloseTo(expectedQuat.x, 5);
    expect(passedRotation.y).toBeCloseTo(expectedQuat.y, 5);
    expect(passedRotation.z).toBeCloseTo(expectedQuat.z, 5);
    expect(passedRotation.w).toBeCloseTo(expectedQuat.w, 5);
  });

  it('computes return force correctly using static vector singleton when interacted', () => {
    mockMainRb.translation.mockReturnValue({ x: 3, y: 4, z: 0 });
    render(<TestComponent interacted={true} reduceMotion={false} />);

    const mockState = { clock: { getElapsedTime: () => 1.0 } };
    frameCallback!(mockState, 0.016);

    expect(mockMainRb.addForce).toHaveBeenCalledTimes(1);
    const passedForce = mockMainRb.addForce.mock.calls[0][0];
    expect(passedForce).toBeInstanceOf(THREE.Vector3);

    // Vector from (3,4,0) towards origin is (-3, -4, 0). Length = 5. Normalized = (-0.6, -0.8, 0).
    const expectedX = -0.6 * PHYSICS_CONSTANTS.RETURN_FORCE_MULTIPLIER;
    const expectedY = -0.8 * PHYSICS_CONSTANTS.RETURN_FORCE_MULTIPLIER;

    expect(passedForce.x).toBeCloseTo(expectedX, 5);
    expect(passedForce.y).toBeCloseTo(expectedY, 5);
    expect(passedForce.z).toBeCloseTo(0, 5);
  });

  it('triggers easter egg when position is inside secret spot using primitive calculation', () => {
    // Secret spot threshold: x > 10/2 - 2 = 3, y > 7.5/2 - 2 = 1.75
    mockMainRb.translation.mockReturnValue({ x: 4, y: 2, z: 0 });
    render(<TestComponent interacted={false} reduceMotion={false} />);

    const mockState = { clock: { getElapsedTime: () => 1.0 } };
    frameCallback!(mockState, 0.016);

    expect(setShowEasterEgg).toHaveBeenCalledWith(true);
  });
});
