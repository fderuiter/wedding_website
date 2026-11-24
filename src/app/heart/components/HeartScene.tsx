'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Html, Lightformer, Text } from '@react-three/drei';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import * as THREE from 'three';
import { CuboidCollider, Physics, type RapierRigidBody, RigidBody } from '@react-three/rapier';
import { ActiveCollisionTypes, RigidBodyType } from '@dimforge/rapier3d-compat';

import { type ThemeLighting, useTheme } from '@/components/ThemeProvider';
import { useUnified3DInput } from '@/hooks/useUnified3DInput';
import { resolveHeartFontUrl } from '../constants';
import { useHeartPhysics } from '../hooks/useHeartPhysics';
import { Heart3D } from './Heart3D';
import { ScreenBounds } from './ScreenBounds';
import { Sparkles } from './Sparkles';

export type PerformanceTier = 'high' | 'medium' | 'low';

type FpsTestableWindow = Window & {
  __mockFps?: number;
};

interface HeartSceneProps {
  scale: number;
  interacted: boolean;
  onInteract: () => void;
  performanceTier: PerformanceTier;
  onTierChange: (tier: PerformanceTier) => void;
  resetKey: number;
  onReady: () => void;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  lighting?: ThemeLighting;
  partner1Name?: string;
  partner2Name?: string;
  brideName?: string;
  groomName?: string;
}

/**
 * @function PhysicsHeart
 * @description The main interactive component of the HeartPage.
 * It's a physics-based heart that can be dragged around the screen. It pulses,
 * can be "broken" by colliding with the screen boundaries, and has an easter egg.
 */
