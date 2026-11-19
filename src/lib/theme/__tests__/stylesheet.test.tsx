import {
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

    // Dark background (#111827) contrast checks
    const darkRgb = hexToRgb('#111827');
    const primaryTextDark = optimizeContrast(primary, '#111827', 4.5);
    const secondaryTextDark = optimizeContrast(secondary, '#111827', 4.5);
    const errorTextDark = optimizeContrast('#EF4444', '#111827', 4.5);
    const mutedTextDark = optimizeContrast('#9CA3AF', '#111827', 4.5);
    const warningTextDark = optimizeContrast('#FDE68A', '#111827', 4.5);
    const focusRingDark = optimizeContrast(primary, '#111827', 3.0);
    const surfaceBorderDark = optimizeContrast('#9CA3AF', '#111827', 3.0);

    expect(getContrastRatio(hexToRgb(primaryTextDark), darkRgb)).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(hexToRgb(secondaryTextDark), darkRgb)).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(hexToRgb(errorTextDark), darkRgb)).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(hexToRgb(mutedTextDark), darkRgb)).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(hexToRgb(warningTextDark), darkRgb)).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(hexToRgb(focusRingDark), darkRgb)).toBeGreaterThanOrEqual(3.0);
    expect(getContrastRatio(hexToRgb(surfaceBorderDark), darkRgb)).toBeGreaterThanOrEqual(3.0);
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
});
