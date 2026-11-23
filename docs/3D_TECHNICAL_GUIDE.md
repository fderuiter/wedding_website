# 3D Technical Guide: Interactive Heart, Theme Tokens, and Shared 3D Primitives

This specification documents the 3D and pseudo-3D subsystem across the `/heart` React Three Fiber (`@react-three/fiber` + `@react-three/rapier`) scene, `ThemeProvider` read-only token derivation, shared DOM card tilt (`Interactive3DCard`), and unified pointer/keyboard accessibility hooks (`useUnified3DInput` and `use3DInteraction`). Portal builds stage this file to `docs-portal/features/3d-technical-guide.md` via [`ARCHITECTURAL_DOCS`](../scripts/check-doc-links.ts#L113-L118) (L113-L118) and [`scripts/generate-portal.ts`](../scripts/generate-portal.ts#L293-L326) (L293-L326).

---

## 1. Architecture Overview

The 3D subsystem is split into three layers so WebGL scenes and DOM tilt surfaces share input normalization, reduced-motion guards, and theme tokens without coupling runtime state:

1. **Read-Only Theme & Preset Tokens**: [`src/lib/theme/presets.ts`](../src/lib/theme/presets.ts#L140-L179) (L140-L179) defines CSS custom properties for 3D materials, Rapier physics parameters, extrusion geometry, lighting, glow filters, and card tilt springs across all five presets (`classic`, `modern`, `romantic`, `minimal`, `editorial`). [`src/components/ThemeProvider.tsx`](../src/components/ThemeProvider.tsx#L496-L569) (L496-L569) parses these tokens into memoized, read-only context values.
2. **`/heart` Physics Scene & Fallbacks**: [`src/app/heart/page.tsx`](../src/app/heart/page.tsx#L12-L25) (L12-L25) gates `/heart` behind guest session authentication and the `interactive3D` feature module flag (`FEATURE_MODULES.md`: [`FEATURE_MODULES.md`](../FEATURE_MODULES.md)), then passes partner names into [`src/app/heart/HeartClient.tsx`](../src/app/heart/HeartClient.tsx#L571-L727) (L571-L727). `HeartClient` orchestrates synchronous WebGL 2 detection via `useSyncExternalStore`, a 2D SVG fallback (`WebGLFallback`), a plain DOM loading overlay outside `<Canvas>`, 3-tier FPS degradation (`PerformanceTracker`), and `PhysicsHeart` ([`src/app/heart/HeartClient.tsx`](../src/app/heart/HeartClient.tsx#L27-L335) (L27-L335)).
3. **Shared Input, Accessibility & DOM Tilt**: [`src/components/ui/Interactive3DCard.tsx`](../src/components/ui/Interactive3DCard.tsx#L42-L220) (L42-L220) and `PhysicsHeart` both consume [`src/hooks/useUnified3DInput.ts`](../src/hooks/useUnified3DInput.ts#L5-L244) (L5-L244), which pairs normalized pointer/touch tracking and auto-reconstruction timers with [`src/hooks/use3DInteraction.tsx`](../src/hooks/use3DInteraction.tsx#L19-L130) (L19-L130) and [`src/hooks/useReducedMotion.ts`](../src/hooks/useReducedMotion.ts#L3-L27) (L3-L27).

---

## 2. Theme Token Derivation & `PHYSICS_CONSTANTS`

### Read-Only `ThemeProvider` Derivation (Zero Physics Setters)

`ThemeProvider` does **not** store mutable runtime physics state or expose setter functions for 3D parameters:

- **Context Contract**: `ThemeContextType` in [`src/components/ThemeProvider.tsx`](../src/components/ThemeProvider.tsx#L52-L84) (L52-L84) exposes only `setThemeMode` (for `'light' | 'dark' | 'system'` color mode switching) and zero physics, extrusion, lighting, or card setters.
- **Static Fallback Defaults**: `createContext<ThemeContextType>({ ... })` in [`src/components/ThemeProvider.tsx`](../src/components/ThemeProvider.tsx#L86-L141) (L86-L141) defines static fallback values (initializing `physics` from `PHYSICS_CONSTANTS` at L112-L126) used only when `useTheme()` is called outside a mounted `<ThemeProvider>`.
- **Memoized Token Computation**: Inside `ThemeProvider`, [`src/components/ThemeProvider.tsx`](../src/components/ThemeProvider.tsx#L496-L569) (L496-L569) computes `activePresetTokens` via `useMemo` by merging `getPresetTokens(themePreset)` from [`src/lib/theme/presets.ts`](../src/lib/theme/presets.ts#L1811-L1827) (L1811-L1827) with persisted `AppConfig.themeTokens` overrides. It then derives read-only `metalness`, `roughness`, `envMapIntensity`, `cardPerspective`, `cardMaxRotation`, `cardSpringStiffness`, `cardSpringDamping`, and memoized `physics` (`ThemePhysics`), `extrusion` (`ThemeExtrusion`), `lighting` (`ThemeLighting`), and `glowFilter` values via `parseTokenNum`, `parseTokenBool`, and `sanitizeTokenValue`.
- **Iframe Live Preview Overrides**: When rendered inside an admin preview `<iframe>` (`window !== window.parent`), [`src/components/ThemeProvider.tsx`](../src/components/ThemeProvider.tsx#L418-L447) (L418-L447) listens for `MessageEvent` payloads matching `event.data?.type === 'DRAFT_UPDATE'` and `event.data.draftType === 'config'`, sanitizing incoming `themePreset` and `themeTokens` into `draftConfigOverride` so derived 3D tokens recompute without mutating context imperatives.

### Preset CSS Custom Properties (`presets.ts`)

`ComponentTokens` in [`src/lib/theme/presets.ts`](../src/lib/theme/presets.ts#L140-L171) (L140-L171) defines **27 `--3d-*` tokens**, **`--glow-filter`**, and **4 `--card-*` tokens**, alongside **3 `--motion-*` spring/tilt tokens** in [`src/lib/theme/presets.ts`](../src/lib/theme/presets.ts#L177-L179) (L177-L179):

| Category | Count | CSS Custom Properties | Consumed By |
| :--- | :---: | :--- | :--- |
| **3D Material** | 3 | `--3d-metalness`, `--3d-roughness`, `--3d-env-map-intensity` | `ThemeProvider` (`metalness`, `roughness`, `envMapIntensity`) -> `Heart3D` `MeshPhysicalMaterial` |
| **3D Physics** | 17 | `--3d-physics-accessibility-impulse`, `--3d-physics-drag-velocity-multiplier`, `--3d-physics-bump-impulse-y`, `--3d-physics-bump-impulse-random-multiplier`, `--3d-physics-break-force-threshold`, `--3d-physics-explosion-impulse-left-x`, `--3d-physics-explosion-impulse-left-y`, `--3d-physics-explosion-impulse-left-z`, `--3d-physics-explosion-impulse-right-x`, `--3d-physics-explosion-impulse-right-y`, `--3d-physics-explosion-impulse-right-z`, `--3d-physics-explosion-torque-strength`, `--3d-physics-return-force-multiplier`, `--3d-physics-pulse-speed-dragging`, `--3d-physics-pulse-speed-idle`, `--3d-physics-pulse-scale-multiplier`, `--3d-physics-idle-rotation-speed` | `ThemeProvider` (`physics: ThemePhysics`); note `--3d-physics-bump-impulse-y` and `--3d-physics-bump-impulse-random-multiplier` have no runtime readers |
| **3D Extrusion** | 5 | `--3d-extrusion-depth`, `--3d-extrusion-bevel-enabled`, `--3d-extrusion-bevel-thickness`, `--3d-extrusion-bevel-size`, `--3d-extrusion-bevel-segments` | `ThemeProvider` (`extrusion: ThemeExtrusion`) -> `Heart3D` `ExtrudeGeometry` |
| **3D Lighting** | 2 | `--3d-light-ambient-intensity`, `--3d-light-directional-intensity` | `ThemeProvider` (`lighting: ThemeLighting`) -> `HeartClient` `<ambientLight>` & `<directionalLight>` |
| **2D Fallback Glow** | 1 | `--glow-filter` | `ThemeProvider` (`glowFilter`) -> `WebGLFallback` SVG `style.filter` |
| **Card 3D Fallbacks** | 4 | `--card-perspective`, `--card-max-rotation`, `--card-spring-stiffness`, `--card-spring-damping` | `ThemeProvider` -> `Interactive3DCard` perspective and fallback spring/tilt limits |
| **Motion Spring & Tilt** | 3 | `--motion-spring-stiffness`, `--motion-spring-damping`, `--motion-tilt-max-deg` | `Interactive3DCard` primary spring stiffness, damping, and max tilt degrees |

### `HEART_FONT_URL` & Active vs. Unused `PHYSICS_CONSTANTS` (`src/app/heart/constants.ts`)

[`src/app/heart/constants.ts`](../src/app/heart/constants.ts#L1-L13) (L1-L13) exports `resolveHeartFontUrl` and `HEART_FONT_URL` (`/fonts/noto-sans-latin-400-normal.woff`, prefixed with a normalized `NEXT_PUBLIC_BASE_PATH` when deployed under a static showcase subpath) so `@react-three/drei` `<Text>` meshes render offline without external CDN requests. [`src/app/heart/constants.ts`](../src/app/heart/constants.ts#L15-L29) (L15-L29) also exports 13 entries in `PHYSICS_CONSTANTS`: **11 active** fallback constants consumed by `/heart` and **2 unused** legacy constants (`BUMP_IMPULSE_Y` and `BUMP_IMPULSE_RANDOM_MULTIPLIER`) at [`src/app/heart/constants.ts`](../src/app/heart/constants.ts#L18-L19) (L18-L19).

| Constant Key | Default Value | `ThemePhysics` Field | Status & Runtime Reader |
| :--- | :--- | :--- | :--- |
| `ACCESSIBILITY_IMPULSE` | `20` | `physics.accessibilityImpulse` | **Active** — Arrow-key `applyImpulse` in `PhysicsHeart` ([`src/app/heart/HeartClient.tsx`](../src/app/heart/HeartClient.tsx#L103-L122) (L103-L122)) |
| `DRAG_VELOCITY_MULTIPLIER` | `20` | `physics.dragVelocityMultiplier` | **Active** — Release `setLinvel` throw velocity in `PhysicsHeart` ([`src/app/heart/HeartClient.tsx`](../src/app/heart/HeartClient.tsx#L149-L155) (L149-L155)) |
| `BUMP_IMPULSE_Y` | `10` | `physics.bumpImpulseY` | **Unused** — Populated in `ThemeProvider`, zero runtime consumers ([`src/app/heart/constants.ts`](../src/app/heart/constants.ts#L18-L19) (L18-L19)) |
| `BUMP_IMPULSE_RANDOM_MULTIPLIER` | `10` | `physics.bumpImpulseRandomMultiplier` | **Unused** — Populated in `ThemeProvider`, zero runtime consumers ([`src/app/heart/constants.ts`](../src/app/heart/constants.ts#L18-L19) (L18-L19)) |
| `BREAK_FORCE_THRESHOLD` | `200` | `physics.breakForceThreshold` | **Active** — `handleContactForce` threshold in [`src/app/heart/hooks/useHeartPhysics.ts`](../src/app/heart/hooks/useHeartPhysics.ts#L46-L50) (L46-L50) |
| `EXPLOSION_IMPULSE_LEFT` | `{ x: 20, y: 15, z: 5 }` | `physics.explosionImpulseLeft` | **Active** — Left shard `applyImpulse` in [`src/app/heart/hooks/useHeartPhysics.ts`](../src/app/heart/hooks/useHeartPhysics.ts#L88-L90) (L88-L90) |
| `EXPLOSION_IMPULSE_RIGHT` | `{ x: -20, y: 15, z: -5 }` | `physics.explosionImpulseRight` | **Active** — Right shard `applyImpulse` in [`src/app/heart/hooks/useHeartPhysics.ts`](../src/app/heart/hooks/useHeartPhysics.ts#L88-L90) (L88-L90) |
| `EXPLOSION_TORQUE_STRENGTH` | `40` | `physics.explosionTorqueStrength` | **Active** — Random shard `applyTorqueImpulse` in [`src/app/heart/hooks/useHeartPhysics.ts`](../src/app/heart/hooks/useHeartPhysics.ts#L92-L105) (L92-L105) |
| `RETURN_FORCE_MULTIPLIER` | `15` | `physics.returnForceMultiplier` | **Active** — Post-interaction origin return `addForce` in [`src/app/heart/hooks/useHeartPhysics.ts`](../src/app/heart/hooks/useHeartPhysics.ts#L166-L183) (L166-L183) |
| `PULSE_SPEED_DRAGGING` | `5` | `physics.pulseSpeedDragging` | **Active** — Elevated pulse frequency during `onDragStart` in [`src/app/heart/HeartClient.tsx`](../src/app/heart/HeartClient.tsx#L129-L131) (L129-L131) |
| `PULSE_SPEED_IDLE` | `1` | `physics.pulseSpeedIdle` | **Active** — Initial and post-drag pulse frequency in [`src/app/heart/HeartClient.tsx`](../src/app/heart/HeartClient.tsx#L64-L146) (L64-L146) |
| `PULSE_SCALE_MULTIPLIER` | `0.05` | `physics.pulseScaleMultiplier` | **Active** — Sinusoidal scale amplitude in [`src/app/heart/hooks/useHeartPhysics.ts`](../src/app/heart/hooks/useHeartPhysics.ts#L193-L198) (L193-L198) |
| `IDLE_ROTATION_SPEED` | `0.002` | `physics.idleRotationSpeed` | **Active** — Pre-interaction Y-axis Euler step in [`src/app/heart/hooks/useHeartPhysics.ts`](../src/app/heart/hooks/useHeartPhysics.ts#L145-L164) (L145-L164) |

---

## 3. `/heart` Scene Architecture, Lifecycle & Resilience

### Route Gating (`src/app/heart/page.tsx`)

`HeartPage` in [`src/app/heart/page.tsx`](../src/app/heart/page.tsx#L12-L25) (L12-L25) runs on the server:
1. Enforces an authenticated guest session via `enforceActiveGuestPageSession()`.
2. Loads `AppConfig` via `getAppConfig()` and checks `isFeatureEnabled('interactive3D', config.modules)`, calling Next.js `notFound()` when disabled.
3. Renders `<HeartClient>` with `partner1Name` (`config.partner1Name || config.brideName || ''`) and `partner2Name` (`config.partner2Name || config.groomName || ''`).

### Scene Components & Dual-Clipped Geometry

- **`HeartClient`** ([`src/app/heart/HeartClient.tsx`](../src/app/heart/HeartClient.tsx#L571-L727) (L571-L727)): Manages viewport-responsive `scale` (`0.4` below `768px`, `0.6` at `>= 768px`), modal overlay behavior (`useOverlay`), synchronous WebGL 2 availability via `useSyncExternalStore`, a plain DOM `Loading…` overlay outside `<Canvas>` while `<Suspense fallback={null}>` initializes, `performanceTier`, `resetKey`, and the R3F `<Canvas camera={{ position: [0, 0, 15], fov: 50 }} dpr={[1, 2]} gl={{ localClippingEnabled: true }}>` ([`src/app/heart/HeartClient.tsx`](../src/app/heart/HeartClient.tsx#L658) (L658)).
- **`PhysicsHeart`** ([`src/app/heart/HeartClient.tsx`](../src/app/heart/HeartClient.tsx#L27-L335) (L27-L335)): Coordinates three Rapier `<RigidBody>` instances (`main` with `CuboidCollider` `[1.5 * scale, 1.5 * scale, 0.8 * scale]` and `ActiveCollisionTypes.CONTACT_FORCE_EVENTS`, plus `left` and `right` shard bodies initialized as `type="fixed"` with half-width colliders at `[-0.75 * scale, 0, 0]` and `[0.75 * scale, 0, 0]`), three `useUnified3DInput` instances, `useHeartPhysics`, and `<Html>` accessibility overlays.
- **`Heart3D`** ([`src/app/heart/components/Heart3D.tsx`](../src/app/heart/components/Heart3D.tsx#L30-L112) (L30-L112)): Builds a centered Bezier `THREE.ExtrudeGeometry` using `extrusion` tokens (`depth`, `bevelEnabled`, `bevelSegments`, `bevelThickness`, `bevelSize`). In [`src/app/heart/components/Heart3D.tsx`](../src/app/heart/components/Heart3D.tsx#L52-L84) (L52-L84), it creates two opposing X-axis clipping planes—`planeLeft = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0)` and `planeRight = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0)`—and attaches them to two `THREE.MeshPhysicalMaterial` instances (`gold` using `primaryColor` and `roughness`, `silver` using `secondaryColor` and `roughness + 0.05`, both with `clipShadows: true`). Because WebGL local clipping is required to slice each mesh cleanly at `x = 0`, `<Canvas>` must pass `gl={{ localClippingEnabled: true }}` in [`src/app/heart/HeartClient.tsx`](../src/app/heart/HeartClient.tsx#L658) (L658). When `shardSide` is omitted, both halves and both partner `<Text font={HEART_FONT_URL}>` labels (`[-1, 0.1, 0.71]` and `[1, 0.1, 0.71]`) render using the bundled local `.woff` font; passing `shardSide="left"` or `shardSide="right"` renders only that clipped half and its corresponding partner name.
- **`ScreenBounds`** ([`src/app/heart/components/ScreenBounds.tsx`](../src/app/heart/components/ScreenBounds.tsx#L4-L14) (L4-L14)): Surrounds the R3F `viewport` with four fixed `CuboidCollider` walls (`restitution={0.9}`) so flung hearts and shards bounce inside the visible frame.
- **`Sparkles`** ([`src/app/heart/components/Sparkles.tsx`](../src/app/heart/components/Sparkles.tsx#L9-L30) (L9-L30)): Renders 200 spherical `<Points>` (`radius: 10`) colored by `themeAccent`, rotating `y += 0.001` per frame when `!reduceMotion`.

### Dragging, Breaking & Shard Reconstruction

1. **Pointer Drag & Throw**: `onDragStart` switches `heartRef` to `RigidBodyType.KinematicPositionBased` and sets `pulseSpeed` to `physics.pulseSpeedDragging`. `onDragMove` updates `setNextKinematicTranslation` across the R3F `viewport`. `onDragEnd` restores `RigidBodyType.Dynamic` and, when `!reduceMotion` and `Math.abs(vx) > 0.1 || Math.abs(vy) > 0.1`, applies throw velocity `(vx * physics.dragVelocityMultiplier, -vy * physics.dragVelocityMultiplier, 0)` ([`src/app/heart/HeartClient.tsx`](../src/app/heart/HeartClient.tsx#L129-L157) (L129-L157)).
2. **Breaking & Explosion**: A collision where `payload.totalForceMagnitude > physics.breakForceThreshold` in `handleContactForce` ([`src/app/heart/hooks/useHeartPhysics.ts`](../src/app/heart/hooks/useHeartPhysics.ts#L46-L50) (L46-L50))—or pressing `Space`/`Enter` on the whole-heart button—calls `breakHeart()`. In [`src/app/heart/hooks/useHeartPhysics.ts`](../src/app/heart/hooks/useHeartPhysics.ts#L61-L106) (L61-L106), `mainRb.setEnabled(false)` disables the whole heart, `leftRb` and `rightRb` enable as `RigidBodyType.Dynamic` inheriting `mainRb` translation, rotation, linear velocity, and angular velocity, and (when `!reduceMotion`) receive `physics.explosionImpulseLeft`, `physics.explosionImpulseRight`, and randomized torque impulses scaled by `physics.explosionTorqueStrength`.
3. **Automatic & Keyboard Reconstruction**:
   - **Auto-Timer**: `PhysicsHeart` configures `reconstructTimeout: 3000` in [`src/app/heart/HeartClient.tsx`](../src/app/heart/HeartClient.tsx#L93) (L93), automatically invoking `reconstruct()` 3 seconds after `isBroken` becomes `true`.
   - **Manual Shard Action**: Both shard `useUnified3DInput` hooks in [`src/app/heart/HeartClient.tsx`](../src/app/heart/HeartClient.tsx#L165-L185) (L165-L185) bind `Space` and `Enter` (`onAction`) to `reconstructHeart()` for immediate keyboard or click recovery.
   - **Rigid-Body Reset**: When `isBroken` returns to `false`, [`src/app/heart/hooks/useHeartPhysics.ts`](../src/app/heart/hooks/useHeartPhysics.ts#L107-L129) (L107-L129) zeroes linear and angular velocities on `leftRb` and `rightRb`, resets their translations to `{ x: 0, y: 0, z: 0 }` and rotations to `{ x: 0, y: 0, z: 0, w: 1 }`, switches both back to `RigidBodyType.Fixed`, calls `setEnabled(false)`, and re-enables `mainRb` as `RigidBodyType.Dynamic` at the origin with zero velocity.

### Frame Forces, Pulsing & Secret Spot (`useHeartPhysics`)

On every animation frame in [`src/app/heart/hooks/useHeartPhysics.ts`](../src/app/heart/hooks/useHeartPhysics.ts#L132-L204) (L132-L204):
- **Secret Spot (`"I love you!"`)**: While `!isBroken`, if `mainRb` enters the top-right corner (`position.x > viewportWidth / 2 - 2 && position.y > viewportHeight / 2 - 2`), `setShowEasterEgg(true)` reveals the 3D `<Text font={HEART_FONT_URL}>` `"I love you!"` mesh at `[0, 0, 5]`, appends `"Secret message revealed: I love you!"` to the whole-heart `aria-label`, and updates the polite `sr-only` live region in [`src/app/heart/HeartClient.tsx`](../src/app/heart/HeartClient.tsx#L69-L71) (L69-L71) and [`src/app/heart/HeartClient.tsx`](../src/app/heart/HeartClient.tsx#L242-L332) (L242-L332).
- **Idle Y-Axis Rotation**: Before first interaction (`!interacted`) and when `!reduceMotion`, `tempEuler.y` increments by `physics.idleRotationSpeed` each frame.
- **Central Return Force**: Once `interacted` is `true`, whenever radial XY distance from the origin exceeds `0.1`, `useHeartPhysics` applies a normalized inward force scaled by `physics.returnForceMultiplier` (or snaps `mainRb` directly to `{ x: 0, y: 0, z: position.z }` with zero linear velocity when `reduceMotion` is active; within `0.1` units of origin it zeroes linear velocity).
- **Sinusoidal Pulsing**: Scales `groupRef` uniformly to `1 + Math.sin(t * pulseSpeed) * physics.pulseScaleMultiplier`, locking scale to `(1, 1, 1)` when `reduceMotion` is `true`.

### `<Html>` Focus Handoff

`PhysicsHeart` renders visually transparent, focus-ring-enabled `<button>` controls inside `@react-three/drei` `<Html>` portals for the whole heart and each broken shard ([`src/app/heart/HeartClient.tsx`](../src/app/heart/HeartClient.tsx#L202-L319) (L202-L319)):
- `focusedButtonRef` tracks `'none' | 'whole' | 'left' | 'right'` with a 50ms blur timeout ([`src/app/heart/HeartClient.tsx`](../src/app/heart/HeartClient.tsx#L77-L89) (L77-L89)) so unmounting a button during state transitions does not erase focus intent before the `isBroken` effect runs.
- When `isBroken` transitions to `true` while `'whole'` was focused, a `requestAnimationFrame` loop transfers DOM focus to `leftButtonRef` (falling back to `[aria-label="Broken heart left segment."]`).
- When `isBroken` transitions back to `false` while `'left'` or `'right'` was focused, `requestAnimationFrame` transfers DOM focus back to `wholeButtonRef` (falling back to `[aria-label^="Interactive 3D Heart"]`).

### 3-Tier FPS Degradation & `Reset` Recovery

- **`PerformanceTracker`** ([`src/app/heart/HeartClient.tsx`](../src/app/heart/HeartClient.tsx#L516-L550) (L516-L550)): Computes instantaneous `fps = 1 / delta` (honoring `window.__mockFps` in tests). Whenever `fps < 30`, `lowFpsAccumulatorRef` accumulates `delta`; once sustained below 30 FPS for `>= 3.0` seconds, it steps `performanceTier` down one level (`'high'` -> `'medium'`, or `'medium'` -> `'low'`) and resets the accumulator. Any frame with `fps >= 30` resets the accumulator to `0`, and tracking stops once `'low'` is reached.
- **Tier Feature Gating** ([`src/app/heart/HeartClient.tsx`](../src/app/heart/HeartClient.tsx#L661-L722) (L661-L722)):
  - `'high'`: Full `<Physics>`, `<Sparkles />`, procedural `<Environment frames={1} resolution={256}>` with warm `<Lightformer>` panels, and `<EffectComposer>` `<Bloom>` post-processing.
  - `'medium'`: Drops `<EffectComposer>` / `<Bloom>` while keeping `<Sparkles />` and procedural `<Environment>` `<Lightformer>` reflections.
  - `'low'`: Drops `<Sparkles />`, `<Environment>`, and `<Bloom>`, retaining core lighting and `<Physics>` simulation.
- **`Reset` Button Recovery** ([`src/app/heart/HeartClient.tsx`](../src/app/heart/HeartClient.tsx#L591-L595) (L591-L595)): Clicking `Reset` (`handleReset`) sets `interacted` to `false`, restores `performanceTier` to `'high'`, and increments `resetKey` to remount `<Physics key={resetKey}>` (or `<WebGLFallback key={resetKey}>`).

### `WebGLFallback` (2D Interactive SVG)

Before mounting `<Canvas>`, `HeartClient` reads `isWebGLAvailable()` synchronously via `useSyncExternalStore` ([`src/app/heart/HeartClient.tsx`](../src/app/heart/HeartClient.tsx#L348-L379) (L348-L379) and [`src/app/heart/HeartClient.tsx`](../src/app/heart/HeartClient.tsx#L579-L583) (L579-L583), probing `WebGL2RenderingContext` and `webgl2` canvas contexts while respecting `window.__mockWebGLSupport` in tests). When WebGL 2 is unavailable, `<Canvas>` never mounts and `HeartClient` renders `WebGLFallback` ([`src/app/heart/HeartClient.tsx`](../src/app/heart/HeartClient.tsx#L381-L514) (L381-L514)):
- Renders a 200x200 pulsing (`motion-reduce:animate-none`) SVG heart styled with `primaryColor`, `secondaryColor`, partner name labels, and `glowFilter || drop-shadow(0 0 10px ${accentColor})`.
- Supports pointer dragging via `setPointerCapture` / `releasePointerCapture` and `translate(${position.x}px, ${position.y}px)` transforms.
- Supports keyboard movement in **20px steps** (`ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`) on the focusable `role="button"` container (`data-testid="webgl-fallback-heart"`), announcing `"Moved up"`, `"Moved down"`, `"Moved left"`, and `"Moved right"` through a polite `sr-only` live region.

---

## 4. Shared DOM Tilt (`Interactive3DCard`) & Input Hooks

### Polymorphic `Interactive3DCard` & Consumers

[`src/components/ui/Interactive3DCard.tsx`](../src/components/ui/Interactive3DCard.tsx#L42-L220) (L42-L220) provides reusable Framer Motion 3D perspective tilt for DOM cards:
- **Polymorphic Wrapper Cache**: `MotionComponentWrapper` ([`src/components/ui/Interactive3DCard.tsx`](../src/components/ui/Interactive3DCard.tsx#L10-L29) (L10-L29)) caches `motion.create(Component)` instances in `motionComponentCache` by `ElementType` (`as`, defaulting to `'div'`) and forwards DOM refs via `setRef`, preventing unmount/remount cycles across re-renders. In non-production builds, rendering `as="button"` or `as="a"` with nested focusable descendants logs a console accessibility warning ([`src/components/ui/Interactive3DCard.tsx`](../src/components/ui/Interactive3DCard.tsx#L146-L153) (L146-L153)).
- **Runtime Callers**:
  - **Home Travel Cards**: [`src/components/home/HomePageClient.tsx`](../src/components/home/HomePageClient.tsx#L429-L434) (L429-L434) renders travel logistics entries inside `<Interactive3DCard as="article">` with `[transform:translateZ(10px)]` inner headings and descriptions.
  - **Guest Registry Cards**: [`src/features/registry/components/RegistryCard.tsx`](../src/features/registry/components/RegistryCard.tsx#L256-L270) (L256-L270) wraps non-admin registry items in `<Interactive3DCard as="article">` (passing `tabIndex={isClickable ? -1 : undefined}` so nested action buttons own keyboard tab stops without duplicating a outer `role="button"` wrapper).

### Spring Resolution, Focus Tilt, Semantics & `reduceMotion`

- **Spring & Tilt Token Precedence** ([`src/components/ui/Interactive3DCard.tsx`](../src/components/ui/Interactive3DCard.tsx#L67-L98) (L67-L98)): Reads `getPresetTokens(themePreset)` so `--motion-spring-stiffness`, `--motion-spring-damping`, and `--motion-tilt-max-deg` take precedence, falling back to `ThemeProvider` `cardSpringStiffness` (`300`), `cardSpringDamping` (`20`), and `cardMaxRotation` (`10`), while `cardPerspective` (`1000`) drives `transformPerspective`. `useTransform` maps normalized `[-0.5, 0.5]` `mouseYSpring` to `[tiltMaxDeg, -tiltMaxDeg]` (`rotateX`) and `mouseXSpring` to `[-tiltMaxDeg, tiltMaxDeg]` (`rotateY`).
- **Focus Tilt**: Focusing the card root directly (`!reduceMotion && e.target === e.currentTarget`) sets `x.set(0.15)` and `y.set(-0.15)`; blurring resets both springs to `0` ([`src/components/ui/Interactive3DCard.tsx`](../src/components/ui/Interactive3DCard.tsx#L126-L144) (L126-L144)).
- **Conditional Button Semantics & `reduceMotion` Fallback** ([`src/components/ui/Interactive3DCard.tsx`](../src/components/ui/Interactive3DCard.tsx#L162-L211) (L162-L211)):
  - `shouldApplyButtonSemantics` is `true` only when `Boolean(onClick) && propTabIndex !== -1 && !isInteractive` (neither `'button'` nor `'a'`). Only then does the card default `role="button"` and `tabIndex={0}`, and `handleCardKeyDown` triggers `onClick` on `Enter` or `Space` strictly when `e.target === e.currentTarget` (ignoring bubbled key events from nested controls).
  - When `reduceMotion` is `true`, `Interactive3DCard` omits `transformPerspective`, `rotateX`, `rotateY`, `transformStyle: 'preserve-3d'`, and `willChange: 'transform'` from inline `style`.

### `useUnified3DInput` (`src/hooks/useUnified3DInput.ts`)

[`src/hooks/useUnified3DInput.ts`](../src/hooks/useUnified3DInput.ts#L5-L244) (L5-L244) unifies pointer, touch, lifecycle, and keyboard hooks across R3F meshes and DOM elements:
- **Coordinate Normalization** (`getNormalizedCoords`, L66-L87):
  - **`domRef` Mode**: Caches `domRef.current.getBoundingClientRect()` on pointer down (`cachedRectRef`) and clamps `(clientX - left) / width - 0.5` and `(clientY - top) / height - 0.5` to `[-0.5, 0.5]`.
  - **`r3f` Mode**: Normalizes canvas coordinates via `(clientX / r3f.size.width) - 0.5` and `(clientY / r3f.size.height) - 0.5`.
- **Velocity Tracking & 50ms Stale Cutoff** (L89-L174): Computes `vx = dx / dt` and `vy = dy / dt` in `px/ms` using `performance.now()`. On pointer release, if `performance.now() - dragState.current.lastTime > 50`, `vx` and `vy` reset to `0` so stationary holds before release do not fling objects. Pointer down and move handlers short-circuit when `isDestroyed || reduceMotion`.
- **Lifecycle Timers** (L183-L207): Manages `isDestroyed`, `destroy()`, and `reconstruct()`, scheduling a `setTimeout` for `options.reconstructTimeout` ms whenever `isDestroyed` becomes `true` and cleaning up on unmount or early reconstruction.
- **Handler Split** (L209-L244): Returns `handlers` (pointer/touch only, used on R3F `<group>`), `getInteractiveProps` (keyboard + `aria-describedby`, used on `<Html>` `<button>`), and `mixedHandlers` (combined pointer + accessibility props, used on DOM elements like `Interactive3DCard`), setting `AccessibleElements` to `null` when `options.accessibility` is omitted.

### `use3DInteraction` (`src/hooks/use3DInteraction.tsx`)

[`src/hooks/use3DInteraction.tsx`](../src/hooks/use3DInteraction.tsx#L19-L130) (L19-L130) provides screen-reader and keyboard parity for 3D controls:
- Generates React `useId()`-scoped element IDs `3d-instructions-${id}` and `3d-live-${id}`.
- Renders `AccessibleElements`: a hidden `sr-only` instructions node (`{instructions}`) and a polite atomic live region (`aria-live="polite" aria-atomic="true"`) announcing directional or action `labels` (`up`, `down`, `left`, `right`, `action`) when `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Space`, `Enter`, or `onClick` handlers fire.
- Merges caller-supplied `aria-describedby` tokens with `instructionsId` (`${existingDescribedBy} ${instructionsId}`) in `getInteractiveProps` ([`src/hooks/use3DInteraction.tsx`](../src/hooks/use3DInteraction.tsx#L89-L96) (L89-L96)) so external descriptions are preserved.

---

## 5. Extending 3D Features Safely

- **Adding Preset 3D Tokens**: Declare new custom properties on `ComponentTokens` and all five presets in [`src/lib/theme/presets.ts`](../src/lib/theme/presets.ts#L140-L179) (L140-L179), then parse them inside `ThemeProvider` `useMemo` hooks in [`src/components/ThemeProvider.tsx`](../src/components/ThemeProvider.tsx#L496-L569) (L496-L569). Keep `ThemeProvider` context values read-only rather than adding imperative physics setters.
- **Adding `/heart` Visuals or Forces**: Gate expensive shaders, particles, or post-processing effects by `performanceTier` in [`src/app/heart/HeartClient.tsx`](../src/app/heart/HeartClient.tsx#L661-L722) (L661-L722), respect `reduceMotion` in every `useFrame` callback, and ensure `WebGLFallback` remains operable via pointer drag and keyboard arrows.
- **Documentation & Portal Sync**: Keep JSX identifiers wrapped in inline code backticks (for example, `` `<Canvas>` `` and `` `<Html>` ``) and place prose `(L<start>-L<end>)` citations immediately after their matching file path on the same line so [`scripts/check-doc-links.ts`](../scripts/check-doc-links.ts#L2489-L2705) (L2489-L2705) and [`scripts/generate-portal.ts`](../scripts/generate-portal.ts#L48-L188) (L48-L188) pass cleanly.
