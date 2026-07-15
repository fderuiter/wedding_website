import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Points, PointMaterial } from '@react-three/drei';
import * as THREE from 'three';
import { inSphere } from 'maath/random';
import { useReducedMotion } from '../../../hooks/useReducedMotion';

export function Sparkles({ count = 200, color = '#ffa0e0' }: { count?: number, color?: string }) {
  const reduceMotion = useReducedMotion();
  const pointsRef = useRef<THREE.Points>(null!);
  const positions = useMemo(
    () => inSphere(new Float32Array(count * 3), { radius: 10 }) as Float32Array,
    [count],
  );

  useFrame(() => {
    if (pointsRef.current && !reduceMotion) {
      pointsRef.current.rotation.y += 0.001;
    }
  });

  return (
    <Points ref={pointsRef} positions={positions} stride={3} frustumCulled={false}>
      <PointMaterial transparent color={color} size={0.1} sizeAttenuation={true} depthWrite={false} />
    </Points>
  );
}
