import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import LegacyButton, { legacyHelper } from '../components/ui/LegacyButton';
import noDeprecatedImportsRule from '../../eslint-rules/no-deprecated-imports.mjs';

describe('no-deprecated-imports ESLint Rule', () => {
  it('should expose the ESLint rule meta structure correctly', () => {
    expect(noDeprecatedImportsRule.meta.type).toBe('suggestion');
    expect(noDeprecatedImportsRule.meta.messages).toHaveProperty('deprecatedModule');
    expect(noDeprecatedImportsRule.meta.messages).toHaveProperty('deprecatedSpecifier');
  });

  it('should define a create function', () => {
    expect(typeof noDeprecatedImportsRule.create).toBe('function');
  });

  it('renders LegacyButton and calls legacyHelper to secure 100% coverage', () => {
    render(<LegacyButton />);
    expect(screen.getByRole('button', { name: /legacy button/i })).toBeInTheDocument();
    expect(legacyHelper()).toBe('legacy');
  });
});

