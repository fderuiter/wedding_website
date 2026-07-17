'use client';

import { Canvas, useThree } from '@react-three/fiber';
import { Environment, Html, Text } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import { Suspense, useRef, useState, useEffect } from 'react';
import Link from 'next/link';
import { Physics, RigidBody, CuboidCollider, RapierRigidBody } from '@react-three/rapier';
import { ActiveCollisionTypes, RigidBodyType } from '@dimforge/rapier3d-compat';

import { useTheme } from '@/components/ThemeProvider';
import { useOverlay } from '@/hooks/useOverlay';
import { useUnified3DInput } from '../../hooks/useUnified3DInput';
import { Sparkles } from './components/Sparkles';
import { Heart3D } from './components/Heart3D';
import { ScreenBounds } from './components/ScreenBounds';
import { useHeartPhysics } from './hooks/useHeartPhysics';
import { PHYSICS_CONSTANTS } from './constants';

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
  brideName,
  groomName
}: {
  scale: number
  interacted: boolean
  onInteract: () => void
  primaryColor: string
  secondaryColor: string
  accentColor: string
  brideName: string
  groomName: string
}) {
  const heartRef = useRef<RapierRigidBody>(null!);
  const brokenHeartLeftRef = useRef<RapierRigidBody>(null!);
  const brokenHeartRightRef = useRef<RapierRigidBody>(null!);
  const groupRef = useRef<THREE.Group>(null!);
  const [pulseSpeed, setPulseSpeed] = useState(PHYSICS_CONSTANTS.PULSE_SPEED_IDLE);
  const [showEasterEgg, setShowEasterEgg] = useState(false);
  const { size, viewport } = useThree();

  const { handlers: mainHandlers, getInteractiveProps: getMainInteractiveProps, AccessibleElements: MainAccessibleElements, lifecycle: { isDestroyed: isBroken, destroy: breakHeart }, reduceMotion } = useUnified3DInput({
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
        heartRef.current.applyImpulse({ x: 0, y: PHYSICS_CONSTANTS.ACCESSIBILITY_IMPULSE, z: 0 }, true);
      },
      onDown: () => {
        if (!heartRef.current) return;
        if (!interacted) onInteract();
        heartRef.current.applyImpulse({ x: 0, y: -PHYSICS_CONSTANTS.ACCESSIBILITY_IMPULSE, z: 0 }, true);
      },
      onLeft: () => {
        if (!heartRef.current) return;
        if (!interacted) onInteract();
        heartRef.current.applyImpulse({ x: -PHYSICS_CONSTANTS.ACCESSIBILITY_IMPULSE, y: 0, z: 0 }, true);
      },
      onRight: () => {
        if (!heartRef.current) return;
        if (!interacted) onInteract();
        heartRef.current.applyImpulse({ x: PHYSICS_CONSTANTS.ACCESSIBILITY_IMPULSE, y: 0, z: 0 }, true);
      },
      onAction: (e: any) => {
        if (!heartRef.current) return;
        e.preventDefault();
        breakHeart();
      }
    },
    onDragStart: () => {
      if (!interacted) onInteract();
      setPulseSpeed(PHYSICS_CONSTANTS.PULSE_SPEED_DRAGGING);
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
      setPulseSpeed(PHYSICS_CONSTANTS.PULSE_SPEED_IDLE);
      if (heartRef.current) {
        heartRef.current.setBodyType(RigidBodyType.Dynamic, true);
        if (!reduceMotion && (Math.abs(vx) > 0.1 || Math.abs(vy) > 0.1)) {
          heartRef.current.setLinvel({
            x: vx * PHYSICS_CONSTANTS.DRAG_VELOCITY_MULTIPLIER,
            y: -vy * PHYSICS_CONSTANTS.DRAG_VELOCITY_MULTIPLIER,
            z: 0
          }, true);
        }
      }
    },
    onDestroy: () => {
      if (heartRef.current) {
        heartRef.current.setBodyType(RigidBodyType.Dynamic, true);
      }
    }
  });

  const {   getInteractiveProps: getLeftInteractiveProps, AccessibleElements: LeftAccessibleElements } = useUnified3DInput({
    accessibility: {
      instructions: 'Press Space or Enter to bump the left segment.',
      labels: { action: 'Bumped left segment' },
      onAction: (e: any) => {
        if (!brokenHeartLeftRef.current) return;
        e.preventDefault();
        if (!reduceMotion) {
          brokenHeartLeftRef.current.applyImpulse({ x: (Math.random() - 0.5) * PHYSICS_CONSTANTS.BUMP_IMPULSE_RANDOM_MULTIPLIER, y: PHYSICS_CONSTANTS.BUMP_IMPULSE_Y, z: (Math.random() - 0.5) * PHYSICS_CONSTANTS.BUMP_IMPULSE_RANDOM_MULTIPLIER }, true);
        }
      }
    }
  });

  const {   getInteractiveProps: getRightInteractiveProps, AccessibleElements: RightAccessibleElements } = useUnified3DInput({
    accessibility: {
      instructions: 'Press Space or Enter to bump the right segment.',
      labels: { action: 'Bumped right segment' },
      onAction: (e: any) => {
        if (!brokenHeartRightRef.current) return;
        e.preventDefault();
        if (!reduceMotion) {
          brokenHeartRightRef.current.applyImpulse({ x: (Math.random() - 0.5) * PHYSICS_CONSTANTS.BUMP_IMPULSE_RANDOM_MULTIPLIER, y: PHYSICS_CONSTANTS.BUMP_IMPULSE_Y, z: (Math.random() - 0.5) * PHYSICS_CONSTANTS.BUMP_IMPULSE_RANDOM_MULTIPLIER }, true);
        }
      }
    }
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
    setShowEasterEgg
  });

  return (
    <>
      <Html zIndexRange={[100, 0]} prepend center>
        {MainAccessibleElements}
        <div className="sr-only" aria-live="polite">
          {isBroken ? 'Heart is broken.' : 'Heart is whole.'}
        </div>
        {!isBroken && (
          <button
            className="opacity-0 focus:opacity-100 focus:outline-none focus:ring-4 focus:ring-white w-32 h-32 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-auto"
            aria-label={'Interactive 3D Heart. Status: Whole.'}
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
          <Heart3D scale={scale} primaryColor={primaryColor} secondaryColor={secondaryColor} brideName={brideName} groomName={groomName} />
        </group>
      </RigidBody>

      <RigidBody userData={{ id: 'left' }} ref={brokenHeartLeftRef} colliders={false} restitution={0.9} type={'fixed'}>
        <CuboidCollider args={[0.75 * scale, 1.5 * scale, 0.8 * scale]} position={[-0.75 * scale, 0, 0]} />
        <group visible={isBroken}>
          <Heart3D scale={scale} primaryColor={primaryColor} secondaryColor={secondaryColor} brideName={brideName} groomName={groomName} shardSide="left" />
        </group>
        {isBroken && (
          <Html zIndexRange={[100, 0]} prepend center>
            {LeftAccessibleElements}
            <button
              className="opacity-0 focus:opacity-100 focus:outline-none focus:ring-4 focus:ring-white w-16 h-32 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-auto"
              aria-label={'Broken heart left segment.'}
              {...getLeftInteractiveProps()}
            />
          </Html>
        )}
      </RigidBody>
      <RigidBody userData={{ id: 'right' }} ref={brokenHeartRightRef} colliders={false} restitution={0.9} type={'fixed'}>
        <CuboidCollider args={[0.75 * scale, 1.5 * scale, 0.8 * scale]} position={[0.75 * scale, 0, 0]} />
        <group visible={isBroken}>
          <Heart3D scale={scale} primaryColor={primaryColor} secondaryColor={secondaryColor} brideName={brideName} groomName={groomName} shardSide="right" />
        </group>
        {isBroken && (
          <Html zIndexRange={[100, 0]} prepend center>
            {RightAccessibleElements}
            <button
              className="opacity-0 focus:opacity-100 focus:outline-none focus:ring-4 focus:ring-white w-16 h-32 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-auto"
              aria-label={'Broken heart right segment.'}
              {...getRightInteractiveProps()}
            />
          </Html>
        )}
      </RigidBody>

      {showEasterEgg && (
        <Text position={[0, 0, 5]} fontSize={1.5} anchorX="center" anchorY="middle">
          I love you!
          <meshStandardMaterial color={accentColor} />
        </Text>
      )}
    </>
  );
}

/**
 * @page HeartPage
 * @description An interactive, physics-based 3D heart page using `@react-three/fiber` and `@react-three/rapier`.
 *
 * This page features a large, draggable 3D heart in the center of the screen. Users can
 * fling the heart around, and it will bounce off the edges of the screen. Colliding too
 * hard will cause the heart to "break" into two pieces, which then reform. The scene
 * includes a starry background, post-processing effects, and a reset button.
 *
 * @returns {JSX.Element} The rendered HeartPage component.
 */
export default function HeartClient({ brideName, groomName }: { brideName: string, groomName: string }) {
  const { themePrimary, themeSecondary, themeAccent } = useTheme();
  const [interacted, setInteracted] = useState(false);
  const [scale, setScale] = useState(0.6);
  const [resetKey, setResetKey] = useState(0);

  const { overlayRef } = useOverlay(true, () => {});

  const handleReset = () => {
    setInteracted(false);
    setResetKey((prevKey) => prevKey + 1);
  };

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setScale(mobile ? 0.4 : 0.6);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div ref={overlayRef} className="fixed inset-0 bg-black select-none">
      <div className="absolute top-0 right-0 z-[60] m-4 flex gap-2">
        <button
          onClick={handleReset}
          className="rounded bg-white/80 px-3 py-1 text-sm hover:bg-white"
          aria-label="Reset heart"
        >
          Reset
        </button>
        <Link href="/" className="rounded bg-white/80 px-3 py-1 text-sm hover:bg-white">
          Back Home
        </Link>
      </div>
      <Canvas camera={{ position: [0, 0, 15], fov: 50 }} dpr={[1, 2]} gl={{ localClippingEnabled: true }}>
        <ambientLight intensity={0.8} />
        <directionalLight position={[5, 8, 5]} intensity={1.6} />
        <Suspense fallback={<Html>Loading…</Html>}>
          <Physics key={resetKey} gravity={[0, 0, 0]}>
            <Sparkles color={themeAccent} />
            <Environment preset="sunset" />
            <PhysicsHeart 
              scale={scale} 
              interacted={interacted} 
              onInteract={() => setInteracted(true)} 
              primaryColor={themePrimary}
              secondaryColor={themeSecondary}
              accentColor={themeAccent}
              brideName={brideName}
              groomName={groomName}
            />
            <ScreenBounds />
          </Physics>
          <EffectComposer>
            <Bloom mipmapBlur intensity={0.5} luminanceThreshold={0.35} luminanceSmoothing={0.9} />
          </EffectComposer>
        </Suspense>
      </Canvas>
    </div>
  );
}
