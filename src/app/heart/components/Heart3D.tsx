import { useMemo } from 'react'
import * as THREE from 'three'
import { Text } from '@react-three/drei'
import { theme } from '../../../styles/theme'

export function Heart3D({ scale, primaryColor, secondaryColor, brideName, groomName, shardSide }: { scale: number; primaryColor: string; secondaryColor: string; brideName: string; groomName: string; shardSide?: 'left' | 'right' }) {
  const geom = useMemo(() => {
    const s = new THREE.Shape()
    s.moveTo(0, -1.4)
    s.bezierCurveTo(-1.6, -3.2, -4, -0.8, 0, 2.5)
    s.bezierCurveTo(4, -0.8, 1.6, -3.2, 0, -1.4)
    const g = new THREE.ExtrudeGeometry(s, {
      depth: 1.3,
      bevelEnabled: true,
      bevelSegments: 4,
      bevelThickness: 0.25,
      bevelSize: 0.18,
    })
    g.center()
    return g
  }, [])

  const planeLeft = useMemo(() => new THREE.Plane(new THREE.Vector3(1, 0, 0), 0), [])
  const planeRight = useMemo(() => new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0), [])

  const gold = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: primaryColor,
        metalness: 1,
        roughness: 0.2,
        envMapIntensity: 1.2,
        clippingPlanes: [planeLeft],
        clipShadows: true,
      }),
    [planeLeft, primaryColor],
  )

  const silver = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: secondaryColor,
        metalness: 1,
        roughness: 0.25,
        envMapIntensity: 1.2,
        clippingPlanes: [planeRight],
        clipShadows: true,
      }),
    [planeRight, secondaryColor],
  )

  return (
    <group scale={scale} rotation={[0, Math.PI, Math.PI]}>
      {(!shardSide || shardSide === 'left') && <mesh geometry={geom} material={gold} />}
      {(!shardSide || shardSide === 'right') && <mesh geometry={geom} material={silver} />}
      {(!shardSide || shardSide === 'left') && (
        <Text
          position={[-1, 0.1, 0.71]}
          fontSize={0.35}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.015}
          outlineColor={theme.colors.outline}
        >
          {brideName}
        </Text>
      )}
      {(!shardSide || shardSide === 'right') && (
        <Text
          position={[1, 0.1, 0.71]}
          fontSize={0.35}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.015}
          outlineColor={theme.colors.outline}
        >
          {groomName}
        </Text>
      )}
    </group>
  )
}
