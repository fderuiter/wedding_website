# 3D Technical Guide: Modular Heart Architecture

## Overview
The 3D interactive heart is a complex, physics-enabled scene powered by `@react-three/fiber` and `@react-three/rapier`. It has been refactored to decouple logic, visual components, and hardcoded physics constants to improve maintainability and allow easy feature extension.

## Scene Structure
- **HeartClient**: The main page container (`src/app/heart/HeartClient.tsx`) that orchestrates the Canvas, rendering context, environment, lighting, post-processing (Bloom), and UI overlays.
- **PhysicsHeart**: The central interactive component residing inside `src/app/heart/HeartClient.tsx` (L26–L322) that wraps physics handling, rigid bodies, colliders, and rendering components.
- **Heart3D**: Consolidated visual component (`src/app/heart/components/Heart3D.tsx`) that renders heart mesh geometry and partner name text labels. It uses the `shardSide` prop flag (`'left'`, `'right'`, or omitted/`undefined`) to render either a whole heart or split heart shards (L82–L108).
- **Sparkles**: A visual effect rendered behind the heart (`src/app/heart/components/Sparkles.tsx`).
- **ScreenBounds**: Invisible physical boundaries keeping the heart contained (`src/app/heart/components/ScreenBounds.tsx`).

## State Management
Physics logic, impulses, and configuration are encapsulated in the `useHeartPhysics` hook (`src/app/heart/hooks/useHeartPhysics.ts`). Interaction state such as `isBroken` or the `reduceMotion` accessibility setting is consumed via `useUnified3DInput`.

### Physics Constants & Dynamic Theme Configuration
Default physics multipliers and impulse definitions are defined in `src/app/heart/constants.ts` under `PHYSICS_CONSTANTS`. `ThemeProvider` manages physics options in `src/components/ThemeProvider.tsx` (L101–L115), initializing theme state from these default constants.

Components and hooks—specifically `useHeartPhysics` in `src/app/heart/hooks/useHeartPhysics.ts` (L43)—consume dynamic physics parameters using `const { physics } = useTheme()`. This allows physics constants (such as break threshold, impulse multipliers, and rotation speeds) to be updated or customized dynamically at runtime via the theme provider context.

### Breaking and Explosion
When a contact force exceeding `physics.breakForceThreshold` (defaulting to `BREAK_FORCE_THRESHOLD` of `200` in `constants.ts`) occurs:
1. The main rigid body (`mainRb`) for the whole heart is disabled.
2. The `leftRb` and `rightRb` rigid bodies are enabled, rendering individual `Heart3D` instances with `shardSide="left"` and `shardSide="right"`, inheriting the main body's translation, rotation, linear, and angular velocities.
3. Explosion impulses and torque defined in `physics` (such as `physics.explosionImpulseLeft`, `physics.explosionImpulseRight`, and `physics.explosionTorqueStrength`) are applied to create the explosion effect.

## Adding Features
- **Visuals**: Add new components to the `src/app/heart/components/` folder and include them inside the `<Physics>` context in `HeartClient.tsx`.
- **Interactions & Configuration**: Update default variables in `src/app/heart/constants.ts` or customize dynamic physics properties in `src/components/ThemeProvider.tsx`.
- **Physics**: Expand `useHeartPhysics.ts` to add more complex behaviors like magnetic attraction or distinct hit sounds based on velocity.
