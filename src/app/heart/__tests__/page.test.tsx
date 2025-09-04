import React from 'react'
import { render, screen, act } from '@testing-library/react'
import '@testing-library/jest-dom'
import HeartPage from '../page'

const mockSetTranslation = jest.fn()
const mockSetLinvel = jest.fn()
const mockSetAngvel = jest.fn()
const mockApplyImpulse = jest.fn()
const mockApplyTorqueImpulse = jest.fn()
const mockSetBodyType = jest.fn()
const mockSetNextKinematicTranslation = jest.fn()

const mockSetScale = jest.fn()

const mockHeartRef = {
  current: {
    setTranslation: mockSetTranslation,
    setLinvel: mockSetLinvel,
    setAngvel: mockSetAngvel,
    applyImpulse: mockApplyImpulse,
    applyTorqueImpulse: mockApplyTorqueImpulse,
    setBodyType: mockSetBodyType,
    setNextKinematicTranslation: mockSetNextKinematicTranslation,
    translation: () => ({ x: 0, y: 0, z: 0 }),
    rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
    setRotation: jest.fn(),
    scale: {
      set: mockSetScale,
    },
  },
}

jest.mock('@react-three/fiber', () => ({
  ...jest.requireActual('@react-three/fiber'),
  useThree: () => ({
    size: { width: 1024, height: 768 },
    viewport: { width: 10, height: 7.5 },
  }),
  useFrame: () => {},
  Canvas: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@react-three/rapier', () => ({
  ...jest.requireActual('@react-three/rapier'),
  Physics: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  RigidBody: React.forwardRef(function RigidBody({ children, onContactForce, colliders }, ref) {
    React.useImperativeHandle(ref, () => mockHeartRef.current)
    if (onContactForce) {
      // @ts-expect-error - The component is a mock and doesn't have the correct types
      return <div data-testid="physics-heart-rigidbody" data-colliders={colliders} onClick={() => onContactForce({ totalForceMagnitude: 300 })}>{children}</div>
    }
    // @ts-expect-error - The component is a mock and doesn't have the correct types
    return <div data-colliders={colliders}>{children}</div>
  }),
  CuboidCollider: () => <div />,
}))

let useDragCallback: (state: { active: boolean; first: boolean; last: boolean; xy: [number, number]; velocity: [number, number] }) => void
jest.mock('@use-gesture/react', () => ({
  useDrag: (callback: (state: { active: boolean; first: boolean; last: boolean; xy: [number, number]; velocity: [number, number] }) => void) => {
    useDragCallback = callback
    return (props: React.HTMLAttributes<HTMLDivElement>) => props
  },
}))

jest.mock('@react-three/drei', () => ({
  ...jest.requireActual('@react-three/drei'),
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Sparkles: () => <div data-testid="sparkles" />,
  Environment: () => <div />,
  PointMaterial: () => null,
  Points: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@react-three/postprocessing', () => ({
  EffectComposer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bloom: () => null,
}))


describe('HeartPage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('renders the Reset and Back Home buttons', () => {
    render(<HeartPage />)
    expect(screen.getByRole('button', { name: 'Reset heart' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back Home' })).toBeInTheDocument()
  })

  it('resets the heart position after breaking', () => {
    const { getByTestId, queryByTestId } = render(<HeartPage />)

    // Simulate a hard collision
    act(() => {
      screen.getByTestId('physics-heart-rigidbody').click()
    })

    // The heart should be "broken" (the main collider is not rendered)
    expect(queryByTestId('physics-heart-rigidbody')).toBeNull()

    // Fast-forward time by 3 seconds
    act(() => {
      jest.advanceTimersByTime(3000)
    })

    // The heart should be reformed
    expect(getByTestId('physics-heart-rigidbody')).toBeInTheDocument()

    // And its state should be reset
    expect(mockSetTranslation).toHaveBeenCalledWith({ x: 0, y: 0, z: 0 }, true)
    expect(mockSetLinvel).toHaveBeenCalledWith({ x: 0, y: 0, z: 0 }, true)
    expect(mockSetAngvel).toHaveBeenCalledWith({ x: 0, y: 0, z: 0 }, true)
  })

  it('handles drag events', () => {
    render(<HeartPage />)

    // Simulate drag start
    act(() => {
      useDragCallback({
        active: true,
        first: true,
        last: false,
        xy: [0, 0],
        velocity: [0, 0],
      })
    })

    expect(mockSetBodyType).toHaveBeenCalledWith(2, true) // 2 is KinematicPositionBased

    // Simulate drag end
    act(() => {
      useDragCallback({
        active: false,
        last: true,
        first: false,
        xy: [0, 0],
        velocity: [1, 1],
      })
    })

    expect(mockSetBodyType).toHaveBeenCalledWith(0, true) // 0 is Dynamic
    expect(mockApplyImpulse).toHaveBeenCalled()
    expect(mockApplyTorqueImpulse).toHaveBeenCalled()
  })

  it('renders RigidBody with hull collider', () => {
    render(<HeartPage />)
    expect(screen.getByTestId('physics-heart-rigidbody')).toHaveAttribute('data-colliders', 'hull')
  })
})
