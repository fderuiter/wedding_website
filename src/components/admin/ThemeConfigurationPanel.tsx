'use client';

import { useState } from 'react';
import { FormGroup, Label, Input, FormMessage } from '@/components/ui/forms';
import { THEME_PRESET_KEYS, ThemePreset, getPresetTokens } from '@/lib/theme/presets';

const layoutTokenRegex = /^\d+(\.\d+)?(px|rem|em|%|ch)$/;

const PRESET_DESCRIPTIONS: Record<ThemePreset, string> = {
  classic: 'Timeless elegance with traditional serif accents and warm rose tones',
  modern: 'Clean slate design with crisp borders, generous shadows, and refined typography',
  romantic: 'Soft pastel aesthetic with pill-shaped buttons and gentle blush padding',
  minimal: 'Monochrome minimalism with sharp square borders and high-contrast tokens',
  editorial: 'Bold typographic layout with thick borders and high-impact card shadows',
};

export interface ThemeConfigValues {
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

export interface ThemeConfigurationPanelProps {
  values: ThemeConfigValues;
  onChange: (updatedFields: Partial<ThemeConfigValues>) => void;
  className?: string;
  errors?: Record<string, string>;
}

export function ThemeConfigurationPanel({
  values,
  onChange,
  className = '',
  errors: externalErrors = {},
}: ThemeConfigurationPanelProps) {
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});

  const primaryColor = values.colorPrimary || '#B91C1C';
  const secondaryColor = values.colorSecondary || '#B45309';
  const selectedPreset = (values.themePreset as ThemePreset) || 'classic';
  const containerMaxWidth = values.layoutContainerMaxWidth ?? '64rem';
  const gridGap = values.layoutGridGap ?? '1.5rem';
  const cardPadding = values.layoutCardPadding ?? '2rem';
  const borderRadius = values.layoutBorderRadius ?? '1rem';

  const activePresetTokens = getPresetTokens(selectedPreset, 'light');

  const printBg = values.printBg || values.themeTokens?.['--print-bg'] || activePresetTokens['--print-bg'] || '#ffffff';
  const printText = values.printText || values.themeTokens?.['--print-text'] || activePresetTokens['--print-text'] || '#111827';
  const printBorder = values.printBorder || values.themeTokens?.['--print-border'] || activePresetTokens['--print-border'] || '#e5e7eb';
  const printHeaderBorder = values.printHeaderBorder || values.themeTokens?.['--print-header-border'] || activePresetTokens['--print-header-border'] || '#111827';
  const printBadgeBg = values.printBadgeBg || values.themeTokens?.['--print-badge-bg'] || activePresetTokens['--print-badge-bg'] || '#f3f4f6';

  const validateLayoutField = (fieldName: string, val: string) => {
    const trimmed = val.trim();
    if (trimmed === '') {
      // Blank values fall back to APP_DEFAULTS
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
        [fieldName]: 'Invalid CSS length unit format. Use values like 64rem, 20px, 1.5rem, or 100%.',
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

  const handleLayoutChange = (fieldName: keyof ThemeConfigValues, val: string) => {
    validateLayoutField(fieldName, val);
    onChange({ [fieldName]: val });
  };

  const handlePrintTokenChange = (
    propName: 'printBg' | 'printText' | 'printBorder' | 'printHeaderBorder' | 'printBadgeBg',
    tokenKey: string,
    val: string
  ) => {
    const updatedTokens = {
      ...(values.themeTokens || {}),
      [tokenKey]: val,
    };
    onChange({
      [propName]: val,
      themeTokens: updatedTokens,
    });
  };

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Theme Preset Selection */}
      <FormGroup>
        <Label htmlFor="themePreset" className="font-semibold text-gray-900 dark:text-zinc-100">
          Theme Preset
        </Label>
        <select
          id="themePreset"
          name="themePreset"
          value={selectedPreset}
          onChange={(e) => onChange({ themePreset: e.target.value as ThemePreset })}
          aria-label="Select Theme Preset"
          aria-describedby="themePreset-desc"
          className="w-full rounded-md border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2 text-sm text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-rose-500"
        >
          {THEME_PRESET_KEYS.map((preset) => (
            <option key={preset} value={preset}>
              {preset.charAt(0).toUpperCase() + preset.slice(1)} Preset
            </option>
          ))}
        </select>
        <p id="themePreset-desc" className="text-xs text-gray-500 dark:text-gray-400 mt-1">
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

      {/* Layout Scale Token Inputs */}
      <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-zinc-700">
        <h3 className="text-md font-semibold text-gray-900 dark:text-zinc-100">
          Layout & Spacing Controls
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Container Max Width */}
          <FormGroup state={localErrors.layoutContainerMaxWidth || externalErrors.layoutContainerMaxWidth ? 'error' : 'default'}>
            <Label htmlFor="layoutContainerMaxWidth">Container Max Width</Label>
            <Input
              id="layoutContainerMaxWidth"
              name="layoutContainerMaxWidth"
              type="text"
              value={containerMaxWidth}
              onChange={(e) => handleLayoutChange('layoutContainerMaxWidth', e.target.value)}
              placeholder="e.g. 64rem, 1200px"
              aria-invalid={Boolean(localErrors.layoutContainerMaxWidth || externalErrors.layoutContainerMaxWidth)}
              aria-describedby={
                localErrors.layoutContainerMaxWidth || externalErrors.layoutContainerMaxWidth
                  ? 'layoutContainerMaxWidth-error'
                  : 'layoutContainerMaxWidth-help'
              }
            />
            {localErrors.layoutContainerMaxWidth || externalErrors.layoutContainerMaxWidth ? (
              <FormMessage id="layoutContainerMaxWidth-error" role="alert">
                {localErrors.layoutContainerMaxWidth || externalErrors.layoutContainerMaxWidth}
              </FormMessage>
            ) : (
              <p id="layoutContainerMaxWidth-help" className="text-xs text-gray-500 dark:text-gray-400">
                Standard CSS unit (e.g. 64rem, 1200px). Blank falls back to default.
              </p>
            )}
          </FormGroup>

          {/* Grid Gap */}
          <FormGroup state={localErrors.layoutGridGap || externalErrors.layoutGridGap ? 'error' : 'default'}>
            <Label htmlFor="layoutGridGap">Grid Gap</Label>
            <Input
              id="layoutGridGap"
              name="layoutGridGap"
              type="text"
              value={gridGap}
              onChange={(e) => handleLayoutChange('layoutGridGap', e.target.value)}
              placeholder="e.g. 1.5rem, 24px"
              aria-invalid={Boolean(localErrors.layoutGridGap || externalErrors.layoutGridGap)}
              aria-describedby={
                localErrors.layoutGridGap || externalErrors.layoutGridGap
                  ? 'layoutGridGap-error'
                  : 'layoutGridGap-help'
              }
            />
            {localErrors.layoutGridGap || externalErrors.layoutGridGap ? (
              <FormMessage id="layoutGridGap-error" role="alert">
                {localErrors.layoutGridGap || externalErrors.layoutGridGap}
              </FormMessage>
            ) : (
              <p id="layoutGridGap-help" className="text-xs text-gray-500 dark:text-gray-400">
                Spacing between layout grid items (e.g. 1.5rem, 24px).
              </p>
            )}
          </FormGroup>

          {/* Card Padding */}
          <FormGroup state={localErrors.layoutCardPadding || externalErrors.layoutCardPadding ? 'error' : 'default'}>
            <Label htmlFor="layoutCardPadding">Card Padding</Label>
            <Input
              id="layoutCardPadding"
              name="layoutCardPadding"
              type="text"
              value={cardPadding}
              onChange={(e) => handleLayoutChange('layoutCardPadding', e.target.value)}
              placeholder="e.g. 2rem, 32px"
              aria-invalid={Boolean(localErrors.layoutCardPadding || externalErrors.layoutCardPadding)}
              aria-describedby={
                localErrors.layoutCardPadding || externalErrors.layoutCardPadding
                  ? 'layoutCardPadding-error'
                  : 'layoutCardPadding-help'
              }
            />
            {localErrors.layoutCardPadding || externalErrors.layoutCardPadding ? (
              <FormMessage id="layoutCardPadding-error" role="alert">
                {localErrors.layoutCardPadding || externalErrors.layoutCardPadding}
              </FormMessage>
            ) : (
              <p id="layoutCardPadding-help" className="text-xs text-gray-500 dark:text-gray-400">
                Inner padding for card containers (e.g. 2rem, 32px).
              </p>
            )}
          </FormGroup>

          {/* Border Radius */}
          <FormGroup state={localErrors.layoutBorderRadius || externalErrors.layoutBorderRadius ? 'error' : 'default'}>
            <Label htmlFor="layoutBorderRadius">Border Radius</Label>
            <Input
              id="layoutBorderRadius"
              name="layoutBorderRadius"
              type="text"
              value={borderRadius}
              onChange={(e) => handleLayoutChange('layoutBorderRadius', e.target.value)}
              placeholder="e.g. 1rem, 16px, 0px"
              aria-invalid={Boolean(localErrors.layoutBorderRadius || externalErrors.layoutBorderRadius)}
              aria-describedby={
                localErrors.layoutBorderRadius || externalErrors.layoutBorderRadius
                  ? 'layoutBorderRadius-error'
                  : 'layoutBorderRadius-help'
              }
            />
            {localErrors.layoutBorderRadius || externalErrors.layoutBorderRadius ? (
              <FormMessage id="layoutBorderRadius-error" role="alert">
                {localErrors.layoutBorderRadius || externalErrors.layoutBorderRadius}
              </FormMessage>
            ) : (
              <p id="layoutBorderRadius-help" className="text-xs text-gray-500 dark:text-gray-400">
                Corner rounding scale for cards and containers (e.g. 1rem, 16px, 0px).
              </p>
            )}
          </FormGroup>
        </div>
      </div>

      {/* Print Styling Controls */}
      <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-zinc-700">
        <h3 className="text-md font-semibold text-gray-900 dark:text-zinc-100">
          Print Styling Controls
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">
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
    </div>
  );
}

