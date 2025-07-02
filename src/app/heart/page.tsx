'use client'

import { Canvas, useFrame } from '@react-three/fiber'
import { Environment, Html, Float, Text } from '@react-three/drei'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import * as THREE from 'three'
import React, { Suspense, useMemo, useRef } from 'react'
import Link from 'next/link'

function Heart3D() {
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
    <group scale={0.6} rotation={[0, Math.PI, Math.PI]}>
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

function SpinningHeart() {
  const ref = useRef<THREE.Group>(null!)

  useFrame(() => {
    const spin = (ref.current.userData.spin ||= 0.01)
    ref.current.rotation.y += spin
    ref.current.userData.spin *= 1.0015
  })

  return (
    <group ref={ref}>
      <Float floatIntensity={1} rotationIntensity={0.12} speed={1.8}>
        <Heart3D />
      </Float>
    </group>
  )
}

export default function HeartPage() {
  return (
    <div className="fixed inset-0 bg-black select-none">
      <Link href="/" className="absolute z-10 m-4 rounded bg-white/80 px-3 py-1 text-sm hover:bg-white">
        Back Home
      </Link>
      <Canvas camera={{ position: [0, 0, 7], fov: 50 }} dpr={[1, 2]}>
        <ambientLight intensity={0.8} />
        <directionalLight position={[5, 8, 5]} intensity={1.6} />
        <Suspense fallback={<Html>Loading…</Html>}>
          <Environment preset="sunset" />
          <SpinningHeart />
          <EffectComposer>
            <Bloom mipmapBlur intensity={0.5} luminanceThreshold={0.35} luminanceSmoothing={0.9} />
          </EffectComposer>
        </Suspense>
      </Canvas>
    </div>
  )
}

