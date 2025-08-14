import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock the router to prevent actual navigation
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

// Mock admin auth to always resolve as true
jest.mock('@/utils/adminAuth.client', () => ({
  checkAdminClient: jest.fn().mockResolvedValue(true),
}));

// Mock RegistryItemForm to confirm it mounts
jest.mock('@/components/RegistryItemForm', () => {
  function RegistryItemForm() {
    return <div data-testid="registry-item-form" />;
  }
  return RegistryItemForm;
});

import AddRegistryItemPage from '../page';

describe('AddRegistryItemPage', () => {
  it('renders the RegistryItemForm', async () => {
    render(<AddRegistryItemPage />);
    expect(await screen.findByTestId('registry-item-form')).toBeInTheDocument();
  });
});

