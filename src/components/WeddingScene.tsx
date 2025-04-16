'use client';

import { Canvas, useFrame } from '@react-three/fiber';
import { Suspense, useState } from 'react';
import { useRef, useMemo, useEffect } from 'react';
// Import Physics and RigidBody
import { Physics, RigidBody, type RapierRigidBody, CuboidCollider, BallCollider, CylinderCollider, interactionGroups } from '@react-three/rapier';
import { Environment, PresentationControls, Stats } from '@react-three/drei';
import { MotionConfig } from 'framer-motion';
import * as THREE from 'three';

// Define props for a simple ring
interface RingProps {
  position: [number, number, number];
  rotation: [number, number, number];
  outerRadius: number;
  innerRadius: number;
  height: number;
  color?: string;
}

function InterlockedRing({ 
  position, 
  rotation, 
  outerRadius, 
  innerRadius, 
  height, 
  color = "#FFD700"
}: RingProps) {
  const rigidBodyRef = useRef<RapierRigidBody | null>(null);
   
  // Create a more defined, solid ring geometry with better beveling
  const geometry = useMemo(() => {
    // Create a toroidal shape for the ring
    const shape = new THREE.Shape();
    shape.absarc(0, 0, outerRadius, 0, Math.PI * 2, false);
    const holePath = new THREE.Path();
    holePath.absarc(0, 0, innerRadius, 0, Math.PI * 2, true);
    shape.holes.push(holePath);
    
    // Enhanced extrude settings for a more polished look
    const extrudeSettings = {
      steps: 2,  // Increased steps for smoother geometry
      depth: height,
      bevelEnabled: true,
      bevelThickness: height * 0.15,  // Increased bevel thickness
      bevelSize: height * 0.15,       // Increased bevel size
      bevelOffset: 0,
      bevelSegments: 5,               // More segments for smoother edges
    };
    
    const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    geom.computeVertexNormals(); // Ensure proper lighting
    geom.center();
    return geom;
  }, [outerRadius, innerRadius, height]);

  // Using convex hull collider for performance
  // no need for manual collider args
  
  // UseEffect to update rigid body properties if needed
  useEffect(() => {
    if (rigidBodyRef.current) {
      // Set initial position and rotation
      rigidBodyRef.current.setTranslation({ 
        x: position[0], 
        y: position[1], 
        z: position[2] 
      }, true);
      
      // Wake up the body to ensure physics are active
      rigidBodyRef.current.wakeUp();
    }
  }, [position]);

  return (
    <RigidBody
      ref={rigidBodyRef}
      position={position}
      rotation={rotation}
      colliders="hull"
      type="dynamic"
      restitution={0.4}
      friction={0.8}
    >
      <mesh geometry={geometry}>
        <meshStandardMaterial
          color={color}
          metalness={0.95}
          roughness={0.15}
          side={THREE.DoubleSide}
          envMapIntensity={1.5}   // Enhanced reflectivity
        />
      </mesh>
    </RigidBody>
  );
}

