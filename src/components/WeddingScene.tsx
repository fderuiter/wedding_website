'use client';

import { Canvas } from '@react-three/fiber';
import { useRef, useMemo } from 'react';
import { OrbitControls, useGLTF, Environment, Float, PresentationControls } from '@react-three/drei';
import { motion, MotionConfig } from 'framer-motion';
import * as THREE from 'three';
import { Vector3, BufferGeometry, Float32BufferAttribute } from 'three';

function createHeartGeometry() {
  const geometry = new BufferGeometry();
  const vertices = [];
  const density = 64;

  // Generate vertices based on the heart formula
  for (let i = 0; i < density; i++) {
    for (let j = 0; j < density; j++) {
      const u = (i / density) * Math.PI * 2;
      const v = (j / density) * Math.PI;

      // Convert to cartesian coordinates
      const x = Math.sin(v) * Math.cos(u);
      const y = Math.sin(v) * Math.sin(u);
      const z = Math.cos(v);

      // Apply heart equation: (x²+y²+z²-1)³ - (27/4)(x²+y²)z³ = 0
      const scale = 0.2;
      const heartX = x * scale;
      const heartY = z * scale;
      const heartZ = y * scale;

      vertices.push(heartX, heartY, heartZ);
    }
  }

  // Create faces
  const indices = [];
  for (let i = 0; i < density - 1; i++) {
    for (let j = 0; j < density - 1; j++) {
      const a = i * density + j;
      const b = i * density + j + 1;
      const c = (i + 1) * density + j;
      const d = (i + 1) * density + j + 1;

      indices.push(a, b, c);
      indices.push(b, d, c);
    }
  }

  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return geometry;
}

interface HeartMeshProps {
  position: [number, number, number];
  scale?: number;
  color?: string;
}

function HeartMesh({ position, scale = 1, color = "#FF69B4" }: HeartMeshProps) {
  const geometry = useMemo(() => createHeartGeometry(), []);
  
  return (
    <mesh geometry={geometry} position={position} scale={scale}>
      <meshStandardMaterial color={color} metalness={0.2} roughness={0.8} />
    </mesh>
  );
}

function WeddingModel() {
  return (
    <MotionConfig transition={{ duration: 2 }}>
      <group>
        {/* Wedding Rings */}
        <Float speed={1.5} rotationIntensity={0.5} floatIntensity={0.5}>
          <mesh position={[-0.7, 0, 0]} scale={1}>
            <torusGeometry args={[1, 0.2, 16, 32]} />
            <meshStandardMaterial color="#FFD700" metalness={0.8} roughness={0.2} />
          </mesh>
        </Float>

        <Float speed={1.2} rotationIntensity={0.4} floatIntensity={0.4}>
          <mesh position={[0.7, 0, 0]} scale={1}>
            <torusGeometry args={[0.8, 0.2, 16, 32]} />
            <meshStandardMaterial color="#FFD700" metalness={0.8} roughness={0.2} />
          </mesh>
        </Float>

        {/* Decorative Hearts */}
        {[...Array(5)].map((_, i) => (
          <Float key={i} speed={1 + Math.random()} rotationIntensity={0.3} floatIntensity={0.5}>
            <HeartMesh 
              position={[
                (Math.random() - 0.5) * 4,
                (Math.random() - 0.5) * 4,
                (Math.random() - 0.5) * 4
              ]}
              scale={0.3 + Math.random() * 0.2}
              color="#FF69B4"
            />
          </Float>
        ))}
      </group>
    </MotionConfig>
  );
}

export default function WeddingScene() {
  return (
    <div className="h-[600px] w-full">
      <Canvas camera={{ position: [0, 0, 5], fov: 50 }}>
        <Environment preset="sunset" />        <PresentationControls
          global
          cursor={false}
          speed={1}
          zoom={1}
          rotation={[0.13, 0.1, 0]}
          polar={[-0.4, 0.2]}
          azimuth={[-0.5, 0.5]}
        >
          <WeddingModel />
        </PresentationControls>
        <OrbitControls enableZoom={false} />
      </Canvas>
    </div>
  );
}
