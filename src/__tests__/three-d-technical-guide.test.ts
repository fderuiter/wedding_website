import fs from 'fs';
import path from 'path';
import { PHYSICS_CONSTANTS } from '@/app/heart/constants';
import { THEME_PRESETS } from '@/lib/theme/presets';
import {
  checkLinksInFile,
  scanLinksAndCodeInLine,
  type LinkError,
} from '../../scripts/check-doc-links';
import {
  ARCHITECTURAL_DOCS,
  escapeVueMustache,
  prependGeneratedPortalComment,
  prependPortalFrontmatterTitle,
  rewriteMarkdownLinks,
} from '../../scripts/generate-portal';

const UNUSED_PHYSICS_CONSTANT_KEYS = [
  'BUMP_IMPULSE_Y',
  'BUMP_IMPULSE_RANDOM_MULTIPLIER',
] as const;

describe('docs/3D_TECHNICAL_GUIDE.md specification & portal verification', () => {
  const rootDir = process.cwd();
  const guideRelPath = 'docs/3D_TECHNICAL_GUIDE.md';
  const guideAbsPath = path.join(rootDir, guideRelPath);
  let guideContent = '';

  beforeAll(() => {
    guideContent = fs.readFileSync(guideAbsPath, 'utf8');
  });

  it('registers docs/3D_TECHNICAL_GUIDE.md -> features/3d-technical-guide.md in ARCHITECTURAL_DOCS', () => {
    const mapping = ARCHITECTURAL_DOCS.find(doc => doc.src === guideRelPath);
    expect(mapping).toEqual({
      src: 'docs/3D_TECHNICAL_GUIDE.md',
      dest: 'features/3d-technical-guide.md',
      category: 'Features',
      title: '3D Technical Guide',
    });
  });

  it('documents read-only ThemeProvider token derivation and distinguishes 11 active vs. 2 unused PHYSICS_CONSTANTS keys', () => {
    const allConstantKeys = Object.keys(PHYSICS_CONSTANTS);
    expect(allConstantKeys).toHaveLength(13);

    const activeKeys = allConstantKeys.filter(
      key => !UNUSED_PHYSICS_CONSTANT_KEYS.includes(key as (typeof UNUSED_PHYSICS_CONSTANT_KEYS)[number])
    );
    expect(activeKeys).toHaveLength(11);

    for (const key of allConstantKeys) {
      expect(guideContent).toContain(`\`${key}\``);
    }

    for (const unusedKey of UNUSED_PHYSICS_CONSTANT_KEYS) {
      expect(guideContent).toMatch(new RegExp(`\`${unusedKey}\`[^\\n]*\\*\\*Unused\\*\\*`));
    }
    for (const activeKey of activeKeys) {
      expect(guideContent).toMatch(new RegExp(`\`${activeKey}\`[^\\n]*\\*\\*Active\\*\\*`));
    }

    // Verify ThemeProvider static defaults, zero physics setters, useMemo derivation, and DRAFT_UPDATE
    expect(guideContent).toContain('createContext');
    expect(guideContent).toContain('zero physics');
    expect(guideContent).toContain('useMemo');
    expect(guideContent).toContain('AppConfig.themeTokens');
    expect(guideContent).toContain('DRAFT_UPDATE');
    expect(guideContent).not.toContain(
      'updated or customized dynamically at runtime via the theme provider context'
    );
  });

  it('documents all 27 --3d-* CSS custom properties, --glow-filter, 4 --card-* tokens, and 3 --motion-* spring/tilt tokens from presets.ts', () => {
    const classicKeys = Object.keys(THEME_PRESETS.classic);
    const threeDTokens = classicKeys.filter(key => key.startsWith('--3d-'));
    const card3DTokens = [
      '--card-perspective',
      '--card-max-rotation',
      '--card-spring-stiffness',
      '--card-spring-damping',
    ];
    const motionSpringTiltTokens = [
      '--motion-spring-stiffness',
      '--motion-spring-damping',
      '--motion-tilt-max-deg',
    ];

    expect(threeDTokens).toHaveLength(27);

    for (const token of [
      ...threeDTokens,
      '--glow-filter',
      ...card3DTokens,
      ...motionSpringTiltTokens,
    ]) {
      expect(guideContent).toContain(`\`${token}\``);
    }
  });

  it('documents /heart route gating, dual-clipped Heart3D geometry, shard reconstruction, forces, FPS tiers, WebGLFallback, and <Html> focus handoff', () => {
    // Updated PhysicsHeart bounds and no stale L26–L322 citation
    expect(guideContent).toContain('L26-L328');
    expect(guideContent).not.toMatch(/L26[-–—]L322/);

    // Route gating in src/app/heart/page.tsx
    expect(guideContent).toContain('interactive3D');
    expect(guideContent).toContain('enforceActiveGuestPageSession');

    // Dual-clipped ExtrudeGeometry meshes & localClippingEnabled
    expect(guideContent).toContain('ExtrudeGeometry');
    expect(guideContent).toContain('planeLeft');
    expect(guideContent).toContain('planeRight');
    expect(guideContent).toContain('localClippingEnabled: true');

    // 3-second reconstructTimeout, Space/Enter shard recovery, and Fixed body reset
    expect(guideContent).toContain('reconstructTimeout: 3000');
    expect(guideContent).toContain('Space');
    expect(guideContent).toContain('Enter');
    expect(guideContent).toContain('RigidBodyType.Fixed');

    // Idle rotation, return force, pulsing, and "I love you!" secret spot
    expect(guideContent).toContain('idleRotationSpeed');
    expect(guideContent).toContain('returnForceMultiplier');
    expect(guideContent).toContain('pulseScaleMultiplier');
    expect(guideContent).toContain('I love you!');

    // 3-tier PerformanceTracker (< 30 FPS for 3s), tier gating, and Reset recovery
    expect(guideContent).toContain('PerformanceTracker');
    expect(guideContent).toContain('fps < 30');
    expect(guideContent).toContain('handleReset');
    expect(guideContent).toContain('EffectComposer');
    expect(guideContent).toContain('Bloom');

    // WebGLFallback 2D SVG drag + 20px arrow steps and <Html> focus handoff
    expect(guideContent).toContain('WebGLFallback');
    expect(guideContent).toContain('20px');
    expect(guideContent).toContain('`<Html>`');
    expect(guideContent).toContain('requestAnimationFrame');
  });

  it('documents polymorphic Interactive3DCard, its callers, spring resolution, reduceMotion fallback, useUnified3DInput, and use3DInteraction', () => {
    expect(guideContent).toContain('Interactive3DCard');
    expect(guideContent).toContain('src/components/home/HomePageClient.tsx');
    expect(guideContent).toContain('src/features/registry/components/RegistryCard.tsx');
    expect(guideContent).toContain('shouldApplyButtonSemantics');
    expect(guideContent).toContain('reduceMotion');

    // Shared input & accessibility hooks
    expect(guideContent).toContain('useUnified3DInput');
    expect(guideContent).toContain('domRef');
    expect(guideContent).toContain('r3f');
    expect(guideContent).toContain('> 50');
    expect(guideContent).toContain('use3DInteraction');
    expect(guideContent).toContain('sr-only');
    expect(guideContent).toContain('aria-describedby');
    expect(guideContent).toContain('aria-live="polite"');
  });

  it('passes checkLinksInFile with zero broken links, invalid #L fragments, or out-of-range (L<start>-L<end>) prose citations', () => {
    const errors: LinkError[] = [];
    checkLinksInFile(guideAbsPath, errors, rootDir);
    expect(errors).toEqual([]);
  });

  it('rewrites portal links cleanly and escapes Vue syntax without leaving raw JSX tags outside inline code spans', () => {
    const rewritten = rewriteMarkdownLinks(guideContent, guideRelPath, rootDir);
    const staged = escapeVueMustache(rewritten);

    // Relative source links rewrite to GitHub blob URLs and staged doc links rewrite to VitePress routes
    expect(staged).toContain(
      'https://github.com/fderuiter/wedding_website/blob/main/src/app/heart/HeartClient.tsx#L26-L328'
    );
    expect(staged).toContain(
      'https://github.com/fderuiter/wedding_website/blob/main/src/components/ThemeProvider.tsx#L438-L511'
    );
    expect(staged).toContain(
      'https://github.com/fderuiter/wedding_website/blob/main/src/components/ui/Interactive3DCard.tsx#L42-L220'
    );
    expect(staged).toContain('(/features/feature-modules)');

    // Ensure no raw JSX/HTML tags (such as <Html> or <Canvas>) appear outside code spans or fences
    let inFence = false;
    staged.split(/\r?\n/).forEach(line => {
      if (/^\s{0,3}(`{3,}|~{3,})/.test(line)) {
        inFence = !inFence;
        return;
      }
      if (inFence) {
        return;
      }
      const { codeSpans } = scanLinksAndCodeInLine(line, 1);
      const chars = line.split('');
      for (const span of codeSpans) {
        for (let i = span.startIndex; i < span.endIndex && i < chars.length; i++) {
          chars[i] = ' ';
        }
      }
      const prose = chars.join('');
      expect(prose).not.toMatch(/<[A-Za-z][^>]*>/);
      expect(prose).not.toMatch(/\{\{|\}\}/);
    });

    // If docs-portal has been staged (e.g. via pretest.mjs or generate-portal.ts), verify exact synchronization
    const stagedPortalFile = path.join(rootDir, 'docs-portal/features/3d-technical-guide.md');
    const mapping = ARCHITECTURAL_DOCS.find(doc => doc.src === guideRelPath)!;
    if (fs.existsSync(stagedPortalFile)) {
      expect(fs.readFileSync(stagedPortalFile, 'utf8')).toBe(
        prependGeneratedPortalComment(
          prependPortalFrontmatterTitle(staged, mapping.title),
          guideRelPath
        )
      );
    }
  });
});
