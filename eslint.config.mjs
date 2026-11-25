import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import stylistic from '@stylistic/eslint-plugin';
import tseslint from 'typescript-eslint';
import unusedImports from 'eslint-plugin-unused-imports';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import noRestrictedUtilityImports from './eslint-rules/no-restricted-utility-imports.mjs';
import noUncalibratedContrastUtilities from './eslint-rules/no-uncalibrated-contrast-utilities.mjs';
import { FlatCompat } from '@eslint/eslintrc';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const ensureFlatConfig = (config) => {
  if (Array.isArray(config)) {
    return config;
  }
  return compat.config(config);
};

const coreWebVitalsConfigs = ensureFlatConfig(nextCoreWebVitals);
const jsxA11yPlugin = coreWebVitalsConfigs.find(
  (cfg) => cfg.plugins?.['jsx-a11y']
)?.plugins?.['jsx-a11y'];

const GITHOOK_FILES = ['.githooks/[!.]*'];

const REACT_FILES = [
  '**/*.{tsx,jsx}',
  'src/**/hooks/**/*.{ts,js}',
  'src/**/use*.{ts,js}',
];

const REACT_PLUGIN_KEYS = new Set(['react', 'react-hooks', 'jsx-a11y']);

const isReactScopedRule = (ruleId) =>
  ruleId.startsWith('react/') ||
  ruleId.startsWith('react-hooks/') ||
  ruleId.startsWith('jsx-a11y/');

const scopeNextCoreWebVitals = (configs) =>
  configs.flatMap((config) => {
    const pluginEntries = config.plugins ? Object.entries(config.plugins) : [];
    const ruleEntries = config.rules ? Object.entries(config.rules) : [];

    const reactPlugins = Object.fromEntries(
      pluginEntries.filter(([key]) => REACT_PLUGIN_KEYS.has(key))
    );
    const basePlugins = Object.fromEntries(
      pluginEntries.filter(([key]) => !REACT_PLUGIN_KEYS.has(key))
    );

    const reactRules = Object.fromEntries(
      ruleEntries.filter(([key]) => isReactScopedRule(key))
    );
    const baseRules = Object.fromEntries(
      ruleEntries.filter(([key]) => !isReactScopedRule(key))
    );

    const hasReactPart =
      Object.keys(reactPlugins).length > 0 || Object.keys(reactRules).length > 0;
    if (!hasReactPart) {
      return [config];
    }

    const { react: reactSettings, ...otherSettings } = config.settings ?? {};
    const baseConfig = { ...config };
    if (Array.isArray(baseConfig.files)) {
      baseConfig.files = [...baseConfig.files, ...GITHOOK_FILES];
    }
    if (Object.keys(basePlugins).length > 0) {
      baseConfig.plugins = basePlugins;
    } else {
      delete baseConfig.plugins;
    }
    if (Object.keys(baseRules).length > 0) {
      baseConfig.rules = baseRules;
    } else {
      delete baseConfig.rules;
    }
    if (Object.keys(otherSettings).length > 0) {
      baseConfig.settings = otherSettings;
    } else {
      delete baseConfig.settings;
    }

    const reactScopedConfig = {
      ...(config.name ? { name: `${config.name}/react-scoped` } : {}),
      files: REACT_FILES,
      ...(Object.keys(reactPlugins).length > 0 ? { plugins: reactPlugins } : {}),
      ...(reactSettings !== undefined ? { settings: { react: reactSettings } } : {}),
      ...(Object.keys(reactRules).length > 0 ? { rules: reactRules } : {}),
    };

    return [baseConfig, reactScopedConfig];
  });

const escapeGlobPath = (filePath) => filePath.replace(/([[\]])/g, '\\$1');

