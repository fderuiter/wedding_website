import React from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom';
import { ToastProvider } from "@/components/ui/ToastProvider";
import AddRegistryItemPage from '../add-item';

// Mock the router to prevent actual navigation
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

// Mock admin auth to always resolve as true
jest.mock('@/utils/adminAuth.client', () => ({
  checkAdminClient: jest.fn().mockResolvedValue(true),
}));

// Mock RegistryItemForm to confirm it mounts
jest.mock('../../components/RegistryItemForm', () => {
  function RegistryItemForm() {
    return <div data-testid="registry-item-form" />;
  }
  return RegistryItemForm;
});

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

describe('AddRegistryItemPage', () => {
  it('renders the RegistryItemForm', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AddRegistryItemPage />
        </ToastProvider>
      </QueryClientProvider>
    );
    expect(await screen.findByTestId('registry-item-form')).toBeInTheDocument();
  });
});
