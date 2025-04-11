'use client';

import { Canvas, useFrame } from '@react-three/fiber';
import { useRef, useMemo } from 'react';
import { OrbitControls, Environment, Float, PresentationControls } from '@react-three/drei';
import { MotionConfig } from 'framer-motion';
import * as THREE from 'three';

// Function to create a proper engraving texture and normal map
function createEngravingTextures(text: string, partialEngraving = true, startAngle = 0.3, endAngle = 0.7) {
  if (typeof window === 'undefined') return { map: null, normalMap: null };
  
  // Create high-resolution canvases for better detail
  const canvas = document.createElement('canvas');
  const normalCanvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 256;
  normalCanvas.width = 2048;
  normalCanvas.height = 256;
  
  const ctx = canvas.getContext('2d');
  const normalCtx = normalCanvas.getContext('2d');
  if (!ctx || !normalCtx) return { map: null, normalMap: null };
  
  // Set background
  ctx.fillStyle = '#997722'; // Slightly darker gold for base
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // If partial engraving, clear parts where we don't want text (create a transparency mask)
  if (partialEngraving) {
    // Clear the areas that will intersect with the other ring
    // We'll clear the start and end portions of the texture
    const startClearWidth = Math.floor(canvas.width * startAngle);
    const endStartPoint = Math.floor(canvas.width * endAngle);
    const endClearWidth = canvas.width - endStartPoint;
    
    // Use compositing to create transparent regions
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0, 0, 0, 1)';
    ctx.fillRect(0, 0, startClearWidth, canvas.height); // Clear beginning portion
    ctx.fillRect(endStartPoint, 0, endClearWidth, canvas.height); // Clear end portion
    ctx.globalCompositeOperation = 'source-over'; // Reset to default
    
    // Do the same for normal map canvas
    normalCtx.globalCompositeOperation = 'destination-out';
    normalCtx.fillStyle = 'rgba(0, 0, 0, 1)';
    normalCtx.fillRect(0, 0, startClearWidth, normalCanvas.height);
    normalCtx.fillRect(endStartPoint, 0, endClearWidth, normalCanvas.height);
    normalCtx.globalCompositeOperation = 'source-over';
  }
  
  // Create a normal map for 3D effect
  normalCtx.fillStyle = '#7F7F7F'; // Neutral normal color (no perturbation)
  normalCtx.fillRect(0, 0, normalCanvas.width, normalCanvas.height);
  
  // Configure text - sharp, clear and large
  ctx.fillStyle = 'black'; // Black for engraving depth
  ctx.font = 'bold 120px serif'; // Serif for a more formal engraving look
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  // Draw the text with a slight shadow for depth
  ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetX = 4;
  ctx.shadowOffsetY = 4;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  
  // Draw text in white with a black shadow for normal map
  normalCtx.fillStyle = '#FFFFFF'; // White for raised normals
  normalCtx.font = 'bold 120px serif';
  normalCtx.textAlign = 'center';
  normalCtx.textBaseline = 'middle';
  normalCtx.shadowColor = 'rgb(0, 0, 0)';
  normalCtx.shadowBlur = 20;
  normalCtx.shadowOffsetX = 6;
  normalCtx.shadowOffsetY = 6;
  normalCtx.fillText(text, normalCanvas.width / 2, normalCanvas.height / 2);
  
  // Create textures from canvases
  const texture = new THREE.CanvasTexture(canvas);
  const normalTexture = new THREE.CanvasTexture(normalCanvas);
  
  // Configure texture wrapping and repeat for cylinder mapping
  texture.wrapS = normalTexture.wrapS = THREE.RepeatWrapping;
  texture.repeat.set(1, 1);
  normalTexture.repeat.set(1, 1);
  
  // Set proper filtering for sharp text
  texture.minFilter = normalTexture.minFilter = THREE.LinearFilter;
  texture.magFilter = normalTexture.magFilter = THREE.LinearFilter;
  
  return { map: texture, normalMap: normalTexture };
}