function AnimatedInterwovenRings() {
  // Enhanced parameters for the rings
  const radius = 0.8;
  const thickness = 0.18;
  const animationSpeed = 0.4;
  const orbitRadius = 0.25;
  const introMoveDuration = 2; // seconds to move from corners to start orbit

  // Refs for animation
  const groupRef = useRef<any>(null);
  const ring1Ref = useRef<any>(null);
  const ring2Ref = useRef<any>(null);
  
  useFrame((state) => {
    const elapsed = state.clock.getElapsedTime();
    const phase = Math.PI / 2;
    // Intro: move rings from corners into orbit start positions
    if (elapsed < introMoveDuration) {
      const f = elapsed / introMoveDuration;
      // Corner start positions
      const start1 = new THREE.Vector3(-3, 3, 0);
      const target1 = new THREE.Vector3(
        Math.cos(0) * orbitRadius,
        Math.sin(0.7 * 0) * orbitRadius * 0.4,
        Math.sin(0) * orbitRadius
      );
      const start2 = new THREE.Vector3(3, -3, 0);
      const target2 = new THREE.Vector3(
        Math.sin(phase) * orbitRadius,
        Math.sin(phase * 0.7) * orbitRadius * -0.4,
        Math.cos(phase) * orbitRadius
      );
      ring1Ref.current.position.lerpVectors(start1, target1, f);
      ring2Ref.current.position.lerpVectors(start2, target2, f);
      return;
    }
    // Orbit animation after intro
    const t = (elapsed - introMoveDuration) * animationSpeed;
    const weaveOsc = Math.sin(t * 0.5) * 0.2;
    
    // Ring 1: Gold ring - moves in Figure-8 pattern
    if (ring1Ref.current) {
      ring1Ref.current.position.set(
        Math.cos(t) * orbitRadius,
        Math.sin(t * 0.7) * orbitRadius * 0.4,
        Math.sin(t) * orbitRadius
      );
      ring1Ref.current.rotation.set(
        Math.PI / 2 + Math.sin(t) * 0.2,
        t,
        weaveOsc
      );
    }
    
    // Ring 2: Silver ring - moves in complementary Figure-8
    if (ring2Ref.current) {
      const tp = t + phase;
      ring2Ref.current.position.set(
        Math.sin(tp) * orbitRadius,
        Math.sin(tp * 0.7) * orbitRadius * -0.4,
        Math.cos(tp) * orbitRadius
      );
      ring2Ref.current.rotation.set(
        Math.sin(tp) * 0.2,
        Math.PI / 2,
        tp + weaveOsc
      );
    }
  });

  return (
    <MotionConfig transition={{ duration: 1.5 }}>
      <group ref={groupRef}>
        <group ref={ring1Ref}>
          <InterlockedRing
            position={[0, 0, 0]}
            outerRadius={radius}
            innerRadius={radius - thickness}
            height={thickness}
            rotation={[Math.PI / 2, 0, 0]}
            color="#FFD700"
          />
        </group>
        <group ref={ring2Ref}>
          <InterlockedRing
            position={[0, 0, 0]}
            outerRadius={radius}
            innerRadius={radius - thickness}
            height={thickness}
            rotation={[0, Math.PI / 2, 0]}
            color="#C0C0C0"
          />
        </group>
      </group>
    </MotionConfig>
  );
}

function WeddingModel() {
  return <AnimatedInterwovenRings />;
}

export default function WeddingScene({ onComplete }: { onComplete?: () => void }) {
  const [showHeart, setShowHeart] = useState(false);
  
  useEffect(() => {
    // Intro rings animation duration
    const introTimer = setTimeout(() => {
      setShowHeart(true);
      // Show heart for a moment before completing
      const heartTimer = setTimeout(() => {
        onComplete?.();
      }, 1000);
      return () => clearTimeout(heartTimer);
    }, 4000);
    return () => clearTimeout(introTimer);
  }, [onComplete]);

  // Heart display after rings animation
  if (showHeart) {
    return (
      <div className="fixed inset-0 bg-gray-900 flex items-center justify-center">
        <div className="text-red-500 text-[10rem] animate-pulse">❤️</div>
      </div>
    );
  }

  // Rings intro animation
  return (
    <div className="fixed inset-0 bg-black">
      <Suspense fallback={<div>Loading 3D Scene...</div>}>
        <Canvas camera={{ position: [0, 0, 4.5], fov: 55 }}>
          <Stats showPanel={0} />
          <Physics gravity={[0, -1, 0]}> 
            <ambientLight intensity={0.7} />
            <directionalLight position={[5, 8, 5]} intensity={1.8} />
            <Environment preset="city" />
            <PresentationControls
              global
              cursor={true}
              speed={1.2}
              zoom={0.8}
              rotation={[0.1, 0.2, 0]}
              polar={[-Math.PI / 2, Math.PI / 2]}
              azimuth={[-Math.PI, Math.PI]}
            >
              <WeddingModel />
            </PresentationControls>
          </Physics>
        </Canvas>
      </Suspense>
    </div>
  );
}

export { InterlockedRing, WeddingModel };
