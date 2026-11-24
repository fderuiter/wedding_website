export const a11yConfig = {
  rules: {
    // All legacy violations must now be resolved
    'color-contrast': { enabled: true },
    'landmark-main-is-top-level': { enabled: true },
    'landmark-no-duplicate-main': { enabled: true },
    'landmark-unique': { enabled: true },
    'target-size': { enabled: true },
  },
  runOnly: {
    type: 'tag' as const,
    values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']
  }
};