// Shrink-only legacy baseline (capped at <= 98 unique files across all legacy groups).
// Do not add new files here; remove entries as legacy modules are refactored.
const LEGACY_EXPLICIT_ANY_BASELINE_FILES = [
  'src/app/admin/dashboard/history/HistoryTimelineClient.tsx',
  'src/app/admin/dashboard/invitation-codes/InvitationCodesClient.tsx',
  'src/app/admin/dashboard/media/MediaDashboardClient.tsx',
  'src/app/admin/dashboard/site-manager/components/DragDropContainer.tsx',
  'src/app/admin/dashboard/thank-you-notes/ThankYouNotesClient.tsx',
  'src/app/admin/login/AdminLoginClient.tsx',
  'src/app/api/admin/[entity]/[id]/route.ts',
  'src/app/api/admin/[entity]/batch/route.ts',
  'src/app/api/admin/[entity]/route.ts',
  'src/app/api/admin/broadcast/schedule/[id]/route.ts',
  'src/app/api/admin/invitation-codes/batch/route.ts',
  'src/app/api/admin/invitation-codes/export/route.ts',
  'src/app/api/admin/invitation-codes/validate/route.ts',
  'src/app/api/admin/photos/moderation/route.ts',
  'src/app/api/admin/seating/assign/route.ts',
  'src/app/api/admin/settings/route.ts',
  'src/app/api/admin/versions/route.ts',
  'src/app/api/cron/broadcasts/route.ts',
  'src/app/api/guest/address/public/route.ts',
  'src/app/api/guest/photos/upload/route.ts',
  'src/app/api/media/export/route.ts',
  'src/app/api/og/route.tsx',
  'src/app/guest/collect/GuestAddressCollectClient.tsx',
  'src/app/heart/HeartClient.tsx',
  'src/app/heart/hooks/useHeartPhysics.ts',
  'src/app/metadata.ts',
  'src/app/page.tsx',
  'src/components/Dropzone.tsx',
  'src/components/admin/AdminPreviewLayout.tsx',
  'src/components/admin/InvitationQRPreviewModal.tsx',
  'src/components/admin/SampleDataBanner.tsx',
  'src/components/home/HomePageClient.tsx',
  'src/components/layout/RootLayoutClient.tsx',
  'src/components/schedule/InteractiveTimeline.stories.tsx',
  'src/components/schedule/InteractiveTimeline.tsx',
  'src/components/ui/Interactive3DCard.tsx',
  'src/core/infrastructure/repository.ts',
  'src/core/infrastructure/service.ts',
  'src/features/admin/registry.ts',
  'src/features/admin/utils.ts',
  'src/features/attractions/admin.service.ts',
  'src/features/attractions/repository.ts',
  'src/features/broadcast/audience.ts',
  'src/features/broadcast/providers/index.ts',
  'src/features/broadcast/service.ts',
  'src/features/broadcast/types.ts',
  'src/features/content/admin.service.ts',
  'src/features/content/repository.ts',
  'src/features/content/service.ts',
  'src/features/content/types.ts',
  'src/features/logistics/repository.ts',
  'src/features/media/repository.ts',
  'src/features/registry/admin.service.ts',
  'src/features/registry/api/batch-scrape.ts',
  'src/features/registry/api/contribute.ts',
  'src/features/registry/api/get-items.ts',
  'src/features/registry/api/item-by-id.ts',
  'src/features/registry/api/payment-intent.ts',
  'src/features/registry/api/scrape.ts',
  'src/features/registry/api/webhook.ts',
  'src/features/registry/components/BatchUrlScraper.tsx',
  'src/features/registry/components/CsvRegistryImport.tsx',
  'src/features/registry/components/RegistryItemForm.tsx',
  'src/features/registry/components/RegistryPreviewTable.tsx',
  'src/features/registry/lib/masking.ts',
  'src/features/registry/notifications.ts',
  'src/features/registry/repository.ts',
  'src/features/registry/schemas.ts',
  'src/features/registry/thank-you.service.ts',
  'src/features/registry/utils/invitation.ts',
  'src/features/seating/admin.service.ts',
  'src/features/seating/components/FloorplanCanvas.stories.tsx',
  'src/features/seating/components/UnassignedGuestPanel.tsx',
  'src/features/seating/hooks/useSeatingState.ts',
  'src/features/sub-events/service.ts',
  'src/features/wedding-party/admin.service.ts',
  'src/features/wedding-party/repository.ts',
  'src/hooks/admin/useAdminFeatures.ts',
  'src/hooks/admin/useAdminMaintenance.ts',
  'src/hooks/admin/useAdminRegistry.ts',
  'src/hooks/admin/useAdminSettings.ts',
  'src/hooks/use3DInteraction.tsx',
  'src/hooks/useScheduleRsvpManager.ts',
  'src/lib/apiClient.ts',
  'src/lib/audit.ts',
  'src/lib/config.ts',
  'src/lib/logger.ts',
  'src/lib/stripe.ts',
  'src/lib/theme/presets.ts',
  'src/lib/transaction.ts',
  'src/testing/factories/mediaFactory.ts',
  'src/utils/ApiError.ts',
  'src/utils/backupValidation.ts',
  'src/utils/createValidatedRoute.ts',
  'src/utils/ssrf.ts',
  'src/utils/validation.ts',
  'src/utils/validationPrimitives.ts',
  'src/utils/withApiMiddleware.ts',
];

