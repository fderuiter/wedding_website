'use client';

import { useState } from 'react';
import { FormGroup, Label, Input, FormMessage } from '@/components/ui/forms';
import { THEME_PRESET_KEYS, ThemePreset, getPresetTokens } from '@/lib/theme/presets';

const layoutTokenRegex = /^\d+(\.\d+)?(px|rem|em|%|ch)$/;
const numberOrRatioRegex = /^\d+(\.\d+)?$/;
const borderStyleRegex = /^(solid|dashed|dotted|double|none|inherit|initial|unset)$/i;

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

  // Typography scale
  fontSizeSm?: string;
  fontSizeBase?: string;
  fontSizeLg?: string;
  fontWeightNormal?: string;
  fontWeightBold?: string;
  lineHeightNormal?: string;

  // Spacing scale
  spacingSm?: string;
  spacingMd?: string;
  spacingLg?: string;

  // Border treatments
  borderRadiusSm?: string;
  borderRadiusLg?: string;
  borderWidthThin?: string;
  borderWidthMedium?: string;
  borderStyleDefault?: string;

  // Brand asset dimensions
  brandLogoWidth?: string;
  brandLogoHeight?: string;
  brandHeroHeight?: string;
  brandWatermarkWidth?: string;
  brandWatermarkOpacity?: string;
  brandBadgeSize?: string;

  typographyScale?: Record<string, string>;
  spacingScale?: Record<string, string>;
  borderTreatment?: Record<string, string>;
  brandDimensions?: Record<string, string>;
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

  const activePresetTokens = getPresetTokens(selectedPreset, 'light');

  const printBg = values.printBg || values.themeTokens?.['--print-bg'] || activePresetTokens['--print-bg'] || '#ffffff';
  const printText = values.printText || values.themeTokens?.['--print-text'] || activePresetTokens['--print-text'] || '#111827';
  const printBorder = values.printBorder || values.themeTokens?.['--print-border'] || activePresetTokens['--print-border'] || '#e5e7eb';
  const printHeaderBorder = values.printHeaderBorder || values.themeTokens?.['--print-header-border'] || activePresetTokens['--print-header-border'] || '#111827';
  const printBadgeBg = values.printBadgeBg || values.themeTokens?.['--print-badge-bg'] || activePresetTokens['--print-badge-bg'] || '#f3f4f6';

  // Layout & Spacing
  const containerMaxWidth = values.layoutContainerMaxWidth ?? values.spacingScale?.containerMaxWidth ?? '64rem';
  const gridGap = values.layoutGridGap ?? values.spacingScale?.gridGap ?? '1.5rem';
  const cardPadding = values.layoutCardPadding ?? values.spacingScale?.cardPadding ?? '2rem';
  const spacingMd = values.spacingMd ?? values.spacingScale?.spacingMd ?? '1rem';

  // Border Treatments
  const borderRadius = values.layoutBorderRadius ?? values.borderTreatment?.borderRadiusMd ?? '1rem';
  const borderWidthThin = values.borderWidthThin ?? values.borderTreatment?.borderWidthThin ?? '1px';
  const borderStyleDefault = values.borderStyleDefault ?? values.borderTreatment?.borderStyleDefault ?? 'solid';

  // Typography Scales
  const fontSizeBase = values.fontSizeBase ?? values.typographyScale?.fontSizeBase ?? '1rem';
  const fontSizeLg = values.fontSizeLg ?? values.typographyScale?.fontSizeLg ?? '1.125rem';
  const fontWeightNormal = values.fontWeightNormal ?? values.typographyScale?.fontWeightNormal ?? '400';

  // Brand Dimensions
  const brandLogoWidth = values.brandLogoWidth ?? values.brandDimensions?.logoWidth ?? '120px';
  const brandLogoHeight = values.brandLogoHeight ?? values.brandDimensions?.logoHeight ?? '40px';
  const brandHeroHeight = values.brandHeroHeight ?? values.brandDimensions?.heroHeight ?? '400px';
  const brandWatermarkWidth = values.brandWatermarkWidth ?? values.brandDimensions?.watermarkWidth ?? '200px';
  const brandWatermarkOpacity = values.brandWatermarkOpacity ?? values.brandDimensions?.watermarkOpacity ?? '0.1';
  const brandBadgeSize = values.brandBadgeSize ?? values.brandDimensions?.badgeSize ?? '48px';

  const validateField = (fieldName: string, val: string, type: 'length' | 'numberOrRatio' | 'borderStyle' = 'length') => {
    const trimmed = val.trim();
    if (trimmed === '') {
      setLocalErrors((prev) => {
        const next = { ...prev };
        delete next[fieldName];
        return next;
      });
      return true;
    }

    let isValid = false;
    if (type === 'length') {
      isValid = layoutTokenRegex.test(trimmed);
    } else if (type === 'numberOrRatio') {
      isValid = numberOrRatioRegex.test(trimmed);
    } else if (type === 'borderStyle') {
      isValid = borderStyleRegex.test(trimmed);
    }

    if (!isValid) {
      setLocalErrors((prev) => ({
        ...prev,
        [fieldName]: type === 'length'
          ? 'Invalid CSS length unit format. Use values like 64rem, 20px, 1.5rem, or 100%.'
          : type === 'numberOrRatio'
            ? 'Invalid numeric format. Use values like 400, 1.5, or 0.1.'
            : 'Invalid border style. Use solid, dashed, dotted, double, or none.',
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

  const handleFieldChange = (fieldName: keyof ThemeConfigValues, val: string, type: 'length' | 'numberOrRatio' | 'borderStyle' = 'length') => {
    validateField(fieldName, val, type);
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

      {/* Typography Scale Controls */}
      <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-zinc-700">
        <h3 className="text-md font-semibold text-gray-900 dark:text-zinc-100">
          Typography Scales
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormGroup state={localErrors.fontSizeBase || externalErrors.fontSizeBase ? 'error' : 'default'}>
            <Label htmlFor="fontSizeBase">Base Font Size</Label>
            <Input
              id="fontSizeBase"
              name="fontSizeBase"
              type="text"
              value={fontSizeBase}
              onChange={(e) => handleFieldChange('fontSizeBase', e.target.value, 'length')}
              placeholder="e.g. 1rem, 16px"
            />
            {localErrors.fontSizeBase && (
              <FormMessage role="alert">{localErrors.fontSizeBase}</FormMessage>
            )}
          </FormGroup>

          <FormGroup state={localErrors.fontSizeLg || externalErrors.fontSizeLg ? 'error' : 'default'}>
            <Label htmlFor="fontSizeLg">Large Font Size</Label>
            <Input
              id="fontSizeLg"
              name="fontSizeLg"
              type="text"
              value={fontSizeLg}
              onChange={(e) => handleFieldChange('fontSizeLg', e.target.value, 'length')}
              placeholder="e.g. 1.125rem, 18px"
            />
            {localErrors.fontSizeLg && (
              <FormMessage role="alert">{localErrors.fontSizeLg}</FormMessage>
            )}
          </FormGroup>

          <FormGroup state={localErrors.fontWeightNormal || externalErrors.fontWeightNormal ? 'error' : 'default'}>
            <Label htmlFor="fontWeightNormal">Normal Font Weight</Label>
            <Input
              id="fontWeightNormal"
              name="fontWeightNormal"
              type="text"
              value={fontWeightNormal}
              onChange={(e) => handleFieldChange('fontWeightNormal', e.target.value, 'numberOrRatio')}
              placeholder="e.g. 400"
            />
            {localErrors.fontWeightNormal && (
              <FormMessage role="alert">{localErrors.fontWeightNormal}</FormMessage>
            )}
          </FormGroup>
        </div>
      </div>

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
              onChange={(e) => handleFieldChange('layoutContainerMaxWidth', e.target.value, 'length')}
              placeholder="e.g. 64rem, 1200px"
              aria-invalid={Boolean(localErrors.layoutContainerMaxWidth || externalErrors.layoutContainerMaxWidth)}
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

          <FormGroup state={localErrors.layoutGridGap || externalErrors.layoutGridGap ? 'error' : 'default'}>
            <Label htmlFor="layoutGridGap">Grid Gap</Label>
            <Input
              id="layoutGridGap"
              name="layoutGridGap"
              type="text"
              value={gridGap}
              onChange={(e) => handleFieldChange('layoutGridGap', e.target.value, 'length')}
              placeholder="e.g. 1.5rem, 24px"
              aria-invalid={Boolean(localErrors.layoutGridGap || externalErrors.layoutGridGap)}
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

          <FormGroup state={localErrors.layoutCardPadding || externalErrors.layoutCardPadding ? 'error' : 'default'}>
            <Label htmlFor="layoutCardPadding">Card Padding</Label>
            <Input
              id="layoutCardPadding"
              name="layoutCardPadding"
              type="text"
              value={cardPadding}
              onChange={(e) => handleFieldChange('layoutCardPadding', e.target.value, 'length')}
              placeholder="e.g. 2rem, 32px"
              aria-invalid={Boolean(localErrors.layoutCardPadding || externalErrors.layoutCardPadding)}
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

          <FormGroup state={localErrors.spacingMd || externalErrors.spacingMd ? 'error' : 'default'}>
            <Label htmlFor="spacingMd">Medium Spacing</Label>
            <Input
              id="spacingMd"
              name="spacingMd"
              type="text"
              value={spacingMd}
              onChange={(e) => handleFieldChange('spacingMd', e.target.value, 'length')}
              placeholder="e.g. 1rem, 16px"
            />
            {localErrors.spacingMd && (
              <FormMessage role="alert">{localErrors.spacingMd}</FormMessage>
            )}
          </FormGroup>
        </div>
      </div>

      {/* Border Treatments */}
      <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-zinc-700">
        <h3 className="text-md font-semibold text-gray-900 dark:text-zinc-100">
          Border Treatments
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormGroup state={localErrors.layoutBorderRadius || externalErrors.layoutBorderRadius ? 'error' : 'default'}>
            <Label htmlFor="layoutBorderRadius">Card Border Radius</Label>
            <Input
              id="layoutBorderRadius"
              name="layoutBorderRadius"
              type="text"
              value={borderRadius}
              onChange={(e) => handleFieldChange('layoutBorderRadius', e.target.value, 'length')}
              placeholder="e.g. 1rem, 16px, 0px"
              aria-invalid={Boolean(localErrors.layoutBorderRadius || externalErrors.layoutBorderRadius)}
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

          <FormGroup state={localErrors.borderWidthThin || externalErrors.borderWidthThin ? 'error' : 'default'}>
            <Label htmlFor="borderWidthThin">Thin Border Width</Label>
            <Input
              id="borderWidthThin"
              name="borderWidthThin"
              type="text"
              value={borderWidthThin}
              onChange={(e) => handleFieldChange('borderWidthThin', e.target.value, 'length')}
              placeholder="e.g. 1px"
            />
            {localErrors.borderWidthThin && (
              <FormMessage role="alert">{localErrors.borderWidthThin}</FormMessage>
            )}
          </FormGroup>

          <FormGroup state={localErrors.borderStyleDefault || externalErrors.borderStyleDefault ? 'error' : 'default'}>
            <Label htmlFor="borderStyleDefault">Border Style</Label>
            <Input
              id="borderStyleDefault"
              name="borderStyleDefault"
              type="text"
              value={borderStyleDefault}
              onChange={(e) => handleFieldChange('borderStyleDefault', e.target.value, 'borderStyle')}
              placeholder="e.g. solid, dashed"
            />
            {localErrors.borderStyleDefault && (
              <FormMessage role="alert">{localErrors.borderStyleDefault}</FormMessage>
            )}
          </FormGroup>
        </div>
      </div>

      {/* Brand Asset Dimensions */}
      <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-zinc-700">
        <h3 className="text-md font-semibold text-gray-900 dark:text-zinc-100">
          Brand Asset Dimensions
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormGroup state={localErrors.brandLogoWidth || externalErrors.brandLogoWidth ? 'error' : 'default'}>
            <Label htmlFor="brandLogoWidth">Logo Width</Label>
            <Input
              id="brandLogoWidth"
              name="brandLogoWidth"
              type="text"
              value={brandLogoWidth}
              onChange={(e) => handleFieldChange('brandLogoWidth', e.target.value, 'length')}
              placeholder="e.g. 120px"
            />
            {localErrors.brandLogoWidth && (
              <FormMessage role="alert">{localErrors.brandLogoWidth}</FormMessage>
            )}
          </FormGroup>

          <FormGroup state={localErrors.brandLogoHeight || externalErrors.brandLogoHeight ? 'error' : 'default'}>
            <Label htmlFor="brandLogoHeight">Logo Height</Label>
            <Input
              id="brandLogoHeight"
              name="brandLogoHeight"
              type="text"
              value={brandLogoHeight}
              onChange={(e) => handleFieldChange('brandLogoHeight', e.target.value, 'length')}
              placeholder="e.g. 40px"
            />
            {localErrors.brandLogoHeight && (
              <FormMessage role="alert">{localErrors.brandLogoHeight}</FormMessage>
            )}
          </FormGroup>

          <FormGroup state={localErrors.brandHeroHeight || externalErrors.brandHeroHeight ? 'error' : 'default'}>
            <Label htmlFor="brandHeroHeight">Hero Background Height</Label>
            <Input
              id="brandHeroHeight"
              name="brandHeroHeight"
              type="text"
              value={brandHeroHeight}
              onChange={(e) => handleFieldChange('brandHeroHeight', e.target.value, 'length')}
              placeholder="e.g. 400px"
            />
            {localErrors.brandHeroHeight && (
              <FormMessage role="alert">{localErrors.brandHeroHeight}</FormMessage>
            )}
          </FormGroup>

          <FormGroup state={localErrors.brandWatermarkWidth || externalErrors.brandWatermarkWidth ? 'error' : 'default'}>
            <Label htmlFor="brandWatermarkWidth">Watermark Width</Label>
            <Input
              id="brandWatermarkWidth"
              name="brandWatermarkWidth"
              type="text"
              value={brandWatermarkWidth}
              onChange={(e) => handleFieldChange('brandWatermarkWidth', e.target.value, 'length')}
              placeholder="e.g. 200px"
            />
            {localErrors.brandWatermarkWidth && (
              <FormMessage role="alert">{localErrors.brandWatermarkWidth}</FormMessage>
            )}
          </FormGroup>

          <FormGroup state={localErrors.brandWatermarkOpacity || externalErrors.brandWatermarkOpacity ? 'error' : 'default'}>
            <Label htmlFor="brandWatermarkOpacity">Watermark Opacity</Label>
            <Input
              id="brandWatermarkOpacity"
              name="brandWatermarkOpacity"
              type="text"
              value={brandWatermarkOpacity}
              onChange={(e) => handleFieldChange('brandWatermarkOpacity', e.target.value, 'numberOrRatio')}
              placeholder="e.g. 0.1"
            />
            {localErrors.brandWatermarkOpacity && (
              <FormMessage role="alert">{localErrors.brandWatermarkOpacity}</FormMessage>
            )}
          </FormGroup>

          <FormGroup state={localErrors.brandBadgeSize || externalErrors.brandBadgeSize ? 'error' : 'default'}>
            <Label htmlFor="brandBadgeSize">Badge Size</Label>
            <Input
              id="brandBadgeSize"
              name="brandBadgeSize"
              type="text"
              value={brandBadgeSize}
              onChange={(e) => handleFieldChange('brandBadgeSize', e.target.value, 'length')}
              placeholder="e.g. 48px"
            />
            {localErrors.brandBadgeSize && (
              <FormMessage role="alert">{localErrors.brandBadgeSize}</FormMessage>
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
