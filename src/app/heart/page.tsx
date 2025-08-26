'use client'

import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Html, Text, Points, PointMaterial } from '@react-three/drei'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import * as THREE from 'three'
import React, { Suspense, useMemo, useRef, useState, useEffect } from 'react'
import Link from 'next/link'
import { Physics, RigidBody, CuboidCollider, RapierRigidBody } from '@react-three/rapier'
import { inSphere } from 'maath/random'
import { useDrag } from '@use-gesture/react'
import { RigidBodyType } from '@dimforge/rapier3d-compat'

function Sparkles({ count = 200 }) {
  const pointsRef = useRef<THREE.Points>(null!)
  const positions = useMemo(
    () => inSphere(new Float32Array(count * 3), { radius: 10 }) as Float32Array,
    [count],
  )

  useFrame(() => {
    if (pointsRef.current) {
      pointsRef.current.rotation.y += 0.001
    }
  })

  return (
    <Points ref={pointsRef} positions={positions} stride={3} frustumCulled={false}>
      <PointMaterial transparent color="#ffa0e0" size={0.1} sizeAttenuation={true} depthWrite={false} />
    </Points>
  )
}

function Heart3D({ scale }: { scale: number }) {
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
        color: '#FFD700',
        metalness: 1,
        roughness: 0.2,
        envMapIntensity: 1.2,
        clippingPlanes: [planeLeft],
        clipShadows: true,
      }),
    [planeLeft],
  )

  const silver = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: '#C0C0C0',
        metalness: 1,
        roughness: 0.25,
        envMapIntensity: 1.2,
        clippingPlanes: [planeRight],
        clipShadows: true,
      }),
    [planeRight],
  )

  return (
    <group scale={scale} rotation={[0, Math.PI, Math.PI]}>
      <mesh geometry={geom} material={gold} />
      <mesh geometry={geom} material={silver} />
      <Text
        position={[-1, 0.1, 0.71]}
        fontSize={0.35}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.015}
        outlineColor="#000"
      >
        Abbi
      </Text>
      <Text
        position={[1, 0.1, 0.71]}
        fontSize={0.35}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.015}
        outlineColor="#000"
      >
        Fred
      </Text>
    </group>
  )
}

function PhysicsHeart({
  scale,
  interacted,
  onInteract,
}: {
  scale: number
  interacted: boolean
  onInteract: () => void
}) {
  const heartRef = useRef<RapierRigidBody>(null!)
  const groupRef = useRef<THREE.Group>(null!)
  const [pulseSpeed, setPulseSpeed] = useState(1)
  const { size, viewport } = useThree()

  useFrame((state) => {
    if (heartRef.current) {
      if (!interacted) {
        const rotation = heartRef.current.rotation()
        const euler = new THREE.Euler().setFromQuaternion(
          new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
        )
        euler.y += 0.002
        heartRef.current.setRotation(new THREE.Quaternion().setFromEuler(euler), true)
      } else {
        const position = heartRef.current.translation()
        const distance = Math.sqrt(position.x ** 2 + position.y ** 2)
        if (distance > 0.1) {
          const force = new THREE.Vector3(-position.x, -position.y, 0).normalize().multiplyScalar(15)
          heartRef.current.addForce(force, true)
        } else {
          heartRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true)
        }
      }
    }

    const t = state.clock.getElapsedTime()
    const pulseScale = 1 + Math.sin(t * pulseSpeed) * 0.05
    if (groupRef.current) {
      groupRef.current.scale.set(pulseScale, pulseScale, pulseScale)
    }
  })

  const bind = useDrag(
    ({ active, xy: [sx, sy], velocity: [vx, vy], first, last }) => {
      if (first) {
        if (!interacted) onInteract()
        setPulseSpeed(5)
        heartRef.current?.setBodyType(RigidBodyType.KinematicPositionBased, true)
      }

      if (active && heartRef.current) {
        const x = (sx / size.width) * viewport.width - viewport.width / 2
        const y = -(sy / size.height) * viewport.height + viewport.height / 2
        heartRef.current.setNextKinematicTranslation({
          x: x,
          y: y,
          z: heartRef.current.translation().z,
        })
      }

      if (last) {
        setPulseSpeed(1)
        if (heartRef.current) {
          heartRef.current.setBodyType(RigidBodyType.Dynamic, true)
          const impulseStrength = 50
          heartRef.current.applyImpulse({ x: vx * impulseStrength, y: -vy * impulseStrength, z: 0 }, true)
          const torqueStrength = 20
          heartRef.current.applyTorqueImpulse(
            {
              x: (Math.random() - 0.5) * torqueStrength,
              y: (Math.random() - 0.5) * torqueStrength,
              z: (Math.random() - 0.5) * torqueStrength,
            },
            true,
          )
        }
      }
    },
  )

  return (
    <RigidBody ref={heartRef} colliders="hull" restitution={0.9}>
      {/* eslint-disable-next-line @typescript-eslint/ban-ts-comment */}
      {/* @ts-ignore */}
      <group ref={groupRef} {...bind()}>
        <Heart3D scale={scale} />
      </group>
    </RigidBody>
  )
}

function ScreenBounds() {
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

export default function HeartPage() {
  const [interacted, setInteracted] = useState(false)
  const [scale, setScale] = useState(0.6)

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768
      setScale(mobile ? 0.4 : 0.6)
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return (
    <div className="fixed inset-0 bg-black select-none">
      <Link href="/" className="absolute top-0 right-0 z-10 m-4 rounded bg-white/80 px-3 py-1 text-sm hover:bg-white">
        Back Home
      </Link>
      <Canvas camera={{ position: [0, 0, 15], fov: 50 }} dpr={[1, 2]}>
        <ambientLight intensity={0.8} />
        <directionalLight position={[5, 8, 5]} intensity={1.6} />
        <Suspense fallback={<Html>Loading…</Html>}>
          <Physics gravity={[0, 0, 0]}>
            <Sparkles />
            <Environment preset="sunset" />
            <PhysicsHeart scale={scale} interacted={interacted} onInteract={() => setInteracted(true)} />
            <ScreenBounds />
          </Physics>
          <EffectComposer>
            <Bloom mipmapBlur intensity={0.5} luminanceThreshold={0.35} luminanceSmoothing={0.9} />
          </EffectComposer>
        </Suspense>
      </Canvas>
    </div>
  )
}

