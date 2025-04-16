// WeddingIntro.tsx – polished intro with fixed heart orientation, aesthetic tweaks, and reliable transition
// -----------------------------------------------------------------------------
'use client'

import { Canvas, useFrame } from '@react-three/fiber'
import {
  Environment,
  PresentationControls,
  Html,
  Float,
  PerformanceMonitor,
  Text,
} from '@react-three/drei'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

/* -------------------------------------------------------------------------- */
/*                                Configuration                               */
/* -------------------------------------------------------------------------- */
const CONFIG = {
  RING_DURATION: 10,
  FLASH_DURATION: 0.4,
  HEART_DURATION: 6,
  ORBIT_SPEED: 0.7,
  BASE_HEART_SPIN: 0.01,
  HEART_ACCEL: 1.0015,
} as const

/* -------------------------------------------------------------------------- */
/*                               Ring geometry                                */
/* -------------------------------------------------------------------------- */
interface RingProps {
  position: THREE.Vector3Tuple
  rotation: THREE.Euler | [x: number, y: number, z: number]
  outerRadius: number
  innerRadius: number
  height: number
  color: string
}

function Ring({ position, rotation, outerRadius, innerRadius, height, color }: RingProps) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape()
    shape.absarc(0, 0, outerRadius, 0, Math.PI * 2, false)
    const hole = new THREE.Path()
    hole.absarc(0, 0, innerRadius, 0, Math.PI * 2, true)
    shape.holes.push(hole)

    const geom = new THREE.ExtrudeGeometry(shape, {
      steps: 1,
      depth: height,
      bevelEnabled: true,
      bevelThickness: height * 0.14,
      bevelSize: height * 0.14,
      bevelSegments: 3,
    })
    geom.computeVertexNormals()
    geom.center()
    return geom
  }, [outerRadius, innerRadius, height])

  const material = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color,
        metalness: 1,
        roughness: 0.18,
        reflectivity: 0.9,
        clearcoat: 1,
        clearcoatRoughness: 0.06,
        envMapIntensity: 1.1,
        side: THREE.DoubleSide,
      }),
    [color],
  )

  return <mesh geometry={geometry} material={material} position={position} rotation={rotation} />
}

/* -------------------------------------------------------------------------- */
/*                                Heart shape                                 */
/* -------------------------------------------------------------------------- */
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

  return (
    <group scale={0.6} rotation={[0, Math.PI, Math.PI /* upright */]}>
      <mesh geometry={geom} material={gold} />
      <mesh geometry={geom} material={silver} />
      {/* Names */}
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

/* -------------------------------------------------------------------------- */
/*                              Utility easings                               */
/* -------------------------------------------------------------------------- */
const easeInOutCubic = (p: number) => (p < 0.5 ? 4 * p ** 3 : 1 - Math.pow(-2 * p + 2, 3) / 2)

/* -------------------------------------------------------------------------- */
/*                               Ring ballet                                  */
/* -------------------------------------------------------------------------- */
interface RingsProps {
  duration: number
  onComplete: () => void
}

function Rings({ duration, onComplete }: RingsProps) {
  const outerRadius = 0.8
  const thickness = 0.2

  const ring1 = useRef<THREE.Group>(null!)
  const ring2 = useRef<THREE.Group>(null!)

  const start1 = new THREE.Vector3(-2.2, 1.4, 0)
  const start2 = new THREE.Vector3(2.2, -1.4, 0)
  const centre = new THREE.Vector3(0, 0, 0)
  const initialRadius = start1.distanceTo(centre)
  const minRadius = 1 // keep the rings visible – never converge fully

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    const progress = Math.min(t / duration, 1)
    const eased = easeInOutCubic(progress)

    const angle = t * Math.PI * CONFIG.ORBIT_SPEED
    const radius = THREE.MathUtils.lerp(initialRadius, minRadius, eased)

    ring1.current.position.set(
      centre.x + Math.cos(angle) * radius,
      centre.y + Math.sin(angle) * radius,
      0,
    )
    ring2.current.position.set(
      centre.x + Math.cos(angle + Math.PI) * radius,
      centre.y + Math.sin(angle + Math.PI) * radius,
      0,
    )

    const tilt = eased * 0.4
    ring1.current.rotation.set(Math.PI / 2 + tilt, angle * 0.35, 0)
    ring2.current.rotation.set(angle * 0.35, Math.PI / 2 + tilt, 0)

    if (progress === 1) onComplete()
  })

  return (
    <>
      <group ref={ring1}>
        <Ring
          position={[start1.x, start1.y, 0]}
          rotation={[Math.PI / 2, 0, 0]}
          outerRadius={outerRadius}
          innerRadius={outerRadius - thickness}
          height={thickness}
          color="#FFD700"
        />
      </group>
      <group ref={ring2}>
        <Ring
          position={[start2.x, start2.y, 0]}
          rotation={[0, Math.PI / 2, 0]}
          outerRadius={outerRadius}
          innerRadius={outerRadius - thickness}
          height={thickness}
          color="#C0C0C0"
        />
      </group>
    </>
  )
}

/* -------------------------------------------------------------------------- */
/*                           Spinning heart finale                            */
/* -------------------------------------------------------------------------- */
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
  const [phase, setPhase] = useState<'rings' | 'flash' | 'heart'>('rings')

  useEffect(() => {
    let id: ReturnType<typeof setTimeout>

    if (phase === 'flash') id = setTimeout(() => setPhase('heart'), CONFIG.FLASH_DURATION * 1e3)
    if (phase === 'heart')
      id = setTimeout(() => {
        onFinish?.()
      }, CONFIG.HEART_DURATION * 1e3)

    return () => clearTimeout(id)
  }, [phase, onFinish])

  /* ------------------------------ Flash overlay --------------------------- */
  if (phase === 'flash')
    return <div className="fixed inset-0 bg-white/70 animate-fade-out" />

  /* --------------------------- Heart (final) scene ------------------------ */
  if (phase === 'heart')
    return (
      <div className="fixed inset-0 bg-black select-none">
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

  /* --------------------------- Rings intro scene ------------------------- */
  return (
    <div className="fixed inset-0 bg-black select-none">
      <Canvas camera={{ position: [0, 0, 7], fov: 50 }} dpr={[1, 2]}>
        <PerformanceMonitor onDecline={() => console.log('perf drop')} />
        <ambientLight intensity={0.75} />
        <directionalLight position={[5, 8, 5]} intensity={1.6} />

        <Suspense fallback={<Html>Loading 3D scene…</Html>}>
          <Environment preset="city" />
          <PresentationControls
            global
            cursor
            speed={1.05}
            zoom={0.9}
            rotation={[0.1, 0.2, 0]}
            polar={[-Math.PI / 2, Math.PI / 2]}
            azimuth={[-Math.PI, Math.PI]}
          >
            <Rings duration={CONFIG.RING_DURATION} onComplete={() => setPhase('flash')} />
          </PresentationControls>
          <EffectComposer>
            <Bloom mipmapBlur intensity={0.4} luminanceThreshold={0.45} luminanceSmoothing={0.9} />
          </EffectComposer>
        </Suspense>
      </Canvas>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*                             Tailwind helpers                               */
/* -------------------------------------------------------------------------- */
// @keyframes fade-out { 0% { opacity: 1 } 100% { opacity: 0 } }
// .animate-fade-out { animation: fade-out 0.4s ease-in-out forwards }