const eslintConfig = [
  {
    ignores: [
      'docs-portal/.vitepress/dist/**',
      'docs-portal/.vitepress/cache/**',
      'docs-portal/.vitepress/.temp/**',
      '.githooks/*.md',
      'storybook-static/**',
      'public/mockServiceWorker.js',
      '.next/**',
      '.next-export/**',
      'out/**',
      '.api-backup-export/**',
      'node_modules/**',
      'docker/prisma-cli/**',
      'coverage/**',
      'dist/**',
      'test-results/**',
    ],
  },
  ...scopeNextCoreWebVitals(coreWebVitalsConfigs),
  ...ensureFlatConfig(nextTypescript),
  {
    files: REACT_FILES,
    plugins: {
      react,
      'react-hooks': reactHooks,
      ...(jsxA11yPlugin ? { 'jsx-a11y': jsxA11yPlugin } : {}),
    },
    rules: {
      'react/no-unescaped-entities': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'jsx-a11y/role-supports-aria-props': 'error',
    },
  },
  {
    plugins: {
      '@stylistic': stylistic,
      'unused-imports': unusedImports,
      'local-rules': {
        rules: {
          'no-restricted-utility-imports': noRestrictedUtilityImports,
          'no-uncalibrated-contrast-utilities': noUncalibratedContrastUtilities,
        },
      },
    },
    rules: {
      'local-rules/no-restricted-utility-imports': 'error',
      'local-rules/no-uncalibrated-contrast-utilities': 'error',
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
      '@stylistic/indent': ['error', 2],
      '@stylistic/semi': ['error', 'always'],

      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/features/*/*',
                '../features/*/*',
                '../../features/*/*',
                '../../../features/*/*',
                '../../../../features/*/*',
                '../../../../../features/*/*',
              ],
              message: 'Features should only be imported via their public index.ts exported interfaces to prevent cross-domain leakage.',
            },
          ],
        },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'error',
      'prefer-const': 'error',
      '@next/next/no-location-assign-relative-destination': 'error',
      '@next/next/no-img-element': 'error',

      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'error',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
          caughtErrors: 'none',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    files: ['src/**/*.{ts,tsx,mts,cts}', 'docs-portal/**/*.{ts,tsx,mts,cts}'],
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: [
      'src/**/__tests__/**/*.{ts,tsx,js,jsx}',
      'src/__tests__/**/*.{ts,tsx,js,jsx}',
      '**/*.{test,spec}.{ts,tsx,js,jsx,mjs,cjs}',
      'e2e/**/*.{ts,tsx,js,jsx}',
      'scripts/**/*.{ts,tsx,js,jsx,mjs,cjs}',
      ...GITHOOK_FILES,
      '.storybook/main.ts',
      '.storybook/**/*.{ts,tsx,js,jsx}',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'local-rules/no-uncalibrated-contrast-utilities': 'off',
    },
  },
  {
    files: LEGACY_EXPLICIT_ANY_BASELINE_FILES.map(escapeGlobPath),
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];

export default eslintConfig;
