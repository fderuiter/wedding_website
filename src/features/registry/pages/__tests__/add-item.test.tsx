import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import AddRegistryItemPage from '../add-item';

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
}));

jest.mock('@/components/ui/ToastProvider', () => ({
  useToast: () => ({
    addToast: jest.fn(),
  }),
}));

jest.mock('@/hooks/admin/useAdminRegistry', () => ({
  useAdminRegistry: () => ({
    create: jest.fn(),
  }),
}));

describe('AddRegistryItemPage Tabbed Navigation', () => {
  it('renders all three tabs: Single Item, Batch URLs, and CSV Import', () => {
    render(<AddRegistryItemPage />);

    const singleTab = screen.getByRole('tab', { name: /Single Item/i });
    const batchTab = screen.getByRole('tab', { name: /Batch URLs/i });
    const csvTab = screen.getByRole('tab', { name: /CSV Import/i });

    expect(singleTab).toBeInTheDocument();
    expect(batchTab).toBeInTheDocument();
    expect(csvTab).toBeInTheDocument();

    // Single item is selected by default
    expect(singleTab).toHaveAttribute('aria-selected', 'true');
    expect(batchTab).toHaveAttribute('aria-selected', 'false');
    expect(csvTab).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByTestId('form')).toBeInTheDocument();
  });

  it('switches to Batch URLs tab when clicked', () => {
    render(<AddRegistryItemPage />);

    const batchTab = screen.getByRole('tab', { name: /Batch URLs/i });
    fireEvent.click(batchTab);

    expect(batchTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('batch-url-scraper')).toBeInTheDocument();
    expect(screen.queryByTestId('form')).not.toBeInTheDocument();
  });

  it('switches to CSV Import tab when clicked', () => {
    render(<AddRegistryItemPage />);

    const csvTab = screen.getByRole('tab', { name: /CSV Import/i });
    fireEvent.click(csvTab);

    expect(csvTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('csv-registry-import')).toBeInTheDocument();
    expect(screen.queryByTestId('form')).not.toBeInTheDocument();
  });

  it('supports arrow key keyboard navigation across tabs', () => {
    render(<AddRegistryItemPage />);

    const singleTab = screen.getByRole('tab', { name: /Single Item/i });
    fireEvent.keyDown(singleTab, { key: 'ArrowRight' });

    const batchTab = screen.getByRole('tab', { name: /Batch URLs/i });
    expect(batchTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('batch-url-scraper')).toBeInTheDocument();

    fireEvent.keyDown(batchTab, { key: 'ArrowRight' });
    const csvTab = screen.getByRole('tab', { name: /CSV Import/i });
    expect(csvTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('csv-registry-import')).toBeInTheDocument();

    fireEvent.keyDown(csvTab, { key: 'ArrowLeft' });
    expect(batchTab).toHaveAttribute('aria-selected', 'true');
  });
});
