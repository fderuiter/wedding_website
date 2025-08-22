'use client'

import { Canvas, useFrame } from '@react-three/fiber'
import { Environment, Html, Text, Points, PointMaterial } from '@react-three/drei'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import * as THREE from 'three'
import React, { Suspense, useMemo, useRef, useState, useEffect } from 'react'
import Link from 'next/link'
import { SketchPicker } from 'react-color'
import { Physics, RigidBody, CuboidCollider } from '@react-three/rapier'
import { inSphere } from 'maath/random'

function Sparkles({ count = 200 }) {
  const pointsRef = useRef<any>()
  const positions = useMemo(() => inSphere(new Float32Array(count * 3), { radius: 10 }), [count])

  useFrame((state) => {
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

function Heart3D({
  scale,
  colors,
  materials,
}: {
  scale: number
  colors: [string, string]
  materials: [{ metalness: number; roughness: number }, { metalness: number; roughness: number }]
}) {
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
        color: colors[0],
        metalness: materials[0].metalness,
        roughness: materials[0].roughness,
        envMapIntensity: 1.2,
        clippingPlanes: [planeLeft],
        clipShadows: true,
      }),
    [planeLeft, colors, materials],
  )

  const silver = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: colors[1],
        metalness: materials[1].metalness,
        roughness: materials[1].roughness,
        envMapIntensity: 1.2,
        clippingPlanes: [planeRight],
        clipShadows: true,
      }),
    [planeRight, colors, materials],
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
  colors,
  materials,
  interacted,
  onInteract,
}: {
  scale: number
  colors: [string, string]
  materials: [{ metalness: number; roughness: number }, { metalness: number; roughness: number }]
  interacted: boolean
  onInteract: () => void
}) {
  const heartRef = useRef<any>(null!)
  const groupRef = useRef<THREE.Group>(null!)
  const [pulseSpeed, setPulseSpeed] = useState(1)

  useFrame((state) => {
    if (heartRef.current && !interacted) {
      const rotation = new THREE.Quaternion().setFromEuler(heartRef.current.rotation())
      const euler = new THREE.Euler().setFromQuaternion(rotation)
      euler.y += 0.002
      heartRef.current.setRotation(euler, true)
    }

    const t = state.clock.getElapsedTime()
    const pulseScale = 1 + Math.sin(t * pulseSpeed) * 0.05
    if (groupRef.current) {
      groupRef.current.scale.set(pulseScale, pulseScale, pulseScale)
    }
  })

  const handleClick = () => {
    if (!interacted) {
      onInteract()
    }
    if (heartRef.current) {
      const position = heartRef.current.translation()
      const impulse = {
        x: -position.x * 2,
        y: 5,
        z: -position.z * 2,
      }
      heartRef.current.applyImpulse(impulse, true)
    }
    setPulseSpeed(5)
    setTimeout(() => setPulseSpeed(1), 500)
  }

  return (
    <RigidBody ref={heartRef} colliders="hull" restitution={0.7} gravityScale={interacted ? 1 : 0}>
      <group ref={groupRef} onClick={handleClick}>
        <Heart3D scale={scale} colors={colors} materials={materials} />
      </group>
    </RigidBody>
  )
}

export default function HeartPage() {
  const [interacted, setInteracted] = useState(false)
  const [scale, setScale] = useState(0.6)
  const [colorA, setColorA] = useState('#FFD700')
  const [colorB, setColorB] = useState('#C0C0C0')
  const [materialA, setMaterialA] = useState({ metalness: 1, roughness: 0.2 })
  const [materialB, setMaterialB] = useState({ metalness: 1, roughness: 0.25 })

  useEffect(() => {
    const handleResize = () => {
      const newScale = window.innerWidth < 768 ? 0.4 : 0.6
      setScale(newScale)
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return (
    <div className="fixed inset-0 bg-black select-none">
      <div className="absolute top-0 left-0 z-10 p-4 space-y-4 max-h-screen overflow-y-auto">
        <div className="p-4 bg-white/80 rounded">
          <h2 className="text-lg font-bold">Left Side</h2>
          <SketchPicker color={colorA} onChange={(c) => setColorA(c.hex)} />
          <div className="mt-2">
            <label>Metalness: {materialA.metalness.toFixed(2)}</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={materialA.metalness}
              onChange={(e) => setMaterialA({ ...materialA, metalness: parseFloat(e.target.value) })}
            />
          </div>
          <div>
            <label>Roughness: {materialA.roughness.toFixed(2)}</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={materialA.roughness}
              onChange={(e) => setMaterialA({ ...materialA, roughness: parseFloat(e.target.value) })}
            />
          </div>
        </div>
        <div className="p-4 bg-white/80 rounded">
          <h2 className="text-lg font-bold">Right Side</h2>
          <SketchPicker color={colorB} onChange={(c) => setColorB(c.hex)} />
          <div className="mt-2">
            <label>Metalness: {materialB.metalness.toFixed(2)}</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={materialB.metalness}
              onChange={(e) => setMaterialB({ ...materialB, metalness: parseFloat(e.target.value) })}
            />
          </div>
          <div>
            <label>Roughness: {materialB.roughness.toFixed(2)}</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={materialB.roughness}
              onChange={(e) => setMaterialB({ ...materialB, roughness: parseFloat(e.target.value) })}
            />
          </div>
        </div>
      </div>

      <Link href="/" className="absolute top-0 right-0 z-10 m-4 rounded bg-white/80 px-3 py-1 text-sm hover:bg-white">
        Back Home
      </Link>
      <Canvas camera={{ position: [0, 0, 15], fov: 50 }} dpr={[1, 2]}>
        <ambientLight intensity={0.8} />
        <directionalLight position={[5, 8, 5]} intensity={1.6} />
        <Suspense fallback={<Html>Loading…</Html>}>
          <Physics gravity={[0, -2, 0]}>
            <Sparkles />
            <Environment preset="sunset" />
            <PhysicsHeart
              scale={scale}
              colors={[colorA, colorB]}
              materials={[materialA, materialB]}
              interacted={interacted}
              onInteract={() => setInteracted(true)}
            />
            <RigidBody type="fixed" restitution={0.7}>
              <CuboidCollider args={[10, 1, 10]} position={[0, -10, 0]} />
              <CuboidCollider args={[10, 1, 10]} position={[0, 10, 0]} />
              <CuboidCollider args={[1, 10, 10]} position={[-10, 0, 0]} />
              <CuboidCollider args={[1, 10, 10]} position={[10, 0, 0]} />
              <CuboidCollider args={[10, 10, 1]} position={[0, 0, -10]} />
              <CuboidCollider args={[10, 10, 1]} position={[0, 0, 10]} />
            </RigidBody>
          </Physics>
          <EffectComposer>
            <Bloom mipmapBlur intensity={0.5} luminanceThreshold={0.35} luminanceSmoothing={0.9} />
          </EffectComposer>
        </Suspense>
      </Canvas>
    </div>
  )
}

