import fs from 'fs';
import os from 'os';
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
  rewriteMarkdownLinks,
} from '../../scripts/generate-portal';
import { verifySpecContracts } from '../../scripts/verify-spec-contracts';

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
    const mapping = ARCHITECTURAL_DOCS.find((doc) => doc.src === guideRelPath);
    expect(mapping).toEqual({
      src: 'docs/3D_TECHNICAL_GUIDE.md',
      dest: 'features/3d-technical-guide.md',
      category: 'Features',
      title: '3D Technical Guide',
    });
  });

  it('documents read-only ThemeProvider token derivation and distinguishes active vs. unused PHYSICS_CONSTANTS keys', () => {
    const allConstantKeys = Object.keys(PHYSICS_CONSTANTS);
    expect(allConstantKeys.length).toBeGreaterThan(UNUSED_PHYSICS_CONSTANT_KEYS.length);

    const activeKeys = allConstantKeys.filter(
      (key) =>
        !UNUSED_PHYSICS_CONSTANT_KEYS.includes(
          key as (typeof UNUSED_PHYSICS_CONSTANT_KEYS)[number],
        ),
    );
    expect(activeKeys).toHaveLength(
      allConstantKeys.length - UNUSED_PHYSICS_CONSTANT_KEYS.length,
    );

    for (const key of allConstantKeys) {
      expect(guideContent).toContain(`\`${key}\``);
    }

    for (const unusedKey of UNUSED_PHYSICS_CONSTANT_KEYS) {
      expect(guideContent).toMatch(new RegExp(`\`${unusedKey}\`[^\\n]*\\*\\*Unused\\*\\*`));
    }
    for (const activeKey of activeKeys) {
      expect(guideContent).toMatch(new RegExp(`\`${activeKey}\`[^\\n]*\\*\\*Active\\*\\*`));
    }

    expect(guideContent).toContain('createContext');
    expect(guideContent).toContain('zero physics');
    expect(guideContent).toContain('useMemo');
    expect(guideContent).toContain('AppConfig.themeTokens');
    expect(guideContent).toContain('DRAFT_UPDATE');
    expect(guideContent).not.toContain(
      'updated or customized dynamically at runtime via the theme provider context',
    );
  });

  it('documents all --3d-* CSS custom properties, --glow-filter, --card-* tokens, and --motion-* spring/tilt tokens from presets.ts', () => {
    const classicKeys = Object.keys(THEME_PRESETS.classic);
    const threeDTokens = classicKeys.filter((key) => key.startsWith('--3d-'));
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

    expect(threeDTokens.length).toBeGreaterThan(0);

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
    expect(guideContent).toContain('interactive3D');
    expect(guideContent).toContain('enforceActiveGuestPageSession');

    expect(guideContent).toContain('ExtrudeGeometry');
    expect(guideContent).toContain('planeLeft');
    expect(guideContent).toContain('planeRight');
    expect(guideContent).toContain('localClippingEnabled: true');

    expect(guideContent).toContain('reconstructTimeout: 3000');
    expect(guideContent).toContain('Space');
    expect(guideContent).toContain('Enter');
    expect(guideContent).toContain('RigidBodyType.Fixed');

    expect(guideContent).toContain('idleRotationSpeed');
    expect(guideContent).toContain('returnForceMultiplier');
    expect(guideContent).toContain('pulseScaleMultiplier');
    expect(guideContent).toContain('I love you!');

    expect(guideContent).toContain('PerformanceTracker');
    expect(guideContent).toContain('fps < 30');
    expect(guideContent).toContain('handleReset');
    expect(guideContent).toContain('EffectComposer');
    expect(guideContent).toContain('Bloom');

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

    expect(guideContent).toContain('useUnified3DInput');
    expect(guideContent).toContain('domRef');
    expect(guideContent).toContain('r3f');
    expect(guideContent).toContain('> 50');
    expect(guideContent).toContain('use3DInteraction');
    expect(guideContent).toContain('sr-only');
    expect(guideContent).toContain('aria-describedby');
    expect(guideContent).toContain('aria-live="polite"');
  });

  it('passes checkLinksInFile and verifySpecContracts without hardcoded line ranges and survives comment insertions above HeartClient', () => {
    const errors: LinkError[] = [];
    checkLinksInFile(guideAbsPath, errors, rootDir);
    expect(errors).toEqual([]);
    expect(guideContent).not.toMatch(/#L\d+/);
    expect(guideContent).not.toMatch(/\(L\d+[-–—]L\d+\)/);

    const contractResult = verifySpecContracts(rootDir, { specFiles: [guideRelPath] });
    expect(contractResult.errors).toEqual([]);
    expect(contractResult.checkedSymbols).toBeGreaterThanOrEqual(25);

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'three-d-guide-shift-'));
    try {
      for (const relPath of [
        guideRelPath,
        'FEATURE_MODULES.md',
        'scripts/check-doc-links.ts',
        'scripts/generate-portal.ts',
        'scripts/verify-spec-contracts.ts',
        'src/env.ts',
        'src/middleware.ts',
        'src/lib/theme/presets.ts',
        'src/components/ThemeProvider.tsx',
        'src/app/heart/page.tsx',
        'src/app/heart/HeartClient.tsx',
        'src/app/heart/constants.ts',
        'src/app/heart/components/Heart3D.tsx',
        'src/app/heart/components/ScreenBounds.tsx',
        'src/app/heart/components/Sparkles.tsx',
        'src/app/heart/hooks/useHeartPhysics.ts',
        'src/components/ui/Interactive3DCard.tsx',
        'src/components/home/HomePageClient.tsx',
        'src/features/registry/components/RegistryCard.tsx',
        'src/hooks/useUnified3DInput.ts',
        'src/hooks/use3DInteraction.tsx',
        'src/hooks/useReducedMotion.ts',
      ]) {
        const srcPath = path.join(rootDir, relPath);
        const destPath = path.join(tmpRoot, relPath);
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(srcPath, destPath);
      }

      const heartClientPath = path.join(tmpRoot, 'src/app/heart/HeartClient.tsx');
      const originalHeartClient = fs.readFileSync(heartClientPath, 'utf8');
      const shiftedHeartClient = originalHeartClient.replace(
        'export default function HeartClient(',
        [
          '// Synthetic comment line 1 inserted above HeartClient',
          '// Synthetic comment line 2 inserted above HeartClient',
          'export default function HeartClient(',
        ].join('\n'),
      );
      expect(shiftedHeartClient).not.toBe(originalHeartClient);
      fs.writeFileSync(heartClientPath, shiftedHeartClient, 'utf8');

      const shiftedLinkErrors: LinkError[] = [];
      checkLinksInFile(path.join(tmpRoot, guideRelPath), shiftedLinkErrors, tmpRoot);
      expect(shiftedLinkErrors).toEqual([]);

      const shiftedContractResult = verifySpecContracts(tmpRoot, { specFiles: [guideRelPath] });
      expect(shiftedContractResult.errors).toEqual([]);
      expect(shiftedContractResult.checkedSymbols).toBe(contractResult.checkedSymbols);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('rewrites portal links cleanly and escapes Vue syntax without leaving raw JSX tags outside inline code spans', () => {
    const rewritten = rewriteMarkdownLinks(guideContent, guideRelPath, rootDir);
    const staged = escapeVueMustache(rewritten);

    expect(staged).toContain(
      '(https://github.com/fderuiter/wedding_website/blob/main/src/app/heart/HeartClient.tsx)',
    );
    expect(staged).toContain(
      '(https://github.com/fderuiter/wedding_website/blob/main/src/components/ThemeProvider.tsx)',
    );
    expect(staged).toContain(
      '(https://github.com/fderuiter/wedding_website/blob/main/src/components/ui/Interactive3DCard.tsx)',
    );
    expect(staged).toContain('(/features/feature-modules)');

    let inFence = false;
    staged.split(/\r?\n/).forEach((line) => {
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

    const stagedPortalFile = path.join(rootDir, 'docs-portal/features/3d-technical-guide.md');
    if (fs.existsSync(stagedPortalFile)) {
      expect(fs.readFileSync(stagedPortalFile, 'utf8')).toBe(
        prependGeneratedPortalComment(staged, guideRelPath),
      );
    }
  });
});