function PhysicsHeart({
  scale,
  interacted,
  onInteract,
  primaryColor,
  secondaryColor,
  accentColor,
  partner1Name,
  partner2Name,
  brideName,
  groomName,
}: {
  scale: number;
  interacted: boolean;
  onInteract: () => void;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  partner1Name?: string;
  partner2Name?: string;
  brideName?: string;
  groomName?: string;
}) {
  const p1 = partner1Name || brideName || '';
  const p2 = partner2Name || groomName || '';
  const namesText = [p1, p2].filter(Boolean).join(' and ');
  const leftShardLabel = p1
    ? `Broken heart left segment: ${p1}.`
    : 'Broken heart left segment.';
  const rightShardLabel = p2
    ? `Broken heart right segment: ${p2}.`
    : 'Broken heart right segment.';
  const { physics } = useTheme();
  const heartRef = useRef<RapierRigidBody>(null!);
  const brokenHeartLeftRef = useRef<RapierRigidBody>(null!);
  const brokenHeartRightRef = useRef<RapierRigidBody>(null!);
  const groupRef = useRef<THREE.Group>(null!);
  const [pulseSpeed, setPulseSpeed] = useState(physics.pulseSpeedIdle);
  const [showEasterEgg, setShowEasterEgg] = useState(false);
  const baseWholeHeartLabel = namesText
    ? `Interactive 3D Heart: ${namesText}. Status: Whole.`
    : 'Interactive 3D Heart. Status: Whole.';
  const wholeHeartLabel = showEasterEgg
    ? `${baseWholeHeartLabel} Secret message revealed: I love you!`
    : baseWholeHeartLabel;
  const { size, viewport } = useThree();

  const wholeButtonRef = useRef<HTMLButtonElement | null>(null);
  const leftButtonRef = useRef<HTMLButtonElement | null>(null);
  const rightButtonRef = useRef<HTMLButtonElement | null>(null);
  const focusedButtonRef = useRef<'none' | 'whole' | 'left' | 'right'>('none');

  const handleFocus = (type: 'whole' | 'left' | 'right') => {
    focusedButtonRef.current = type;
  };

  const handleBlur = (type: 'whole' | 'left' | 'right') => {
    setTimeout(() => {
      if (focusedButtonRef.current === type) {
        focusedButtonRef.current = 'none';
      }
    }, 50);
  };

  const {
    handlers: mainHandlers,
    getInteractiveProps: getMainInteractiveProps,
    AccessibleElements: MainAccessibleElements,
    lifecycle: {
      isDestroyed: isBroken,
      destroy: breakHeart,
      reconstruct: reconstructHeart,
    },
    reduceMotion,
  } = useUnified3DInput({
    r3f: { size, viewport },
    reconstructTimeout: 3000,
    accessibility: {
      instructions: 'Use arrow keys to move the heart, Space or Enter to break it.',
      labels: {
        up: 'Moved up',
        down: 'Moved down',
        left: 'Moved left',
        right: 'Moved right',
        action: 'Heart broken',
      },
      onUp: () => {
        if (!heartRef.current) return;
        if (!interacted) onInteract();
        heartRef.current.applyImpulse({ x: 0, y: physics.accessibilityImpulse, z: 0 }, true);
      },
      onDown: () => {
        if (!heartRef.current) return;
        if (!interacted) onInteract();
        heartRef.current.applyImpulse({ x: 0, y: -physics.accessibilityImpulse, z: 0 }, true);
      },
      onLeft: () => {
        if (!heartRef.current) return;
        if (!interacted) onInteract();
        heartRef.current.applyImpulse({ x: -physics.accessibilityImpulse, y: 0, z: 0 }, true);
      },
      onRight: () => {
        if (!heartRef.current) return;
        if (!interacted) onInteract();
        heartRef.current.applyImpulse({ x: physics.accessibilityImpulse, y: 0, z: 0 }, true);
      },
      onAction: (e) => {
        if (!heartRef.current) return;
        e.preventDefault();
        breakHeart();
      },
    },
    onDragStart: () => {
      if (!interacted) onInteract();
      setPulseSpeed(physics.pulseSpeedDragging);
      if (heartRef.current) {
        heartRef.current.setBodyType(RigidBodyType.KinematicPositionBased, true);
      }
    },
    onDragMove: (norm) => {
      if (heartRef.current) {
        heartRef.current.setNextKinematicTranslation({
          x: norm.x * viewport.width,
          y: -norm.y * viewport.height,
          z: heartRef.current.translation().z,
        });
      }
    },
    onDragEnd: ({ vx, vy }) => {
      setPulseSpeed(physics.pulseSpeedIdle);
      if (heartRef.current) {
        heartRef.current.setBodyType(RigidBodyType.Dynamic, true);
        if (!reduceMotion && (Math.abs(vx) > 0.1 || Math.abs(vy) > 0.1)) {
          heartRef.current.setLinvel(
            {
              x: vx * physics.dragVelocityMultiplier,
              y: -vy * physics.dragVelocityMultiplier,
              z: 0,
            },
            true,
          );
        }
      }
    },
    onDestroy: () => {
      if (heartRef.current) {
        heartRef.current.setBodyType(RigidBodyType.Dynamic, true);
      }
    },
  });

  const {
    getInteractiveProps: getLeftInteractiveProps,
    AccessibleElements: LeftAccessibleElements,
  } = useUnified3DInput({
    accessibility: {
      instructions: 'Press Space or Enter to reconstruct the heart.',
      labels: { action: 'Heart reconstructed' },
      onAction: (e) => {
        e.preventDefault();
        reconstructHeart();
      },
    },
  });

  const {
    getInteractiveProps: getRightInteractiveProps,
    AccessibleElements: RightAccessibleElements,
  } = useUnified3DInput({
    accessibility: {
      instructions: 'Press Space or Enter to reconstruct the heart.',
      labels: { action: 'Heart reconstructed' },
      onAction: (e) => {
        e.preventDefault();
        reconstructHeart();
      },
    },
  });

  const { handleContactForce } = useHeartPhysics({
    mainRbRef: heartRef,
    leftRbRef: brokenHeartLeftRef,
    rightRbRef: brokenHeartRightRef,
    groupRef,
    isBroken,
    reduceMotion,
    interacted,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    pulseSpeed,
    breakHeart,
    setShowEasterEgg,
  });

  useEffect(() => {
    if (isBroken) {
      if (focusedButtonRef.current === 'whole') {
        const focusLeft = () => {
          if (leftButtonRef.current) {
            leftButtonRef.current.focus();
          } else {
            const btn = document.querySelector('[aria-label="Broken heart left segment."]') as HTMLElement | null;
            if (btn) {
              btn.focus();
            } else {
              requestAnimationFrame(focusLeft);
            }
          }
        };
        requestAnimationFrame(focusLeft);
      }
    } else {
      if (focusedButtonRef.current === 'left' || focusedButtonRef.current === 'right') {
        const focusWhole = () => {
          if (wholeButtonRef.current) {
            wholeButtonRef.current.focus();
          } else {
            const btn = document.querySelector('[aria-label^="Interactive 3D Heart"]') as HTMLElement | null;
            if (btn) {
              btn.focus();
            } else {
              requestAnimationFrame(focusWhole);
            }
          }
        };
        requestAnimationFrame(focusWhole);
      }
    }
  }, [isBroken]);

  return (
    <>
      <Html zIndexRange={[100, 0]} prepend center>
        {MainAccessibleElements}
        <div className="sr-only" role="status" aria-live="polite">
          {isBroken ? 'Heart is broken.' : showEasterEgg ? 'I love you!' : 'Heart is whole.'}
        </div>
        {showEasterEgg && (
          <div className="sr-only">I love you!</div>
        )}
        {!isBroken && (
          <button
            type="button"
            ref={wholeButtonRef}
            onFocus={() => handleFocus('whole')}
            onBlur={() => handleBlur('whole')}
            className="opacity-0 focus:opacity-100 focus:outline-none focus:ring-4 focus:ring-white w-32 h-32 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-auto"
            aria-label={wholeHeartLabel}
            {...getMainInteractiveProps()}
          />
        )}
      </Html>

      <RigidBody
        userData={{ id: 'main' }}
        ref={heartRef}
        restitution={0.9}
        colliders={false}
        onContactForce={handleContactForce}
        // @ts-expect-error - activeEvents is not in the type definition but is required for onContactForce
        activeEvents={ActiveCollisionTypes.CONTACT_FORCE_EVENTS}
      >
        <CuboidCollider args={[1.5 * scale, 1.5 * scale, 0.8 * scale]} />
        <group
          ref={groupRef}
          {...mainHandlers}
          visible={!isBroken}
        >
          <Heart3D scale={scale} primaryColor={primaryColor} secondaryColor={secondaryColor} partner1Name={p1} partner2Name={p2} />
        </group>
      </RigidBody>

      <RigidBody userData={{ id: 'left' }} ref={brokenHeartLeftRef} colliders={false} restitution={0.9} type={'fixed'}>
        <CuboidCollider args={[0.75 * scale, 1.5 * scale, 0.8 * scale]} position={[-0.75 * scale, 0, 0]} />
        <group visible={isBroken}>
          <Heart3D scale={scale} primaryColor={primaryColor} secondaryColor={secondaryColor} partner1Name={p1} partner2Name={p2} shardSide="left" />
        </group>
        {isBroken && (
          <Html zIndexRange={[100, 0]} prepend center>
            {LeftAccessibleElements}
            <button
              type="button"
              ref={leftButtonRef}
              onFocus={() => handleFocus('left')}
              onBlur={() => handleBlur('left')}
              className="opacity-0 focus:opacity-100 focus:outline-none focus:ring-4 focus:ring-white w-16 h-32 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-auto"
              aria-label={leftShardLabel}
              {...getLeftInteractiveProps()}
            />
          </Html>
        )}
      </RigidBody>
      <RigidBody userData={{ id: 'right' }} ref={brokenHeartRightRef} colliders={false} restitution={0.9} type={'fixed'}>
        <CuboidCollider args={[0.75 * scale, 1.5 * scale, 0.8 * scale]} position={[0.75 * scale, 0, 0]} />
        <group visible={isBroken}>
          <Heart3D scale={scale} primaryColor={primaryColor} secondaryColor={secondaryColor} partner1Name={p1} partner2Name={p2} shardSide="right" />
        </group>
        {isBroken && (
          <Html zIndexRange={[100, 0]} prepend center>
            {RightAccessibleElements}
            <button
              type="button"
              ref={rightButtonRef}
              onFocus={() => handleFocus('right')}
              onBlur={() => handleBlur('right')}
              className="opacity-0 focus:opacity-100 focus:outline-none focus:ring-4 focus:ring-white w-16 h-32 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-auto"
              aria-label={rightShardLabel}
              {...getRightInteractiveProps()}
            />
          </Html>
        )}
      </RigidBody>

      {showEasterEgg && (
        <Text
          font={resolveHeartFontUrl()}
          position={[0, 0, 5]}
          fontSize={1.5}
          anchorX="center"
          anchorY="middle"
        >
          I love you!
          <meshStandardMaterial color={accentColor} />
        </Text>
      )}
    </>
  );
}

