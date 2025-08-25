// WeddingIntro.tsx – simplified to only show heart finale
// -----------------------------------------------------------------------------
'use client'

import { Canvas, useFrame } from '@react-three/fiber'
import {
  Environment,
  Float,
  Text, // Keep Text import
} from '@react-three/drei'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import { motion } from 'framer-motion'; // Ensure motion is imported
import * as THREE from 'three';
import React, { Suspense, useEffect, useMemo, useRef } from 'react'; // Ensure React is imported for JSX

/* -------------------------------------------------------------------------- */
/*                                Configuration                               */
/* -------------------------------------------------------------------------- */
const CONFIG = {
  // RING_DURATION: 10, // Removed
  // FLASH_DURATION: 0.4, // Removed
  HEART_DURATION: 6,
  // ORBIT_SPEED: 0.7, // Removed
  BASE_HEART_SPIN: 0.01,
  HEART_ACCEL: 1.0015,
} as const

/* -------------------------------------------------------------------------- */
/*                                Heart shape                                 */
/* -------------------------------------------------------------------------- */
// Remove explicit JSX.Element return type, let TS infer
function Heart3D() {
  const geom = useMemo<THREE.ExtrudeGeometry>(() => { // Explicitly type useMemo return
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

  // Clip planes to reveal half‑and‑half materials
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

  // Return the JSX group
  return (
    <group scale={0.6} rotation={[0, Math.PI, Math.PI /* upright */]}>
      {/* Use the geometry correctly */}
      <mesh geometry={geom} material={gold} />
      <mesh geometry={geom} material={silver} />
      {/* Names */}
      <Text
        position={[-1, 0.1, 0.71]} // Position on the left side (gold)
        fontSize={0.35}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.015}
        outlineColor="#000"
      >
        Abbi
      </Text>
      <Text
        position={[1, 0.1, 0.71]} // Position on the right side (silver)
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

/* -------------------------------------------------------------------------- */
/*                           Spinning heart finale                            */
/* -------------------------------------------------------------------------- */
// Ensure SpinningHeart is defined before use
function SpinningHeart() {
  const ref = useRef<THREE.Group>(null!)

  useFrame(() => {
    const spin = (ref.current.userData.spin ||= CONFIG.BASE_HEART_SPIN)
    ref.current.rotation.y += spin
    ref.current.userData.spin *= CONFIG.HEART_ACCEL
  })

  return (
    <group ref={ref}>
      <Float floatIntensity={1} rotationIntensity={0.12} speed={1.8}>
        <Heart3D />
      </Float>
    </group>
  )
}

/* -------------------------------------------------------------------------- */
/*                          Phased animation wrapper                          */
/* -------------------------------------------------------------------------- */
export default function WeddingIntro({ onFinish }: { onFinish?: () => void }) {
  useEffect(() => {
    const id = setTimeout(() => {
      onFinish?.()
    }, CONFIG.HEART_DURATION * 1e3)

    return () => clearTimeout(id)
  }, [onFinish])

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black select-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 1.0 } }}
      exit={{ opacity: 0, transition: { duration: 1.0 } }}
    >
      <Canvas camera={{ position: [0, 0, 7], fov: 50 }} dpr={[1, 2]}>
        <ambientLight intensity={0.8} />
        <directionalLight position={[5, 8, 5]} intensity={1.6} />
        <Suspense fallback={null}>
          <Environment preset="sunset" />
          <SpinningHeart />
          <EffectComposer>
            <Bloom mipmapBlur intensity={0.5} luminanceThreshold={0.35} luminanceSmoothing={0.9} />
          </EffectComposer>
        </Suspense>
      </Canvas>
    </motion.div>
  )
}
