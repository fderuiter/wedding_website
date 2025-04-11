'use client';

import { Canvas, useFrame } from '@react-three/fiber';
import { useRef, useMemo } from 'react';
import { Environment, Float, PresentationControls } from '@react-three/drei';
import { MotionConfig } from 'framer-motion';
import * as THREE from 'three';

// Function to create a proper engraving texture and normal map for a Torus
function createEngravingTextures(text: string, partialEngraving = true, startAngle = 0.3, endAngle = 0.7) {
  if (typeof window === 'undefined') return { map: null, normalMap: null, bumpMap: null };

  // Create high-resolution canvases for better detail
  const canvas = document.createElement('canvas');
  const normalCanvas = document.createElement('canvas');
  const bumpCanvas = document.createElement('canvas'); // Canvas for bump map
  // Dimensions suitable for wrapping around a torus segment
  canvas.width = 1024; // Width corresponds to the circumference segment
  canvas.height = 128;  // Height corresponds to the tube thickness
  normalCanvas.width = 1024;
  normalCanvas.height = 128;
  bumpCanvas.width = 1024; // Same dimensions for bump map
  bumpCanvas.height = 128;

  const ctx = canvas.getContext('2d');
  const normalCtx = normalCanvas.getContext('2d');
  const bumpCtx = bumpCanvas.getContext('2d'); // Context for bump map
  if (!ctx || !normalCtx || !bumpCtx) return { map: null, normalMap: null, bumpMap: null };

  // Set background - slightly transparent to blend with gold
  ctx.fillStyle = 'rgba(153, 119, 34, 0.8)'; // Base gold color, slightly transparent
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Normal map background
  normalCtx.fillStyle = '#808080'; // Neutral normal
  normalCtx.fillRect(0, 0, normalCanvas.width, normalCanvas.height);

  // Bump map background (white for non-engraved areas)
  bumpCtx.fillStyle = '#FFFFFF';
  bumpCtx.fillRect(0, 0, bumpCanvas.width, bumpCanvas.height);

  // Configure text - sharp, clear, and appropriately sized
  const fontSize = 60; // Adjusted font size
  ctx.fillStyle = 'black'; // Engraving color
  ctx.font = `bold ${fontSize}px sans-serif`; // Sans-serif might be clearer
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Draw the text with a subtle shadow for depth
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = 5;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  ctx.shadowColor = 'transparent'; // Reset shadow

  // Draw text for normal map (white on black for bump effect)
  normalCtx.fillStyle = '#FFFFFF'; // White for raised effect
  normalCtx.font = `bold ${fontSize}px sans-serif`;
  normalCtx.textAlign = 'center';
  normalCtx.textBaseline = 'middle';
  // Use a darker shadow for a stronger normal effect
  normalCtx.shadowColor = 'rgba(0, 0, 0, 1)';
  normalCtx.shadowBlur = 8;
  normalCtx.shadowOffsetX = 3;
  normalCtx.shadowOffsetY = 3;
  normalCtx.fillText(text, normalCanvas.width / 2, normalCanvas.height / 2);

  // Draw text for bump map (black on white for inset effect)
  bumpCtx.fillStyle = '#000000'; // Black for engraved areas
  bumpCtx.font = `bold ${fontSize}px sans-serif`;
  bumpCtx.textAlign = 'center';
  bumpCtx.textBaseline = 'middle';
  // No shadow needed for bump map, just clear contrast
  bumpCtx.fillText(text, bumpCanvas.width / 2, bumpCanvas.height / 2);

  // Create textures
  const texture = new THREE.CanvasTexture(canvas);
  const normalTexture = new THREE.CanvasTexture(normalCanvas);
  const bumpTexture = new THREE.CanvasTexture(bumpCanvas); // Bump texture

  // Configure texture wrapping and filtering
  texture.wrapS = normalTexture.wrapS = bumpTexture.wrapS = THREE.ClampToEdgeWrapping; // Clamp prevents repeating on torus
  texture.wrapT = normalTexture.wrapT = bumpTexture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = normalTexture.minFilter = bumpTexture.minFilter = THREE.LinearMipmapLinearFilter; // Better quality filtering
  texture.magFilter = normalTexture.magFilter = bumpTexture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  normalTexture.needsUpdate = true;
  bumpTexture.needsUpdate = true;

  // Set texture offset and repeat to apply only to a segment of the torus
  if (partialEngraving) {
    const range = endAngle - startAngle;
    texture.repeat.set(range, 1);
    texture.offset.set(startAngle, 0);
    normalTexture.repeat.set(range, 1);
    normalTexture.offset.set(startAngle, 0);
    bumpTexture.repeat.set(range, 1); // Apply same repeat/offset to bump map
    bumpTexture.offset.set(startAngle, 0);
  } else {
     texture.repeat.set(1, 1);
     normalTexture.repeat.set(1, 1);
     bumpTexture.repeat.set(1, 1);
  }


  return { map: texture, normalMap: normalTexture, bumpMap: bumpTexture }; // Return bump map
}