function EngravedRing({ position, radius, tubeRadius, rotation, color = "#FFD700", text = "" }: { position: [number, number, number], radius: number, tubeRadius: number, rotation: [number, number, number], color?: string, text?: string }) {
  const meshRef = useRef<THREE.Mesh | null>(null);
  const outerEngravingRef = useRef<THREE.Mesh | null>(null);
  const innerEngravingRef = useRef<THREE.Mesh | null>(null);
    // Create proper engraving textures with normal maps for outside and inside
  // Use partial engraving to avoid text in the intersecting areas
  const { map: outerMap, normalMap: outerNormalMap } = useMemo(() => {
    return createEngravingTextures(text, true, 0.3, 0.7); // Only put text on 40% of the ring (from 30% to 70%)
  }, [text]);
  
  // Create similar textures for inside with slight modifications
  const { map: innerMap, normalMap: innerNormalMap } = useMemo(() => {
    return createEngravingTextures(text, true, 0.3, 0.7); // Same text placement as outer surface
  }, [text]);
  
  // Animate rotation slightly
  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += 0.001;
    }
    if (outerEngravingRef.current) {
      outerEngravingRef.current.rotation.y += 0.001;
    }
    if (innerEngravingRef.current) {
      innerEngravingRef.current.rotation.y += 0.001;
    }
  });
  
  return (
    <Float speed={1.2} rotationIntensity={0.4} floatIntensity={0.4}>
      <group position={position} rotation={rotation}>
        {/* Main ring body - cylindrical shape */}
        <mesh ref={meshRef}>
          <cylinderGeometry args={[radius, radius, tubeRadius * 2, 64, 2, true]} />
          <meshStandardMaterial 
            color={color} 
            metalness={1.0} 
            roughness={0.05} 
            side={THREE.DoubleSide}
          />
        </mesh>
        
        {/* Outer engraved band with proper 3D engraving effect */}
        <mesh ref={outerEngravingRef} position={[0, 0, 0]}>
          <cylinderGeometry args={[radius + 0.005, radius + 0.005, tubeRadius * 1.4, 128, 1, true]} />
          <meshStandardMaterial 
            color={color}
            metalness={0.95}
            roughness={0.2}
            side={THREE.FrontSide} // Only render outside face
            map={outerMap}
            normalMap={outerNormalMap}
            normalScale={new THREE.Vector2(0.5, 0.5)}
            bumpMap={outerMap}
            bumpScale={0.05}
            displacementMap={outerMap}
            displacementScale={0.02}
          />
        </mesh>
        
        {/* Inner engraved band */}
        <mesh ref={innerEngravingRef} position={[0, 0, 0]}>
          <cylinderGeometry args={[radius - 0.005, radius - 0.005, tubeRadius * 1.4, 128, 1, true]} />
          <meshStandardMaterial 
            color={color}
            metalness={0.95}
            roughness={0.2}
            side={THREE.BackSide} // Only render inside face
            map={innerMap}
            normalMap={innerNormalMap}
            normalScale={new THREE.Vector2(0.5, 0.5)}
            bumpMap={innerMap}
            bumpScale={0.05}
            displacementMap={innerMap}
            displacementScale={0.02}
          />
        </mesh>
      </group>
    </Float>
  );
}

function WeddingModel() {
  return (
    <MotionConfig transition={{ duration: 2 }}>
      <group>
        {/* Wedding Rings with text engravings - thicker and interwoven */}
        <EngravedRing 
          position={[-0.5, 0.2, 0]} 
          radius={0.8} 
          tubeRadius={0.2} // Made thicker
          rotation={[Math.PI/2, Math.PI/6, 0]} // Tilted for interweaving
          color="#FFD700" 
          text="Abbi and Fred"
        />
        
        <EngravedRing 
          position={[0.5, -0.2, 0]} 
          radius={0.8} 
          tubeRadius={0.2} // Made thicker
          rotation={[Math.PI/2, -Math.PI/6, 0]} // Tilted for interweaving
          color="#FFDF00" 
          text="10-10-2025"
        />
      </group>
    </MotionConfig>
  );
}

export default function WeddingScene() {
  return (
    <div className="h-[600px] w-full">
      <Canvas camera={{ position: [0, 0, 5], fov: 50 }}>
        <Environment preset="sunset" />
        <PresentationControls
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
