# 3D Technical Guide: Modular Heart Architecture

## Overview
The 3D interactive heart is a complex, physics-enabled scene powered by `@react-three/fiber` and `@react-three/rapier`. It has been refactored to decouple logic, visual components, and hardcoded physics constants to improve maintainability and allow easy feature extension.

## Scene Structure
- **HeartClient**: The main page container that orchestrates the Canvas, rendering context, environment, lighting, post-processing (Bloom), and UI overlays.
- **PhysicsHeart**: The central interactive component wrapping physics handling and rendering components.
- **HeartWhole / HeartShard**: Visual elements making up the heart model.
- **Sparkles**: A visual effect rendered behind the heart.
- **ScreenBounds**: Invisible physical boundaries keeping the heart contained.

## State Management
Physics logic, impulses, and configuration have been moved to the `useHeartPhysics` hook. State such as `isBroken` or the `reduceMotion` accessibility setting is consumed via `useUnified3DInput`.

### Physics Constants
All hardcoded physics multipliers and impulse definitions are now located in `src/app/heart/constants.ts`. Adjustments to bounciness, explosion torque, break magnitude, and accessible impulse forces should be made here to affect the interaction feel instantly.

### Breaking and Explosion
When a contact force exceeding the `BREAK_FORCE_THRESHOLD` (currently `200`) occurs:
1. The `mainRb` (Whole Heart) is disabled.
2. The `leftRb` and `rightRb` are enabled and inherit the main body's translation, rotation, linear, and angular velocities.
3. Impulses from `PHYSICS_CONSTANTS` are applied to create the explosion effect.

## Adding Features
- **Visuals**: Add new components to the `/components` folder and include them inside the `<Physics>` context in `HeartClient.tsx`.
- **Interactions**: Tweak variables inside `constants.ts`.
- **Physics**: Expand `useHeartPhysics.ts` to add more complex behaviors like magnetic attraction or distinct hit sounds based on velocity.