function EngravedRing({ position, radius, tubeRadius, rotation, color = "#FFD700", text = "" }: { position: [number, number, number], radius: number, tubeRadius: number, rotation: [number, number, number], color?: string, text?: string }) {
  const meshRef = useRef<THREE.Mesh | null>(null);

  // Use partial engraving to avoid text in the intersecting areas
  // Apply texture to ~40% of the ring circumference (adjust angles as needed)
  const { map, normalMap, bumpMap } = useMemo(() => { // Destructure bumpMap
    // Adjust start/end angles for desired text placement on the torus
    return createEngravingTextures(text, true, 0.3, 0.7); // Apply texture between 30% and 70% of circumference
  }, [text]);

  // Animate rotation slightly
  useFrame(() => {
    if (meshRef.current) {
      // Subtle continuous rotation on Z axis
      meshRef.current.rotation.z += 0.001;
    }
  });

  return (
    // Adjusted Float parameters
    <Float speed={1.0} rotationIntensity={0.2} floatIntensity={0.3}>
      <mesh ref={meshRef} position={position} rotation={rotation}>
        {/* Use TorusGeometry for the ring shape */}
        {/* Increased segments for smoother geometry */}
        <torusGeometry args={[radius, tubeRadius, 64, 128]} />
        <meshStandardMaterial
          color={color}
          metalness={0.95} // Adjusted metalness
          roughness={0.15} // Adjusted roughness
          side={THREE.DoubleSide} // Keep DoubleSide to see texture if it wraps inside
          map={map}
          normalMap={normalMap}
          normalScale={new THREE.Vector2(0.8, 0.8)} // Adjusted normal scale
          bumpMap={bumpMap} // Apply the bump map
          bumpScale={-0.01} // Set bump scale for inset effect (adjust as needed)
        />
      </mesh>
    </Float>
  );
}


function WeddingModel() {
  return (
    <MotionConfig transition={{ duration: 1.5 }}> {/* Adjusted duration */}
      <group>
        {/* Adjust positions and rotations for better interweaving */}
        <EngravedRing
          position={[-0.45, 0.1, 0]} // Adjusted position
          radius={0.8}
          tubeRadius={0.12} // Slightly thinner tube
          rotation={[Math.PI / 2, Math.PI / 5, 0]} // Adjusted rotation
          color="#FFD700" // Classic gold
          text="Abbi & Fred" // Updated text
        />

        <EngravedRing
          position={[0.45, -0.1, 0]} // Adjusted position
          radius={0.8}
          tubeRadius={0.12} // Slightly thinner tube
          rotation={[Math.PI / 2, -Math.PI / 5, Math.PI / 16]} // Adjusted rotation for more dynamic interweave
          color="#E5C100" // Slightly different gold tone for contrast
          text="10-10-2025"
        />
      </group>
    </MotionConfig>
  );
}

export default function WeddingScene() {
  return (
    // Added a subtle background gradient to the container
    <div className="h-[600px] w-full bg-gradient-to-br from-gray-800 to-blue-900">
      <Canvas camera={{ position: [0, 0, 4.5], fov: 55 }}> {/* Adjusted camera */}
        {/* Improved Lighting */}
        <ambientLight intensity={0.7} /> {/* Adjusted ambient light */}
        <directionalLight
          position={[5, 8, 5]} // Adjusted light position
          intensity={1.8} // Adjusted intensity
          // castShadow // Shadows can be added but require setup
        />
        <Environment preset="city" /> {/* Changed environment preset */}

        <PresentationControls
          global
          cursor={true} // Enable cursor hint
          speed={1.2} // Adjusted speed
          zoom={0.8} // Adjusted zoom factor
          rotation={[0.1, 0.2, 0]} // Adjusted initial rotation
          polar={[-0.3, 0.3]} // Adjusted polar limits
          azimuth={[-0.4, 0.4]} // Adjusted azimuth limits
        >
          <WeddingModel />
        </PresentationControls>
      </Canvas>
    </div>
  );
}