function PerformanceTracker({
  currentTier,
  onTierChange,
}: {
  currentTier: PerformanceTier;
  onTierChange: (tier: PerformanceTier) => void;
}) {
  const lowFpsAccumulatorRef = useRef(0);

  useFrame((_, delta) => {
    let fps = 1 / delta;

    if (typeof window !== 'undefined') {
      const mockFps = (window as FpsTestableWindow).__mockFps;
      if (mockFps !== undefined) {
        fps = mockFps;
      }
    }

    if (currentTier === 'low') return;

    if (fps < 30) {
      lowFpsAccumulatorRef.current += delta;
      if (lowFpsAccumulatorRef.current >= 3.0) {
        if (currentTier === 'high') {
          onTierChange('medium');
        } else if (currentTier === 'medium') {
          onTierChange('low');
        }
        lowFpsAccumulatorRef.current = 0;
      }
    } else {
      lowFpsAccumulatorRef.current = 0;
    }
  });

  return null;
}

function SceneReadyNotifier({ onReady }: { onReady: () => void }) {
  useEffect(() => {
    onReady();
  }, [onReady]);

  return null;
}

export default function HeartScene({
  scale,
  interacted,
  onInteract,
  performanceTier,
  onTierChange,
  resetKey,
  onReady,
  primaryColor,
  secondaryColor,
  accentColor,
  lighting,
  partner1Name,
  partner2Name,
  brideName,
  groomName,
}: HeartSceneProps) {
  return (
    <Canvas camera={{ position: [0, 0, 15], fov: 50 }} dpr={[1, 2]} gl={{ localClippingEnabled: true }}>
      <ambientLight intensity={lighting?.ambientIntensity ?? 0.8} />
      <directionalLight position={[5, 8, 5]} intensity={lighting?.directionalIntensity ?? 1.6} />
      <PerformanceTracker currentTier={performanceTier} onTierChange={onTierChange} />
      <Suspense fallback={null}>
        <Physics key={resetKey} gravity={[0, 0, 0]}>
          {performanceTier !== 'low' && <Sparkles />}
          {performanceTier !== 'low' && (
            <Environment frames={1} resolution={256}>
              <Lightformer
                form="ring"
                intensity={2.5}
                color="#ffd6a5"
                position={[0, 4, 8]}
                scale={6}
              />
              <Lightformer
                form="rect"
                intensity={2}
                color="#ff9e6d"
                position={[8, 3, 4]}
                scale={[10, 6, 1]}
              />
              <Lightformer
                form="rect"
                intensity={1.5}
                color="#ff758f"
                position={[-8, 2, 4]}
                scale={[10, 6, 1]}
              />
              <Lightformer
                form="rect"
                intensity={1.2}
                color="#fff1d0"
                position={[0, 8, -4]}
                scale={[12, 8, 1]}
              />
              <Lightformer
                form="circle"
                intensity={1}
                color="#c77dff"
                position={[0, -6, -6]}
                scale={10}
              />
            </Environment>
          )}
          <PhysicsHeart
            scale={scale}
            interacted={interacted}
            onInteract={onInteract}
            primaryColor={primaryColor}
            secondaryColor={secondaryColor}
            accentColor={accentColor}
            partner1Name={partner1Name}
            partner2Name={partner2Name}
            brideName={brideName}
            groomName={groomName}
          />
          <ScreenBounds />
        </Physics>
        {performanceTier === 'high' && (
          <EffectComposer>
            <Bloom mipmapBlur intensity={0.5} luminanceThreshold={0.35} luminanceSmoothing={0.9} />
          </EffectComposer>
        )}
        <SceneReadyNotifier onReady={onReady} />
      </Suspense>
    </Canvas>
  );
}
