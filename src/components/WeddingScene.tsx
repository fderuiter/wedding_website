'use client';

import { Canvas, useFrame } from '@react-three/fiber';
import { useRef, useMemo } from 'react';
// Import Physics and RigidBody
import { Physics, RigidBody, TrimeshArgs } from '@react-three/rapier'; 
// Removed Float as physics will handle movement
import { Environment, PresentationControls } from '@react-three/drei';
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
  // This canvas is now only for the base color, no text needed here.
  ctx.fillStyle = 'rgba(153, 119, 34, 0.8)'; // Base gold color, slightly transparent
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Normal map background
  normalCtx.fillStyle = '#808080'; // Neutral normal
  normalCtx.fillRect(0, 0, normalCanvas.width, normalCanvas.height);

  // Bump map background (white for non-engraved areas)
  bumpCtx.fillStyle = '#FFFFFF';
  bumpCtx.fillRect(0, 0, bumpCanvas.width, bumpCanvas.height);

  // Configure text properties (used for normal and bump maps)
  const fontSize = 60; // Adjusted font size
  const commonFont = `bold ${fontSize}px sans-serif`;
  const commonTextAlign = 'center' as CanvasTextAlign; // Explicit type assertion
  const commonTextBaseline = 'middle' as CanvasTextBaseline; // Explicit type assertion


  // Draw text for normal map (white on black for bump effect)
  normalCtx.fillStyle = '#FFFFFF'; // White for raised effect
  normalCtx.font = commonFont;
  normalCtx.textAlign = commonTextAlign;
  normalCtx.textBaseline = commonTextBaseline;
  // Use a darker shadow for a stronger normal effect
  normalCtx.shadowColor = 'rgba(0, 0, 0, 1)';
  normalCtx.shadowBlur = 8;
  normalCtx.shadowOffsetX = 3;
  normalCtx.shadowOffsetY = 3;
  normalCtx.fillText(text, normalCanvas.width / 2, normalCanvas.height / 2);

  // Draw text for bump map (black on white for inset effect)
  bumpCtx.fillStyle = '#000000'; // Black for engraved areas
  bumpCtx.font = commonFont;
  bumpCtx.textAlign = commonTextAlign;
  bumpCtx.textBaseline = commonTextBaseline;
  // No shadow needed for bump map, just clear contrast
  bumpCtx.fillText(text, bumpCanvas.width / 2, bumpCanvas.height / 2);

  // Create textures
  const texture = new THREE.CanvasTexture(canvas); // Base color texture (no text)
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
    // Apply repeat/offset only to normal and bump maps
    normalTexture.repeat.set(range, 1);
    normalTexture.offset.set(startAngle, 0);
    bumpTexture.repeat.set(range, 1);
    bumpTexture.offset.set(startAngle, 0);
    // Base texture covers the whole ring (or isn't used if material color is preferred)
    texture.repeat.set(1, 1);
    texture.offset.set(0, 0);
  } else {
     texture.repeat.set(1, 1);
     normalTexture.repeat.set(1, 1);
     bumpTexture.repeat.set(1, 1);
  }


  // Return map (now just base color), normalMap, and bumpMap
  return { map: texture, normalMap: normalTexture, bumpMap: bumpTexture };
}


// Define props for the cylinder ring
interface EngravedCylinderRingProps {
  position: [number, number, number];
  rotation: [number, number, number];
  outerRadius: number;
  innerRadius: number;
  height: number;
  color?: string;
  text?: string;
}

