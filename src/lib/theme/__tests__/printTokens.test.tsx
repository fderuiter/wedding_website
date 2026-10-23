import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { THEME_PRESETS, THEME_PRESET_KEYS, getPresetTokens } from '../presets';
import { generateDynamicStyles } from '@/components/ThemeProvider';
import { PrintableFloorplan } from '@/features/seating';

describe('Print Token Theme Preset Integration', () => {
  test('all 5 presets have print tokens populated in light mode', () => {
    for (const presetKey of THEME_PRESET_KEYS) {
      const tokens = THEME_PRESETS[presetKey];
      expect(tokens['--print-bg']).toBeDefined();
      expect(tokens['--print-text']).toBeDefined();
      expect(tokens['--print-border']).toBeDefined();
      expect(tokens['--print-header-border']).toBeDefined();
      expect(tokens['--print-badge-bg']).toBeDefined();
    }
  });

  test('all 5 presets declare dark mode print token overrides in darkTokens', () => {
    for (const presetKey of THEME_PRESET_KEYS) {
      const darkTokens = THEME_PRESETS[presetKey].darkTokens;
      expect(darkTokens).toBeDefined();
      expect(darkTokens?.['--print-bg']).toBeDefined();
      expect(darkTokens?.['--print-text']).toBeDefined();
      expect(darkTokens?.['--print-border']).toBeDefined();
      expect(darkTokens?.['--print-header-border']).toBeDefined();
      expect(darkTokens?.['--print-badge-bg']).toBeDefined();
    }
  });

  test('getPresetTokens returns dark mode print tokens when mode is dark', () => {
    for (const presetKey of THEME_PRESET_KEYS) {
      const darkTokens = getPresetTokens(presetKey, 'dark');
      expect(darkTokens['--print-bg']).toBeDefined();
      expect(darkTokens['--print-text']).toBeDefined();
      expect(darkTokens['--print-border']).toBeDefined();
      expect(darkTokens['--print-header-border']).toBeDefined();
      expect(darkTokens['--print-badge-bg']).toBeDefined();
    }
  });

  test('generateDynamicStyles includes print tokens in both :root and .dark rules', () => {
    const css = generateDynamicStyles('#B91C1C', '#B45309', 'romantic', {}, {}, {});
    expect(css).toContain('--print-bg:');
    expect(css).toContain('--print-text:');
    expect(css).toContain('--print-border:');
    expect(css).toContain('--print-header-border:');
    expect(css).toContain('--print-badge-bg:');
  });

  test('PrintableFloorplan references CSS variables without hardcoded hex fallbacks or border-black class', () => {
    const tables = [
      {
        id: 'table-1',
        name: 'Table 1',
        shape: 'round',
        capacity: 8,
        invitationCodes: [
          { id: 'guest-1', guestName: 'Alice', code: 'ABC123', seatNumber: 1 },
        ],
      },
    ];
    const unassigned = [
      { id: 'guest-2', guestName: 'Bob', code: 'DEF456' },
    ];

    const { container } = render(
      <PrintableFloorplan tables={tables as any} unassignedGuests={unassigned as any} />
    );

    const mainElement = container.querySelector('main');
    expect(mainElement).toBeInTheDocument();
    expect(mainElement?.getAttribute('style')).toContain('var(--print-bg)');
    expect(mainElement?.getAttribute('style')).not.toContain('#ffffff');

    const headings = container.querySelectorAll('h2');
    headings.forEach((h2) => {
      expect(h2.className).not.toContain('border-black');
    });
  });
});
