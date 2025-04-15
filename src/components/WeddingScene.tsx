'use client';

import { Canvas, useFrame } from '@react-three/fiber';
import { useRef, useMemo, useEffect } from 'react';
// Import Physics and RigidBody
import { Physics, RigidBody, TrimeshArgs, CuboidCollider, BallCollider, CylinderCollider, interactionGroups } from '@react-three/rapier';
import { Environment, PresentationControls } from '@react-three/drei';
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
  const rigidBodyRef = useRef<any>(null);

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

  // Create a more efficient compound collider for better physics performance
  const colliderArgs = useMemo(() => {
    if (!geometry) return undefined;
    const vertices = geometry.attributes.position.array as Float32Array;
    const indices = geometry.index?.array as Uint32Array | Uint16Array; 
    if (!vertices || !indices) {
        console.warn("Vertices or indices missing for trimesh collider");
        return undefined;
    }
    const indices32 = indices instanceof Uint16Array ? new Uint32Array(indices) : indices;
    return [vertices, indices32] as TrimeshArgs;
  }, [geometry]);

  // UseEffect to update rigid body properties if needed
  useEffect(() => {
    if (rigidBodyRef.current) {
      // Set initial position and rotation
      rigidBodyRef.current.setTranslation({ 
        x: position[0], 
        y: position[1], 
        z: position[2] 
      });
      
      // Wake up the body to ensure physics are active
      rigidBodyRef.current.wakeUp();
    }
  }, [position]);

  return (
    <RigidBody
      ref={rigidBodyRef}
      position={position}
      rotation={rotation}
      colliders={colliderArgs ? "trimesh" : false}
      args={colliderArgs}
      type="dynamic"
      restitution={0.4}     // Higher restitution for more bounce
      friction={0.8}        // Higher friction for more stable contacts
      canSleep={false}
      mass={1}              // Set explicit mass
      linearDamping={0.8}   // Add damping for more controlled movement
      angularDamping={0.8}  // Prevent excessive spinning
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
  const thickness = 0.18; // Slightly thinner for better interlocking
  const animationSpeed = 0.4; // Slightly slower for more elegant movement
  const orbitRadius = 0.25; // Controls how close rings are to each other

  // Refs for animation
  const groupRef = useRef<any>(null);
  const ring1Ref = useRef<any>(null);
  const ring2Ref = useRef<any>(null);
  
  // Helper state for smooth animation
  const animationRef = useRef({
    prevTime: 0,
    ringPhase: 0, // Phase difference between rings
  });

  // Create a more fluid, interlocking animation
  useFrame((state) => {
    const t = state.clock.getElapsedTime() * animationSpeed;
    const phase = Math.PI / 2; // 90-degree phase difference creates the interlocking effect
    
    // Smooth oscillating factor that creates the weaving effect
    const weaveOsc = Math.sin(t * 0.5) * 0.2;
    
    // Ring 1: Gold ring - moves in Figure-8 pattern
    if (ring1Ref.current) {
      // Create more complex orbital path for interlocking appearance
      ring1Ref.current.position.set(
        Math.cos(t) * orbitRadius,
        Math.sin(t * 0.7) * orbitRadius * 0.4, // Vertical oscillation
        Math.sin(t) * orbitRadius
      );
      
      // Roll the ring as it moves along its path
      ring1Ref.current.rotation.set(
        Math.PI / 2 + Math.sin(t) * 0.2,
        t,
        weaveOsc
      );
    }
    
    // Ring 2: Silver ring - moves in complementary Figure-8
    if (ring2Ref.current) {
      // Phase-shifted path creates interlocking effect
      ring2Ref.current.position.set(
        Math.sin(t + phase) * orbitRadius,
        Math.sin((t + phase) * 0.7) * orbitRadius * -0.4, // Opposite vertical movement
        Math.cos(t + phase) * orbitRadius
      );
      
      // Different orientation creates crossover points
      ring2Ref.current.rotation.set(
        Math.sin(t + phase) * 0.2,
        Math.PI / 2,
        t + phase + weaveOsc
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

export default function WeddingScene() {
  return (
    <div className="h-[600px] w-full bg-gradient-to-br from-gray-800 to-blue-900">
      <Canvas camera={{ position: [0, 0, 4.5], fov: 55 }}>
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
    </div>
  );
}

export { InterlockedRing, WeddingModel };