function EngravedRing({ 
  position, 
  rotation, 
  outerRadius, 
  innerRadius, 
  height, 
  color = "#FFD700", 
  text = "" 
}: EngravedCylinderRingProps) {
  const rigidBodyRef = useRef<any>(null); // Ref for RigidBody

  const { map, normalMap, bumpMap } = useMemo(() => {
    return createEngravingTextures(text, true, 0.3, 0.7); 
  }, [text]);

  // Create the thick cylinder geometry using ExtrudeGeometry
  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, outerRadius, 0, Math.PI * 2, false);
    const holePath = new THREE.Path();
    holePath.absarc(0, 0, innerRadius, 0, Math.PI * 2, true);
    shape.holes.push(holePath);
    const extrudeSettings = {
      steps: 1,
      depth: height,
      bevelEnabled: true,
      bevelThickness: height * 0.2,
      bevelSize: height * 0.1,
      bevelOffset: 0,
      bevelSegments: 4,
    };
    const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    geom.center(); // Center the geometry for potentially better physics stability
    return geom;
  }, [outerRadius, innerRadius, height]);

  // Prepare args for TriMesh collider
  const colliderArgs = useMemo(() => {
    if (!geometry) return undefined;
    const vertices = geometry.attributes.position.array as Float32Array;
    // Ensure geometry has an index buffer, ExtrudeGeometry should create one
    const indices = geometry.index?.array as Uint32Array | Uint16Array; 
    if (!vertices || !indices) {
        console.warn("Vertices or indices missing for trimesh collider");
        return undefined;
    }
    // Rapier expects Uint32Array for indices in trimesh
    const indices32 = indices instanceof Uint16Array ? new Uint32Array(indices) : indices;
    return [vertices, indices32] as TrimeshArgs; // Type assertion
  }, [geometry]);

  // Wrap mesh in RigidBody
  return (
    <RigidBody
      ref={rigidBodyRef} // Ref attached to RigidBody
      position={position}
      rotation={rotation}
      colliders={colliderArgs ? "trimesh" : false} // Use trimesh collider if args are ready
      args={colliderArgs} // Pass vertices and indices
      type="dynamic" // Rings should move
      restitution={0.3} // Bounciness
      friction={0.7} // Friction
      canSleep={false} // Prevent rings from sleeping to keep interaction lively
    >
      <mesh geometry={geometry}> {/* Pass geometry directly */}
        <meshStandardMaterial
          color={color} 
          metalness={0.95}
          roughness={0.15}
          side={THREE.DoubleSide}
          // map={map} // Base color map might not be needed
          normalMap={normalMap}
          normalScale={new THREE.Vector2(0.8, 0.8)} // Adjust scale as needed for cylinder
          bumpMap={bumpMap} // Bump map creates the inset effect
          bumpScale={-0.01} // Negative value for inset, adjust as needed
        />
      </mesh>
    </RigidBody>
  );
}


function WeddingModel() {
  return (
    <MotionConfig transition={{ duration: 1.5 }}>
      {/* No group needed if Physics handles positioning */}
      {/* Adjust initial positions/rotations slightly to ensure they are interlocked but not overlapping initially */}
      <EngravedRing
        position={[-0.45, 0.1, 0]} // Keep positions for now, adjust if needed
        outerRadius={0.8} 
        innerRadius={0.7} 
        height={0.2}      
        rotation={[Math.PI / 2, Math.PI / 5, 0]} // Keep rotations for now
        color="#FFD700" // Gold color
        text="Abbi & Fred"
      />

      <EngravedRing
        position={[0.45, -0.1, 0]} // Keep positions for now
        outerRadius={0.8}
        innerRadius={0.7} 
        height={0.2}      
        rotation={[Math.PI / 2, -Math.PI / 5, Math.PI / 16]} // Keep rotations for now
        color="#C0C0C0" // Silver color
        text="10-10-2025"
      />
    </MotionConfig>
  );
}

export default function WeddingScene() {
  return (
    <div className="h-[600px] w-full bg-gradient-to-br from-gray-800 to-blue-900">
      <Canvas camera={{ position: [0, 0, 4.5], fov: 55 }}>
        {/* Wrap scene content with Physics */}
        <Physics gravity={[0, -1, 0]}> {/* Add some gravity */}
          <ambientLight intensity={0.7} /> 
          <directionalLight
            position={[5, 8, 5]} 
            intensity={1.8} 
          />
          <Environment preset="city" /> 

          <PresentationControls
            global
            cursor={true} 
            speed={1.2} 
            zoom={0.8} 
            // Rotation/polar/azimuth controls might fight physics if not configured carefully
            // Consider disabling or adjusting interaction if physics simulation is primary
            // For now, let's allow full rotation to see the physics interaction
            rotation={[0.1, 0.2, 0]} 
            polar={[-Math.PI / 2, Math.PI / 2]} // Allow full vertical rotation
            azimuth={[-Math.PI, Math.PI]} // Allow full horizontal rotation
          >
            <WeddingModel />
          </PresentationControls>
        </Physics> {/* Close Physics wrapper */}
      </Canvas>
    </div>
  );
}
