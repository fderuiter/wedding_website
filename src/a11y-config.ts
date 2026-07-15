export const a11yConfig = {
  rules: {
    // All legacy violations must now be resolved
    'color-contrast': { enabled: true },
    'landmark-main-is-top-level': { enabled: true },
    'landmark-no-duplicate-main': { enabled: true },
    'landmark-unique': { enabled: true },
  },
  runOnly: {
    type: 'tag',
    values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']
  }
};
