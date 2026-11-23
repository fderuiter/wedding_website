'use client';

import React, { useRef, useState } from 'react';
import { FormGroup, Label, Input, FormMessage } from '@/components/ui/forms';
import { Icon } from '@/components/ui/Icon';
import {
  THEME_PRESET_KEYS,
  ThemePreset,
  getPresetTokens,
  getServerExportTokens,
  stripPresetDefaultTokens,
} from '@/lib/theme/presets';

const layoutTokenRegex = /^\d+(\.\d+)?(px|rem|em|%|ch)$/;

const PRESET_DESCRIPTIONS: Record<ThemePreset, string> = {
  classic: 'Timeless elegance with traditional serif accents and warm rose tones',
  modern: 'Clean slate design with crisp borders, generous shadows, and refined typography',
  romantic: 'Soft pastel aesthetic with pill-shaped buttons and gentle blush padding',
  minimal: 'Monochrome minimalism with sharp square borders and high-contrast tokens',
  editorial: 'Bold typographic layout with thick borders and high-impact card shadows',
};

function formatShortFontName(fontStack: string): string {
  const first = fontStack.split(',')[0] || 'Serif';
  return first.replace(/['"]/g, '').trim();
}

interface ThemeConfigValues {
  colorPrimary?: string;
  colorSecondary?: string;
  themePreset?: ThemePreset | string;
  layoutContainerMaxWidth?: string;
  layoutGridGap?: string;
  layoutCardPadding?: string;
  layoutBorderRadius?: string;
  printBg?: string;
  printText?: string;
  printBorder?: string;
  printHeaderBorder?: string;
  printBadgeBg?: string;
  themeTokens?: Record<string, string>;
}

interface ThemeConfigurationPanelProps {
  values: ThemeConfigValues;
  onChange: (_updatedFields: Partial<ThemeConfigValues>) => void;
  className?: string;
  errors?: Record<string, string>;
  mode?: 'full' | 'essentials';
}

export function ThemeConfigurationPanel({
  values,
  onChange,
  className = '',
  errors: externalErrors = {},
  mode = 'full',
}: ThemeConfigurationPanelProps) {
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});

  const primaryColor = values.colorPrimary || '#B91C1C';
  const secondaryColor = values.colorSecondary || '#B45309';
  const selectedPreset = (values.themePreset as ThemePreset) || 'classic';

  const activePresetTokens = getPresetTokens(selectedPreset, 'light');

  const printBg = values.printBg || values.themeTokens?.['--print-bg'] || activePresetTokens['--print-bg'] || '#ffffff';
  const printText = values.printText || values.themeTokens?.['--print-text'] || activePresetTokens['--print-text'] || '#111827';
  const printBorder = values.printBorder || values.themeTokens?.['--print-border'] || activePresetTokens['--print-border'] || '#e5e7eb';
  const printHeaderBorder = values.printHeaderBorder || values.themeTokens?.['--print-header-border'] || activePresetTokens['--print-header-border'] || '#111827';
  const printBadgeBg = values.printBadgeBg || values.themeTokens?.['--print-badge-bg'] || activePresetTokens['--print-badge-bg'] || '#f3f4f6';

  // Persisted Layout & Spacing Controls
  const containerMaxWidth = values.layoutContainerMaxWidth ?? '64rem';
  const gridGap = values.layoutGridGap ?? '1.5rem';
  const cardPadding = values.layoutCardPadding ?? '2rem';
  const borderRadius = values.layoutBorderRadius ?? '1rem';

  const validateField = (fieldName: string, val: string) => {
    const trimmed = val.trim();
    if (trimmed === '') {
      setLocalErrors((prev) => {
        const next = { ...prev };
        delete next[fieldName];
        return next;
      });
      return true;
    }

    if (!layoutTokenRegex.test(trimmed)) {
      setLocalErrors((prev) => ({
        ...prev,
        [fieldName]:
          'Enter a valid size measurement using px, rem, em, %, or ch (for example, 64rem, 20px, 1.5rem, or 100%).',
      }));
      return false;
    }

    setLocalErrors((prev) => {
      const next = { ...prev };
      delete next[fieldName];
      return next;
    });
    return true;
  };

  const handleFieldChange = (
    fieldName: 'layoutContainerMaxWidth' | 'layoutGridGap' | 'layoutCardPadding' | 'layoutBorderRadius',
    val: string
  ) => {
    validateField(fieldName, val);
    onChange({ [fieldName]: val });
  };

  const handlePrintTokenChange = (
    propName: 'printBg' | 'printText' | 'printBorder' | 'printHeaderBorder' | 'printBadgeBg',
    tokenKey: string,
    val: string
  ) => {
    const updatedTokens = {
      ...(values.themeTokens || {}),
    };
    const presetDefault = (activePresetTokens as unknown as Record<string, unknown>)[tokenKey];
    if (val === presetDefault) {
      delete updatedTokens[tokenKey];
    } else {
      updatedTokens[tokenKey] = val;
    }
    onChange({
      [propName]: val,
      themeTokens: updatedTokens,
    });
  };

  const presetCardRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const normalizedSelectedIndex = Math.max(0, THEME_PRESET_KEYS.indexOf(selectedPreset));

  const handlePresetChange = (nextPreset: ThemePreset) => {
    if (values.themeTokens !== undefined) {
      onChange({
        themePreset: nextPreset,
        themeTokens: stripPresetDefaultTokens(values.themeTokens, nextPreset, selectedPreset),
      });
      return;
    }
    onChange({ themePreset: nextPreset });
  };

  const handlePresetKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const count = THEME_PRESET_KEYS.length;
    let nextIndex = index;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      nextIndex = (index + 1) % count;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      nextIndex = (index - 1 + count) % count;
    } else if (e.key === 'Home') {
      nextIndex = 0;
    } else if (e.key === 'End') {
      nextIndex = count - 1;
    } else {
      return;
    }
    e.preventDefault();
    const nextPreset = THEME_PRESET_KEYS[nextIndex];
    handlePresetChange(nextPreset);
    presetCardRefs.current[nextIndex]?.focus();
  };

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Theme Preset Visual Cards */}
      <FormGroup>
        <span
          id="themePreset-label"
          className="block text-sm font-semibold text-gray-900 dark:text-zinc-100"
        >
          Select Theme Preset
        </span>
        <div
          role="radiogroup"
          aria-labelledby="themePreset-label"
          aria-describedby="themePreset-desc"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-1.5"
        >
          {THEME_PRESET_KEYS.map((preset, index) => {
            const isSelected = selectedPreset === preset;
            const isTabbable = index === normalizedSelectedIndex;
            const exportTokens = getServerExportTokens(preset);
            const compTokens = getPresetTokens(preset, 'light');
            const cardRadius = compTokens['--schedule-card-radius'] || '1rem';
            const btnRadius = compTokens['--btn-radius'] || '0.5rem';
            const shortHeadingFont = formatShortFontName(exportTokens.fontHeading);
            const presetLabel = `${preset.charAt(0).toUpperCase()}${preset.slice(1)} Preset`;
            const swatchColors = [
              exportTokens.canvasBg,
              exportTokens.cardBg,
              isSelected ? primaryColor : exportTokens.colorPrimary,
              isSelected ? secondaryColor : exportTokens.colorSecondary,
            ];

            return (
              <button
                key={preset}
                ref={(el) => {
                  presetCardRefs.current[index] = el;
                }}
                type="button"
                role="radio"
                aria-checked={isSelected}
                aria-label={presetLabel}
                tabIndex={isTabbable ? 0 : -1}
                data-preset={preset}
                onClick={() => handlePresetChange(preset)}
                onKeyDown={(e) => handlePresetKeyDown(e, index)}
                className={`group flex flex-col justify-between text-left rounded-xl border p-3 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                  isSelected
                    ? 'border-primary ring-2 ring-primary/30 bg-rose-50/40 dark:bg-zinc-800 shadow-sm'
                    : 'border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900/70 hover:border-gray-400 dark:hover:border-zinc-500'
                }`}
              >
                {/* Visual Mini Surface Preview */}
                <div
                  aria-hidden="true"
                  className="w-full rounded-lg p-2.5 mb-2.5 border border-black/10"
                  style={{ backgroundColor: exportTokens.canvasBg }}
                >
                  <div
                    className="p-2.5 flex items-center justify-between gap-2"
                    style={{
                      backgroundColor: exportTokens.cardBg,
                      borderRadius: cardRadius,
                      border: '1px solid rgba(17, 24, 39, 0.14)',
                    }}
                  >
                    <span
                      className="text-base font-bold leading-none truncate"
                      style={{
                        fontFamily: exportTokens.fontHeading,
                        color: '#111827',
                      }}
                    >
                      Aa · {preset.charAt(0).toUpperCase() + preset.slice(1)}
                    </span>
                    <span
                      className="inline-block h-4 w-9 shrink-0 border border-black/15"
                      style={{
                        backgroundColor: isSelected ? primaryColor : exportTokens.colorPrimary,
                        borderRadius: btnRadius,
                      }}
                    />
                  </div>
                </div>

                {/* Preset Title, Palette Swatches, Font & Radius Meta */}
                <div className="w-full space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                      {presetLabel}
                    </span>
                    {isSelected && (
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white shrink-0">
                        <Icon name="Check" size={12} />
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <div
                      aria-hidden="true"
                      data-testid={`preset-palette-${preset}`}
                      className="flex items-center gap-1"
                    >
                      {swatchColors.map((hex, chipIdx) => (
                        <span
                          key={`${preset}-chip-${chipIdx}`}
                          className="inline-block h-3.5 w-3.5 rounded-full border border-black/20 dark:border-white/30"
                          style={{ backgroundColor: hex }}
                        />
                      ))}
                    </div>
                    <span className="text-[11px] font-medium text-gray-600 dark:text-zinc-300 truncate">
                      {shortHeadingFont} · {cardRadius}
                    </span>
                  </div>

                  <p className="text-xs text-gray-600 dark:text-gray-300 line-clamp-2">
                    {PRESET_DESCRIPTIONS[preset]}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
        <p id="themePreset-desc" className="text-xs text-gray-600 dark:text-gray-300 mt-1">
          {PRESET_DESCRIPTIONS[selectedPreset] || PRESET_DESCRIPTIONS.classic}
        </p>
      </FormGroup>

      {/* Primary & Secondary Color Pickers */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormGroup>
          <Label htmlFor="colorPrimary">Primary Color (Hex)</Label>
          <div className="flex gap-2">
            <Input
              type="color"
              id="colorPrimaryPicker"
              aria-label="Primary Color Picker"
              value={primaryColor}
              onChange={(e) => onChange({ colorPrimary: e.target.value })}
              className="w-12 h-10 p-1 rounded border cursor-pointer"
            />
            <Input
              id="colorPrimary"
              type="text"
              name="colorPrimary"
              value={primaryColor}
              onChange={(e) => onChange({ colorPrimary: e.target.value })}
              placeholder="#B91C1C"
              aria-label="Primary Color Code"
            />
          </div>
        </FormGroup>

        <FormGroup>
          <Label htmlFor="colorSecondary">Secondary Color (Hex)</Label>
          <div className="flex gap-2">
            <Input
              type="color"
              id="colorSecondaryPicker"
              aria-label="Secondary Color Picker"
              value={secondaryColor}
              onChange={(e) => onChange({ colorSecondary: e.target.value })}
              className="w-12 h-10 p-1 rounded border cursor-pointer"
            />
            <Input
              id="colorSecondary"
              type="text"
              name="colorSecondary"
              value={secondaryColor}
              onChange={(e) => onChange({ colorSecondary: e.target.value })}
              placeholder="#B45309"
              aria-label="Secondary Color Code"
            />
          </div>
        </FormGroup>
      </div>

      {mode === 'essentials' ? (
        <p className="text-xs text-gray-600 dark:text-gray-300">
          Layout spacing, card rounding, and print styling colors can be customized anytime in Site Settings.
        </p>
      ) : (
        <>
          {/* Layout & Spacing Controls */}
          <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-zinc-700">
            <h3 className="text-md font-semibold text-gray-900 dark:text-zinc-100">
              Layout & Spacing Controls
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormGroup state={localErrors.layoutContainerMaxWidth || externalErrors.layoutContainerMaxWidth ? 'error' : 'default'}>
                <Label htmlFor="layoutContainerMaxWidth">Container Max Width</Label>
                <Input
                  id="layoutContainerMaxWidth"
                  name="layoutContainerMaxWidth"
                  type="text"
                  value={containerMaxWidth}
                  onChange={(e) => handleFieldChange('layoutContainerMaxWidth', e.target.value)}
                  placeholder="e.g. 64rem, 1200px"
                  aria-invalid={Boolean(localErrors.layoutContainerMaxWidth || externalErrors.layoutContainerMaxWidth)}
                />
                {localErrors.layoutContainerMaxWidth || externalErrors.layoutContainerMaxWidth ? (
                  <FormMessage id="layoutContainerMaxWidth-error" role="alert">
                    {localErrors.layoutContainerMaxWidth || externalErrors.layoutContainerMaxWidth}
                  </FormMessage>
                ) : (
                  <FormMessage id="layoutContainerMaxWidth-help">
                    Maximum page width in pixels or rem (for example, 64rem or 1200px). Leave blank to use the preset default.
                  </FormMessage>
                )}
              </FormGroup>

              <FormGroup state={localErrors.layoutGridGap || externalErrors.layoutGridGap ? 'error' : 'default'}>
                <Label htmlFor="layoutGridGap">Grid Gap</Label>
                <Input
                  id="layoutGridGap"
                  name="layoutGridGap"
                  type="text"
                  value={gridGap}
                  onChange={(e) => handleFieldChange('layoutGridGap', e.target.value)}
                  placeholder="e.g. 1.5rem, 24px"
                  aria-invalid={Boolean(localErrors.layoutGridGap || externalErrors.layoutGridGap)}
                />
                {localErrors.layoutGridGap || externalErrors.layoutGridGap ? (
                  <FormMessage id="layoutGridGap-error" role="alert">
                    {localErrors.layoutGridGap || externalErrors.layoutGridGap}
                  </FormMessage>
                ) : (
                  <FormMessage id="layoutGridGap-help">
                    Spacing between layout grid items (e.g. 1.5rem, 24px).
                  </FormMessage>
                )}
              </FormGroup>

              <FormGroup state={localErrors.layoutCardPadding || externalErrors.layoutCardPadding ? 'error' : 'default'}>
                <Label htmlFor="layoutCardPadding">Card Padding</Label>
                <Input
                  id="layoutCardPadding"
                  name="layoutCardPadding"
                  type="text"
                  value={cardPadding}
                  onChange={(e) => handleFieldChange('layoutCardPadding', e.target.value)}
                  placeholder="e.g. 2rem, 32px"
                  aria-invalid={Boolean(localErrors.layoutCardPadding || externalErrors.layoutCardPadding)}
                />
                {localErrors.layoutCardPadding || externalErrors.layoutCardPadding ? (
                  <FormMessage id="layoutCardPadding-error" role="alert">
                    {localErrors.layoutCardPadding || externalErrors.layoutCardPadding}
                  </FormMessage>
                ) : (
                  <FormMessage id="layoutCardPadding-help">
                    Inner padding for card containers (e.g. 2rem, 32px).
                  </FormMessage>
                )}
              </FormGroup>

              <FormGroup state={localErrors.layoutBorderRadius || externalErrors.layoutBorderRadius ? 'error' : 'default'}>
                <Label htmlFor="layoutBorderRadius">Card Border Radius</Label>
                <Input
                  id="layoutBorderRadius"
                  name="layoutBorderRadius"
                  type="text"
                  value={borderRadius}
                  onChange={(e) => handleFieldChange('layoutBorderRadius', e.target.value)}
                  placeholder="e.g. 1rem, 16px, 0px"
                  aria-invalid={Boolean(localErrors.layoutBorderRadius || externalErrors.layoutBorderRadius)}
                />
                {localErrors.layoutBorderRadius || externalErrors.layoutBorderRadius ? (
                  <FormMessage id="layoutBorderRadius-error" role="alert">
                    {localErrors.layoutBorderRadius || externalErrors.layoutBorderRadius}
                  </FormMessage>
                ) : (
                  <FormMessage id="layoutBorderRadius-help">
                    Corner rounding scale for cards and containers (e.g. 1rem, 16px, 0px).
                  </FormMessage>
                )}
              </FormGroup>
            </div>
          </div>

          {/* Print Styling Controls */}
          <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-zinc-700">
            <h3 className="text-md font-semibold text-gray-900 dark:text-zinc-100">
              Print Styling Controls
            </h3>
            <p className="text-xs text-gray-600 dark:text-gray-300">
              Customize colors used when printing seating floorplans, rosters, and schedules.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Print Background */}
              <FormGroup>
                <Label htmlFor="printBg">Print Background Color</Label>
                <div className="flex gap-2">
                  <Input
                    type="color"
                    id="printBgPicker"
                    aria-label="Print Background Color Picker"
                    value={printBg.startsWith('#') ? printBg : '#ffffff'}
                    onChange={(e) => handlePrintTokenChange('printBg', '--print-bg', e.target.value)}
                    className="w-12 h-10 p-1 rounded border cursor-pointer"
                  />
                  <Input
                    id="printBg"
                    type="text"
                    name="printBg"
                    value={printBg}
                    onChange={(e) => handlePrintTokenChange('printBg', '--print-bg', e.target.value)}
                    placeholder="#ffffff"
                    aria-label="Print Background Color Code"
                  />
                </div>
              </FormGroup>

              {/* Print Text Color */}
              <FormGroup>
                <Label htmlFor="printText">Print Text Color</Label>
                <div className="flex gap-2">
                  <Input
                    type="color"
                    id="printTextPicker"
                    aria-label="Print Text Color Picker"
                    value={printText.startsWith('#') ? printText : '#111827'}
                    onChange={(e) => handlePrintTokenChange('printText', '--print-text', e.target.value)}
                    className="w-12 h-10 p-1 rounded border cursor-pointer"
                  />
                  <Input
                    id="printText"
                    type="text"
                    name="printText"
                    value={printText}
                    onChange={(e) => handlePrintTokenChange('printText', '--print-text', e.target.value)}
                    placeholder="#111827"
                    aria-label="Print Text Color Code"
                  />
                </div>
              </FormGroup>

              {/* Print Border Color */}
              <FormGroup>
                <Label htmlFor="printBorder">Print Border Color</Label>
                <div className="flex gap-2">
                  <Input
                    type="color"
                    id="printBorderPicker"
                    aria-label="Print Border Color Picker"
                    value={printBorder.startsWith('#') ? printBorder : '#e5e7eb'}
                    onChange={(e) => handlePrintTokenChange('printBorder', '--print-border', e.target.value)}
                    className="w-12 h-10 p-1 rounded border cursor-pointer"
                  />
                  <Input
                    id="printBorder"
                    type="text"
                    name="printBorder"
                    value={printBorder}
                    onChange={(e) => handlePrintTokenChange('printBorder', '--print-border', e.target.value)}
                    placeholder="#e5e7eb"
                    aria-label="Print Border Color Code"
                  />
                </div>
              </FormGroup>

              {/* Print Header Border Color */}
              <FormGroup>
                <Label htmlFor="printHeaderBorder">Print Header Border Color</Label>
                <div className="flex gap-2">
                  <Input
                    type="color"
                    id="printHeaderBorderPicker"
                    aria-label="Print Header Border Color Picker"
                    value={printHeaderBorder.startsWith('#') ? printHeaderBorder : '#111827'}
                    onChange={(e) => handlePrintTokenChange('printHeaderBorder', '--print-header-border', e.target.value)}
                    className="w-12 h-10 p-1 rounded border cursor-pointer"
                  />
                  <Input
                    id="printHeaderBorder"
                    type="text"
                    name="printHeaderBorder"
                    value={printHeaderBorder}
                    onChange={(e) => handlePrintTokenChange('printHeaderBorder', '--print-header-border', e.target.value)}
                    placeholder="#111827"
                    aria-label="Print Header Border Color Code"
                  />
                </div>
              </FormGroup>

              {/* Print Badge Background */}
              <FormGroup className="md:col-span-2">
                <Label htmlFor="printBadgeBg">Print Badge Accent Color</Label>
                <div className="flex gap-2">
                  <Input
                    type="color"
                    id="printBadgeBgPicker"
                    aria-label="Print Badge Accent Color Picker"
                    value={printBadgeBg.startsWith('#') ? printBadgeBg : '#f3f4f6'}
                    onChange={(e) => handlePrintTokenChange('printBadgeBg', '--print-badge-bg', e.target.value)}
                    className="w-12 h-10 p-1 rounded border cursor-pointer"
                  />
                  <Input
                    id="printBadgeBg"
                    type="text"
                    name="printBadgeBg"
                    value={printBadgeBg}
                    onChange={(e) => handlePrintTokenChange('printBadgeBg', '--print-badge-bg', e.target.value)}
                    placeholder="#f3f4f6"
                    aria-label="Print Badge Accent Color Code"
                  />
                </div>
              </FormGroup>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
