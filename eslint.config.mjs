import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import stylistic from '@stylistic/eslint-plugin';
import tseslint from 'typescript-eslint';
import unusedImports from 'eslint-plugin-unused-imports';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import noRestrictedUtilityImports from './eslint-rules/no-restricted-utility-imports.mjs';
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

// Shrink-only legacy baseline (capped at <= 119 unique files across all legacy groups).
// Do not add new files here; remove entries as legacy modules are refactored.
const LEGACY_EXPLICIT_ANY_BASELINE_FILES = [
  'src/app/admin/dashboard/history/page.tsx',
  'src/app/admin/dashboard/invitation-codes/page.tsx',
  'src/app/admin/dashboard/media/page.tsx',
  'src/app/admin/dashboard/settings/page.tsx',
  'src/app/admin/dashboard/site-manager/components/DragDropContainer.tsx',
  'src/app/admin/dashboard/sub-events/page.tsx',
  'src/app/admin/dashboard/thank-you-notes/page.tsx',
  'src/app/admin/login/page.tsx',
  'src/app/api/admin/[entity]/[id]/route.ts',
  'src/app/api/admin/[entity]/batch/route.ts',
  'src/app/api/admin/[entity]/route.ts',
  'src/app/api/admin/broadcast/history/route.ts',
  'src/app/api/admin/broadcast/schedule/[id]/route.ts',
  'src/app/api/admin/invitation-codes/batch/route.ts',
  'src/app/api/admin/invitation-codes/export/route.ts',
  'src/app/api/admin/invitation-codes/validate/route.ts',
  'src/app/api/admin/photos/moderation/route.ts',
  'src/app/api/admin/seating/assign/route.ts',
  'src/app/api/admin/seating/export/route.ts',
  'src/app/api/admin/settings/route.ts',
  'src/app/api/admin/setup/route.ts',
  'src/app/api/admin/versions/[id]/restore/route.ts',
  'src/app/api/admin/versions/route.ts',
  'src/app/api/cron/broadcasts/route.ts',
  'src/app/api/guest/address/public/route.ts',
  'src/app/api/guest/photos/upload/route.ts',
  'src/app/api/media/export/route.ts',
  'src/app/api/og/route.tsx',
  'src/app/api/ready/route.ts',
  'src/app/guest/collect/page.tsx',
  'src/app/heart/HeartClient.tsx',
  'src/app/heart/hooks/useHeartPhysics.ts',
  'src/app/metadata.ts',
  'src/app/page.tsx',
  'src/components/Dropzone.tsx',
  'src/components/admin/AdminPreviewLayout.tsx',
  'src/components/admin/BroadcastModal.tsx',
  'src/components/admin/CsvImportWizardModal.tsx',
  'src/components/admin/InvitationQRPreviewModal.tsx',
  'src/components/admin/SampleDataBanner.tsx',
  'src/components/home/HomePageClient.tsx',
  'src/components/layout/RootLayoutClient.tsx',
  'src/components/schedule/InteractiveTimeline.stories.tsx',
  'src/components/schedule/InteractiveTimeline.tsx',
  'src/components/setup/SetupWizard.tsx',
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
  'src/features/registry/components/RegistryItemCard.tsx',
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
  'src/hooks/useUnified3DInput.ts',
  'src/lib/apiClient.ts',
  'src/lib/audit.ts',
  'src/lib/config.ts',
  'src/lib/logger.ts',
  'src/lib/stripe.ts',
  'src/lib/theme/presets.ts',
  'src/lib/transaction.ts',
  'src/mocks/handlers.ts',
  'src/testing/factories/mediaFactory.ts',
  'src/utils/ApiError.ts',
  'src/utils/backupValidation.ts',
  'src/utils/createValidatedRoute.ts',
  'src/utils/ssrf.ts',
  'src/utils/validation.ts',
  'src/utils/validationPrimitives.ts',
  'src/utils/withApiMiddleware.ts',
];

const LEGACY_NO_IMG_ELEMENT_BASELINE_FILES = [
  'src/app/admin/dashboard/settings/page.tsx',
  'src/components/MediaImage.tsx',
  'src/components/layout/Navbar.tsx',
];

const LEGACY_LOCATION_ASSIGN_BASELINE_FILES = [
  'src/components/admin/BroadcastModal.tsx',
  'src/components/setup/SetupWizard.tsx',
  'src/features/admin/apiClient.ts',
];

const LEGACY_UNESCAPED_ENTITIES_BASELINE_FILES = [
  'src/app/admin/dashboard/sub-events/page.tsx',
  'src/app/not-found.tsx',
];

const LEGACY_EXHAUSTIVE_DEPS_BASELINE_FILES = [
  'src/components/admin/CsvImportWizardModal.tsx',
  'src/features/registry/components/RegistryItemCard.tsx',
  'src/hooks/useUnified3DInput.ts',
];

const LEGACY_JSX_A11Y_BASELINE_FILES = [
  'src/components/ui/__tests__/Overlay.test.tsx',
];

const eslintConfig = [
  {
    ignores: [
      'docs-portal/**',
      'storybook-static/**',
      'public/mockServiceWorker.js',
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'dist/**',
      'test-results/**',
    ],
  },
  ...scopeNextCoreWebVitals(ensureFlatConfig(nextCoreWebVitals)),
  ...ensureFlatConfig(nextTypescript),
  {
    files: REACT_FILES,
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    rules: {
      'react/no-unescaped-entities': 'warn',
    },
  },
  {
    plugins: {
      '@stylistic': stylistic,
      'unused-imports': unusedImports,
      'local-rules': {
        rules: {
          'no-restricted-utility-imports': noRestrictedUtilityImports,
        },
      },
    },
    rules: {
      'local-rules/no-restricted-utility-imports': 'error',
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
      '@stylistic/indent': ['error', 2],
      '@stylistic/semi': ['error', 'always'],

      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features/*/*'],
              message: 'Features should only be imported via their public index.ts exported interfaces to prevent cross-domain leakage.',
            },
          ],
        },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'error',
      'prefer-const': 'warn',

      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
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
    files: ['src/**/*.{ts,tsx,mts,cts}'],
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
      '.storybook/main.ts',
      '.storybook/**/*.{ts,tsx,js,jsx}',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: LEGACY_EXPLICIT_ANY_BASELINE_FILES.map(escapeGlobPath),
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: LEGACY_NO_IMG_ELEMENT_BASELINE_FILES.map(escapeGlobPath),
    rules: {
      '@next/next/no-img-element': 'off',
    },
  },
  {
    files: LEGACY_LOCATION_ASSIGN_BASELINE_FILES.map(escapeGlobPath),
    rules: {
      '@next/next/no-location-assign-relative-destination': 'off',
    },
  },
  {
    files: LEGACY_UNESCAPED_ENTITIES_BASELINE_FILES.map(escapeGlobPath),
    rules: {
      'react/no-unescaped-entities': 'off',
    },
  },
  {
    files: LEGACY_EXHAUSTIVE_DEPS_BASELINE_FILES.map(escapeGlobPath),
    rules: {
      'react-hooks/exhaustive-deps': 'off',
    },
  },
  {
    files: LEGACY_JSX_A11Y_BASELINE_FILES.map(escapeGlobPath),
    rules: {
      'jsx-a11y/role-supports-aria-props': 'off',
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
