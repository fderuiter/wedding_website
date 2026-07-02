import { useThree } from '@react-three/fiber'
import { RigidBody, CuboidCollider } from '@react-three/rapier'

export function ScreenBounds() {
  const { viewport } = useThree()
  return (
    <RigidBody type="fixed" restitution={0.9}>
      <CuboidCollider args={[viewport.width / 2, 1, 10]} position={[0, -viewport.height / 2 - 1, 0]} />
      <CuboidCollider args={[viewport.width / 2, 1, 10]} position={[0, viewport.height / 2 + 1, 0]} />
      <CuboidCollider args={[1, viewport.height / 2, 10]} position={[-viewport.width / 2 - 1, 0, 0]} />
      <CuboidCollider args={[1, viewport.height / 2, 10]} position={[viewport.width / 2 + 1, 0, 0]} />
    </RigidBody>
  )
}
