import fs from 'fs';
import path from 'path';
import { compile } from 'tailwindcss';
import {
  generateDynamicStyles,
  generateThemeStylesheet,
  optimizeContrast,
  hexToRgb,
  getContrastRatio,
  clearContrastCache,
} from '../stylesheet';
import { render } from '@testing-library/react';
import { ThemeProvider } from '@/components/ThemeProvider';

describe('Isomorphic Theme Stylesheet Generation', () => {
  beforeEach(() => {
    clearContrastCache();
  });

  const sampleConfig = {
    colorPrimary: '#B91C1C',
    colorSecondary: '#B45309',
    themePreset: 'classic',
    themeTokens: {
      '--btn-radius': '0.75rem',
    },
    layoutContainerMaxWidth: '72rem',
    layoutGridGap: '2rem',
    layoutCardPadding: '2.5rem',
    layoutBorderRadius: '1.25rem',
    fontHeading: 'Cinzel, serif',
    fontBody: 'Lora, serif',
    fontMono: 'Courier, monospace',
    typographyScale: {
      fontSizeDisplay: '3.5rem',
      fontSizeH1: '2.75rem',
    },
    spacingScale: {
      spacingHeader: '64px',
    },
    borderTreatment: {
      borderAccent: '2px solid #B91C1C',
    },
    brandDimensions: {
      brandLogoWidth: '150px',
      brandLogoHeight: '50px',
    },
  };

  it('generates complete token sets for :root, light mode, dark mode, and contextual container classes', () => {
    const css = generateThemeStylesheet(sampleConfig);

    // Root rules
    expect(css).toContain(':root {');
    expect(css).toContain('--color-primary: #B91C1C;');
    expect(css).toContain('--color-secondary: #B45309;');
    expect(css).toContain('--container-max-w: 72rem;');
    expect(css).toContain('--grid-gap: 2rem;');
    expect(css).toContain('--card-padding: 2.5rem;');
    expect(css).toContain('--radius-card: 1.25rem;');
    expect(css).toContain('--font-heading: Cinzel, serif;');
    expect(css).toContain('--font-body: Lora, serif;');
    expect(css).toContain('--font-mono: Courier, monospace;');
    expect(css).toContain('--btn-radius: 0.75rem;');
    expect(css).toContain('--font-size-display: 3.5rem;');
    expect(css).toContain('--font-size-h1: 2.75rem;');
    expect(css).toContain('--spacing-header: 64px;');
    expect(css).toContain('--border-accent: 2px solid #B91C1C;');
    expect(css).toContain('--brand-logo-width: 150px;');
    expect(css).toContain('--brand-logo-height: 50px;');

    // Light mode document context rules
    expect(css).toContain('html:not(.dark),');
    expect(css).toContain('html.light,');
    expect(css).toContain('[data-surface="light"]');

    // Light contextual container surfaces
    expect(css).toContain('.bg-white,');
    expect(css).toContain('.bg-gray-50,');
    expect(css).toContain('.bg-slate-100,');
    expect(css).toContain('.bg-zinc-200,');
    expect(css).toContain('.bg-stone-300,');
    expect(css).toContain('.bg-neutral-400');

    // Dark mode document context and container overrides
    expect(css).toContain('.dark {');
    expect(css).toContain('.dark .dark\\:bg-black,');
    expect(css).toContain('.dark .dark\\:bg-gray-900,');
    expect(css).toContain('.dark .dark\\:bg-slate-800,');
    expect(css).toContain('.bg-black,');
    expect(css).toContain('[data-surface="dark"]');
  });

  it('guarantees identical CSS token output between server rendering and client ThemeProvider', () => {
    // 1. Server generation (as called in src/app/layout.tsx)
    const serverCss = generateThemeStylesheet(sampleConfig);

    // 2. Client ThemeProvider hydration output
    let clientCss = '';
    const TestComp = () => {
      return <div data-testid="test-content">Hydrated Content</div>;
    };

    render(
      <ThemeProvider config={sampleConfig}>
        <TestComp />
      </ThemeProvider>
    );

    const styleEl = document.getElementById('dynamic-theme-style');
    clientCss = styleEl?.textContent || '';

    // Verify server and client outputs are completely identical
    expect(serverCss.trim()).toBe(clientCss.trim());
  });

  it('meets WCAG 2.2 AA contrast standards for all calibrated tokens (>= 4.5:1 text, >= 3.0:1 borders)', () => {
    const primary = '#B91C1C';
    const secondary = '#B45309';

    // Light background (#FFFFFF) contrast checks
    const primaryTextLight = optimizeContrast(primary, '#FFFFFF', 4.5);
    const secondaryTextLight = optimizeContrast(secondary, '#FFFFFF', 4.5);
    const errorTextLight = optimizeContrast('#DC2626', '#FFFFFF', 4.5);
    const mutedTextLight = optimizeContrast('#4B5563', '#FFFFFF', 4.5);
    const warningTextLight = optimizeContrast('#78350F', '#FFFFFF', 4.5);
    const focusRingLight = optimizeContrast(primary, '#FFFFFF', 3.0);
    const surfaceBorderLight = optimizeContrast('#6B7280', '#FFFFFF', 3.0);

    const whiteRgb = hexToRgb('#FFFFFF');
    expect(getContrastRatio(hexToRgb(primaryTextLight), whiteRgb)).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(hexToRgb(secondaryTextLight), whiteRgb)).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(hexToRgb(errorTextLight), whiteRgb)).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(hexToRgb(mutedTextLight), whiteRgb)).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(hexToRgb(warningTextLight), whiteRgb)).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(hexToRgb(focusRingLight), whiteRgb)).toBeGreaterThanOrEqual(3.0);
    expect(getContrastRatio(hexToRgb(surfaceBorderLight), whiteRgb)).toBeGreaterThanOrEqual(3.0);

    // Dark surface tier (#111827, #1F2937, #374151, #4B5563) contrast checks
    const darkSurfaces = ['#111827', '#1F2937', '#374151', '#4B5563'] as const;
    const brandPalettes = [
      { primary: '#B91C1C', secondary: '#B45309' },
      { primary: '#7F1D1D', secondary: '#92400E' },
      { primary: '#1E3A8A', secondary: '#0F766E' },
      { primary: '#14532D', secondary: '#7E22CE' },
    ];

    for (const surfaceHex of darkSurfaces) {
      const surfaceRgb = hexToRgb(surfaceHex);
      const errorTextDark = optimizeContrast('#EF4444', surfaceHex, 4.5);
      const mutedTextDark = optimizeContrast('#9CA3AF', surfaceHex, 4.5);
      const warningTextDark = optimizeContrast('#FDE68A', surfaceHex, 4.5);
      const surfaceBorderDark = optimizeContrast('#9CA3AF', surfaceHex, 3.0);

      expect(getContrastRatio(hexToRgb(errorTextDark), surfaceRgb)).toBeGreaterThanOrEqual(4.5);
      expect(getContrastRatio(hexToRgb(mutedTextDark), surfaceRgb)).toBeGreaterThanOrEqual(4.5);
      expect(getContrastRatio(hexToRgb(warningTextDark), surfaceRgb)).toBeGreaterThanOrEqual(4.5);
      expect(getContrastRatio(hexToRgb(surfaceBorderDark), surfaceRgb)).toBeGreaterThanOrEqual(3.0);

      for (const palette of brandPalettes) {
        const primaryTextDark = optimizeContrast(palette.primary, surfaceHex, 4.5);
        const secondaryTextDark = optimizeContrast(palette.secondary, surfaceHex, 4.5);
        const focusRingDark = optimizeContrast(palette.primary, surfaceHex, 3.0);

        expect(getContrastRatio(hexToRgb(primaryTextDark), surfaceRgb)).toBeGreaterThanOrEqual(4.5);
        expect(getContrastRatio(hexToRgb(secondaryTextDark), surfaceRgb)).toBeGreaterThanOrEqual(4.5);
        expect(getContrastRatio(hexToRgb(focusRingDark), surfaceRgb)).toBeGreaterThanOrEqual(3.0);
      }
    }

    // Default solid bg-primary (#B91C1C) paired with white text retains >= 6.47:1 contrast,
    // and lighter custom brand palettes calibrate --color-primary to >= 4.5:1 against white text in .dark
    expect(getContrastRatio(hexToRgb('#B91C1C'), whiteRgb)).toBeGreaterThanOrEqual(6.47);
    const customLightBrandCss = generateDynamicStyles('#EF4444', '#F59E0B', 'classic');
    const customDarkSolidMatch = customLightBrandCss.match(/\.dark\s*\{[^}]+--color-primary:\s*(#[0-9a-fA-F]{6});/);
    const customDarkTextMatch = customLightBrandCss.match(
      /\.dark\s*\{[^}]+--color-primary-text:\s*(#[0-9a-fA-F]{6});/
    );
    expect(customDarkSolidMatch).toBeTruthy();
    expect(customDarkTextMatch).toBeTruthy();
    expect(getContrastRatio(hexToRgb(customDarkSolidMatch![1]), whiteRgb)).toBeGreaterThanOrEqual(4.5);
    expect(
      getContrastRatio(hexToRgb(customDarkTextMatch![1]), hexToRgb('#1F2937'))
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('calibrates default dark tokens against card surfaces (#1F2937 / Tailwind v4 800 or lighter preset --card-bg) and splits 700/600 dark tiers', () => {
    const css = generateThemeStylesheet(sampleConfig);
    const expectedCardPrimary = optimizeContrast('#B91C1C', '#1D293D', 4.5);
    const expected700Primary = optimizeContrast('#B91C1C', '#44403B', 4.5);
    const expected600Primary = optimizeContrast('#B91C1C', '#4B5563', 4.5);

    // .dark calibrates against #1D293D so text passes >= 4.5:1 on #111827, #1F2937, and Tailwind v4 gray-800/slate-800 (#1E2939/#1D293D)
    expect(css).toMatch(new RegExp('\\.dark\\s*\\{[^}]+--color-primary:\\s*#B91C1C;', 'i'));
    expect(css).toMatch(
      new RegExp(`\\.dark\\s*\\{[^}]+--color-primary-text:\\s*${expectedCardPrimary};`, 'i')
    );
    expect(getContrastRatio(hexToRgb(expectedCardPrimary), hexToRgb('#111827'))).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(hexToRgb(expectedCardPrimary), hexToRgb('#1F2937'))).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(hexToRgb(expectedCardPrimary), hexToRgb('#1E2939'))).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(hexToRgb(expectedCardPrimary), hexToRgb('#1D293D'))).toBeGreaterThanOrEqual(4.5);

    // 700 and 600 dark surfaces receive dedicated calibrated tokens
    expect(css).toContain('.dark .dark\\:bg-gray-700');
    expect(css).toContain(`--color-primary-text: ${expected700Primary};`);
    expect(getContrastRatio(hexToRgb(expected700Primary), hexToRgb('#374151'))).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(hexToRgb(expected700Primary), hexToRgb('#44403B'))).toBeGreaterThanOrEqual(4.5);

    expect(css).toContain('.dark .dark\\:bg-gray-600');
    expect(css).toContain(`--color-primary-text: ${expected600Primary};`);
    expect(getContrastRatio(hexToRgb(expected600Primary), hexToRgb('#4B5563'))).toBeGreaterThanOrEqual(4.5);

    // Pre-merged default light preset tokens (e.g. --card-bg: #ffffff from getAppConfig) do not clobber .dark --card-bg
    const preMergedLightCss = generateDynamicStyles('#B91C1C', '#B45309', 'classic', {
      '--card-bg': '#ffffff',
    });
    expect(preMergedLightCss).toMatch(/\.dark\s*\{[\s\S]*?--card-bg:\s*#1f2937;/i);

    // Lighter custom dark --card-bg raises base dark calibration to stay >= 4.5:1
    const lighterCardCss = generateDynamicStyles('#B91C1C', '#B45309', 'classic', {
      '--card-bg': '#2d3748',
    });
    const expectedLighterCardPrimary = optimizeContrast('#B91C1C', '#2d3748', 4.5);
    expect(lighterCardCss).toMatch(
      new RegExp(`\\.dark\\s*\\{[^}]+--color-primary-text:\\s*${expectedLighterCardPrimary};`, 'i')
    );
    expect(
      getContrastRatio(hexToRgb(expectedLighterCardPrimary), hexToRgb('#2d3748'))
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('resolves calibrated dark --color-primary-text on opacity-modified dark containers without leaking light #B91C1C', () => {
    const css = generateThemeStylesheet(sampleConfig);
    const styleEl = document.createElement('style');
    styleEl.textContent = css;
    document.head.appendChild(styleEl);

    const prevHtmlClass = document.documentElement.className;
    document.documentElement.className = 'dark';

    const host = document.createElement('div');
    host.innerHTML = `
      <div id="things-hotel-block" class="mb-4 p-4 rounded-lg bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700">
        <span id="things-tag" class="text-primary">Rate</span>
        <code id="things-promo" class="bg-gray-100 dark:bg-gray-700 text-primary">SAVE20</code>
      </div>
      <div id="timeline-batch" class="bg-gray-50 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700">
        <span id="timeline-label">Unsaved</span>
      </div>
      <div id="registry-stripe" class="bg-slate-50 dark:bg-slate-900/60 rounded-md">
        <span id="registry-icon" class="text-primary">Card</span>
      </div>
      <div id="faq-card" class="bg-white dark:bg-gray-800">
        <span id="faq-badge" class="bg-primary/10 text-primary">Travel</span>
      </div>
    `;
    document.body.appendChild(host);

    try {
      const expectedCardPrimary = optimizeContrast('#B91C1C', '#1D293D', 4.5);
      const expected700Primary = optimizeContrast('#B91C1C', '#44403B', 4.5);

      const hotelToken = getComputedStyle(document.getElementById('things-hotel-block')!)
        .getPropertyValue('--color-primary-text')
        .trim();
      const promoToken = getComputedStyle(document.getElementById('things-promo')!)
        .getPropertyValue('--color-primary-text')
        .trim();
      const timelineToken = getComputedStyle(document.getElementById('timeline-batch')!)
        .getPropertyValue('--color-primary-text')
        .trim();
      const registryToken = getComputedStyle(document.getElementById('registry-stripe')!)
        .getPropertyValue('--color-primary-text')
        .trim();
      const faqBadgeToken = getComputedStyle(document.getElementById('faq-badge')!)
        .getPropertyValue('--color-primary-text')
        .trim();

      expect(hotelToken.toLowerCase()).toBe(expectedCardPrimary.toLowerCase());
      expect(hotelToken.toLowerCase()).not.toBe('#b91c1c');
      expect(promoToken.toLowerCase()).toBe(expected700Primary.toLowerCase());
      expect(timelineToken.toLowerCase()).toBe(expectedCardPrimary.toLowerCase());
      expect(registryToken.toLowerCase()).toBe(expectedCardPrimary.toLowerCase());
      expect(faqBadgeToken.toLowerCase()).toBe(expected700Primary.toLowerCase());

      // Solid fill token remains raw #B91C1C
      const fillToken = getComputedStyle(document.getElementById('things-hotel-block')!)
        .getPropertyValue('--color-primary')
        .trim();
      expect(fillToken.toLowerCase()).toBe('#b91c1c');
    } finally {
      host.remove();
      styleEl.remove();
      document.documentElement.className = prevHtmlClass;
    }
  });

  it('compiles globals.css @theme inline utilities, .btn-secondary border contrast, static .dark fallbacks, and @media print rules', async () => {
    const globalsPath = path.join(process.cwd(), 'src/app/globals.css');
    const globalsContent = fs.readFileSync(globalsPath, 'utf8');
    const twIndex = fs.readFileSync(
      path.join(process.cwd(), 'node_modules/tailwindcss/index.css'),
      'utf8'
    );

    const compilableCss = globalsContent
      .replace('@import "tailwindcss";', twIndex)
      .replace(/^@source\s+[^\n]+$/m, '');

    const compiler = await compile(compilableCss, {
      base: path.dirname(globalsPath),
    });

    const builtCss = compiler.build([
      'text-primary',
      'dark:text-primary',
      'dark:text-primary-text',
      'text-secondary',
      'dark:text-secondary-text',
      'bg-primary',
      'from-primary',
      'btn-secondary',
    ]);

    // Foreground utilities bind to calibrated --color-primary-text / --color-secondary-text
    expect(builtCss).toMatch(/\.text-primary\s*\{[^}]*color:\s*var\(--color-primary-text\)/);
    expect(builtCss).toMatch(/\.dark\\:text-primary[^{]*\{[^}]*color:\s*var\(--color-primary-text\)/);
    expect(builtCss).toMatch(
      /\.dark\\:text-primary-text[^{]*\{[^}]*color:\s*var\(--color-primary-text\)/
    );
    expect(builtCss).toMatch(/\.text-secondary\s*\{[^}]*color:\s*var\(--color-secondary-text\)/);
    expect(builtCss).toMatch(
      /\.dark\\:text-secondary-text[^{]*\{[^}]*color:\s*var\(--color-secondary-text\)/
    );

    // Solid background and gradient utilities keep --color-primary
    expect(builtCss).toMatch(/\.bg-primary\s*\{[^}]*background-color:\s*var\(--color-primary\)/);
    expect(builtCss).toMatch(/\.from-primary\s*\{[^}]*--tw-gradient-from:\s*var\(--color-primary\)/);

    // .btn-secondary uses --color-primary-text for both label and border (>= 4.5:1 and >= 3.0:1)
    const btnSecondaryStart = builtCss.indexOf('.btn-secondary {');
    const btnSecondaryHoverStart = builtCss.indexOf('.btn-secondary:hover {');
    expect(btnSecondaryStart).toBeGreaterThan(-1);
    expect(btnSecondaryHoverStart).toBeGreaterThan(btnSecondaryStart);
    const btnSecondaryBlock = builtCss.slice(btnSecondaryStart, btnSecondaryHoverStart);
    expect(btnSecondaryBlock).toContain('color: var(--color-primary-text);');
    expect(btnSecondaryBlock).toContain('border-color: var(--color-primary-text);');

    // Static .dark fallback tokens in globals.css align with calibrated #1F2937 values
    const darkBlockMatch = globalsContent.match(/^\.dark\s*\{([^}]+)\}/m);
    expect(darkBlockMatch).toBeTruthy();
    const darkBlock = darkBlockMatch![1];
    const staticPrimaryMatch = darkBlock.match(/--color-primary-text:\s*(#[0-9a-fA-F]{6})/);
    const staticSecondaryMatch = darkBlock.match(/--color-secondary-text:\s*(#[0-9a-fA-F]{6})/);
    expect(staticPrimaryMatch).toBeTruthy();
    expect(staticSecondaryMatch).toBeTruthy();
    expect(
      getContrastRatio(hexToRgb(staticPrimaryMatch![1]), hexToRgb('#1F2937'))
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      getContrastRatio(hexToRgb(staticSecondaryMatch![1]), hexToRgb('#1F2937'))
    ).toBeGreaterThanOrEqual(4.5);

    // @media print overrides remain intact
    expect(globalsContent).toMatch(/@media print[\s\S]*--color-primary-text:\s*var\(--print-text\)\s*!important/);
    expect(globalsContent).toMatch(
      /@media print[\s\S]*--color-secondary-text:\s*var\(--print-text\)\s*!important/
    );
  });

  it('complies with size constraint by eliminating duplicate stylesheets on the document', () => {
    // When hasServerStylesheet is true, ThemeProvider suppresses duplicate inline stylesheet rendering
    const { container } = render(
      <ThemeProvider config={sampleConfig} hasServerStylesheet>
        <div>Content with server styles</div>
      </ThemeProvider>
    );

    // No duplicate style element injected in container
    const duplicateStyle = container.querySelector('#dynamic-theme-style');
    expect(duplicateStyle).toBeNull();
  });

  it('reconciles existing server stylesheet on client hydration without duplicate style elements', () => {
    // Simulate server-rendered stylesheet in document <head>
    const mockServerStyle = document.createElement('style');
    mockServerStyle.id = 'server-theme-styles';
    mockServerStyle.textContent = generateThemeStylesheet(sampleConfig);
    document.head.appendChild(mockServerStyle);

    expect(document.getElementById('server-theme-styles')).not.toBeNull();

    // Client hydration mounts ThemeProvider
    render(
      <ThemeProvider config={sampleConfig}>
        <div>Reconciled Content</div>
      </ThemeProvider>
    );

    // Existing server stylesheet should be reconciled (removed)
    expect(document.getElementById('server-theme-styles')).toBeNull();

    // Only dynamic-theme-style should be active
    const dynamicStyle = document.getElementById('dynamic-theme-style');
    expect(dynamicStyle).not.toBeNull();
    expect(dynamicStyle?.textContent).toContain('--color-primary: #B91C1C;');
  });

  it('synchronizes existing dynamic-theme-style element when hasServerStylesheet is true', () => {
    // Clean up any lingering style elements
    document.getElementById('dynamic-theme-style')?.remove();

    // Simulate server-rendered stylesheet with id dynamic-theme-style in head
    const headStyle = document.createElement('style');
    headStyle.id = 'dynamic-theme-style';
    headStyle.textContent = generateThemeStylesheet(sampleConfig);
    document.head.appendChild(headStyle);

    // Mount ThemeProvider with hasServerStylesheet
    const { rerender } = render(
      <ThemeProvider config={sampleConfig} hasServerStylesheet>
        <div>Test Page</div>
      </ThemeProvider>
    );

    // Stylesheet should remain exactly one
    expect(document.querySelectorAll('#dynamic-theme-style').length).toBe(1);

    // Update config dynamically
    const updatedConfig = { ...sampleConfig, colorPrimary: '#1E40AF' };
    rerender(
      <ThemeProvider config={updatedConfig} hasServerStylesheet>
        <div>Test Page</div>
      </ThemeProvider>
    );

    // Style element textContent should be updated with new color
    expect(headStyle.textContent).toContain('--color-primary: #1E40AF;');
  });

  it('handles empty or null configuration gracefully with fallbacks', () => {
    const defaultCss = generateThemeStylesheet(null);
    expect(defaultCss).toContain('--color-primary: #B91C1C;');
    expect(defaultCss).toContain('--color-secondary: #B45309;');
    expect(defaultCss).toContain('--container-max-w: 64rem;');
    expect(defaultCss).toContain('--grid-gap: 1.5rem;');
    expect(defaultCss).toContain('--card-padding: 2rem;');
    expect(defaultCss).toContain('--radius-card: 1rem;');
  });

  it('preserves dark preset Dialog contrast tokens when themeTokens contains uncustomized light preset defaults', () => {
    const css = generateThemeStylesheet({
      ...sampleConfig,
      themePreset: 'classic',
      themeTokens: {
        '--dialog-bg': '#ffffff',
        '--dialog-title-color': 'inherit',
        '--btn-radius': '0.75rem',
      },
    });

    const darkBlockMatch = css.match(/\.dark\s*\{([\s\S]*?)\}/);
    expect(darkBlockMatch).not.toBeNull();
    const darkBlock = darkBlockMatch?.[1] ?? '';
    expect(darkBlock).toContain('--dialog-bg: #1f2937;');
    expect(darkBlock).toContain('--dialog-title-color: #f9fafb;');
    expect(darkBlock).toContain('--btn-radius: 0.75rem;');
  });

  it('enforces >= 4.5:1 dark surface contrast across all 5 presets even when light surface or text tokens are customized', async () => {
    const { THEME_PRESET_KEYS } = await import('@/lib/theme/presets');

    const extractDarkVar = (darkCss: string, varName: string): string => {
      const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const m = darkCss.match(new RegExp(`${escaped}:\\s*([^;]+);`, 'i'));
      return m ? m[1].trim() : '';
    };

    for (const preset of THEME_PRESET_KEYS) {
      const css = generateThemeStylesheet({
        ...sampleConfig,
        themePreset: preset,
        themeTokens: {
          '--card-bg': '#f8fafc',
          '--dialog-bg': '#fffbeb',
          '--input-bg': '#f9fafb',
          '--container-bg': '#fff1f2',
          '--heading-color': '#1e293b',
          '--form-label-text': '#111827',
          '--dialog-title-color': '#0f172a',
        },
      });

      const darkBlockMatch = css.match(/\.dark\s*\{([\s\S]*?)\}/);
      expect(darkBlockMatch).not.toBeNull();
      const darkBlock = darkBlockMatch?.[1] ?? '';

      const darkCardBg = extractDarkVar(darkBlock, '--card-bg');
      const darkDialogBg = extractDarkVar(darkBlock, '--dialog-bg');
      const darkInputBg = extractDarkVar(darkBlock, '--input-bg');
      const darkHeading = extractDarkVar(darkBlock, '--heading-color');
      const darkFormLabel = extractDarkVar(darkBlock, '--form-label-text');
      const darkDialogTitle = extractDarkVar(darkBlock, '--dialog-title-color');
      const darkFormErr = extractDarkVar(darkBlock, '--form-error-text');

      expect(getContrastRatio(hexToRgb('#F9FAFB'), hexToRgb(darkCardBg))).toBeGreaterThanOrEqual(4.5);
      expect(getContrastRatio(hexToRgb('#F9FAFB'), hexToRgb(darkDialogBg))).toBeGreaterThanOrEqual(4.5);
      expect(getContrastRatio(hexToRgb('#F9FAFB'), hexToRgb(darkInputBg))).toBeGreaterThanOrEqual(4.5);
      expect(getContrastRatio(hexToRgb(darkHeading), hexToRgb(darkCardBg))).toBeGreaterThanOrEqual(4.5);
      expect(getContrastRatio(hexToRgb(darkFormLabel), hexToRgb(darkCardBg))).toBeGreaterThanOrEqual(4.5);
      expect(getContrastRatio(hexToRgb(darkFormLabel), hexToRgb(darkInputBg))).toBeGreaterThanOrEqual(4.5);
      expect(getContrastRatio(hexToRgb(darkDialogTitle), hexToRgb(darkDialogBg))).toBeGreaterThanOrEqual(4.5);
      expect(getContrastRatio(hexToRgb(darkFormErr), hexToRgb(darkCardBg))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('calibrates --toast-action-* and --badge-inverse-* tokens to >= 4.5:1 contrast across all 5 presets and custom brand palettes', async () => {
    const { THEME_PRESET_KEYS } = await import('@/lib/theme/presets');

    const extractVar = (blockCss: string, varName: string): string => {
      const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const m = blockCss.match(new RegExp(`${escaped}:\\s*([^;]+);`, 'i'));
      return m ? m[1].trim() : '';
    };

    const customPalettes = [
      { primary: '#B91C1C', secondary: '#B45309' },
      { primary: '#F59E0B', secondary: '#10B981' },
      { primary: '#0EA5E9', secondary: '#6366F1' },
    ];

    for (const preset of THEME_PRESET_KEYS) {
      for (const palette of customPalettes) {
        const css = generateDynamicStyles(palette.primary, palette.secondary, preset, {
          '--toast-action-bg': '#ffffff',
          '--toast-action-hover-bg': '#fef3c7',
          '--toast-action-text': '#f59e0b',
        });

        const rootBlock = css.match(/:root\s*\{([\s\S]*?)\}/)?.[1] ?? '';
        const darkBlock = css.match(/\.dark\s*\{([\s\S]*?)\}/)?.[1] ?? '';

        for (const block of [rootBlock, darkBlock]) {
          const actionBg = extractVar(block, '--toast-action-bg');
          const actionHoverBg = extractVar(block, '--toast-action-hover-bg');
          const actionText = extractVar(block, '--toast-action-text');
          const badgeBg = extractVar(block, '--badge-inverse-bg');
          const badgeText = extractVar(block, '--badge-inverse-text');

          expect(getContrastRatio(hexToRgb(actionText), hexToRgb(actionBg))).toBeGreaterThanOrEqual(4.5);
          expect(getContrastRatio(hexToRgb(actionText), hexToRgb(actionHoverBg))).toBeGreaterThanOrEqual(4.5);
          expect(getContrastRatio(hexToRgb(badgeText), hexToRgb(badgeBg))).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});
