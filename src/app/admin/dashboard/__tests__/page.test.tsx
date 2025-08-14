import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AdminDashboardPage from '../page';
import type { RegistryItem } from '@/types/registry';

// Mock next/navigation's useRouter
const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
    push: mockPush,
  }),
}));

// Sample registry item for fetch mock
const mockItem: RegistryItem = {
  id: '1',
  name: 'Sample Item',
  description: 'desc',
  category: 'Home',
  price: 100,
  image: '/img.jpg',
  vendorUrl: null,
  quantity: 1,
  isGroupGift: false,
  purchased: false,
  amountContributed: 0,
  contributors: [],
};

// Mock fetch to return admin status and items based on localStorage
const mockFetch = jest.fn();

beforeEach(() => {
  mockFetch.mockImplementation((url: string) => {
    const isAdmin = localStorage.getItem('isAdminLoggedIn') === 'true';
    if (url === '/api/admin/me') {
      return Promise.resolve({
        ok: true,
        json: async () => ({ isAdmin }),
      });
    }
    if (url === '/api/registry/items') {
      return Promise.resolve({
        ok: true,
        json: async () => [mockItem],
      });
    }
    return Promise.reject(new Error(`Unhandled request: ${url}`));
  });
  (global.fetch as unknown) = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
  mockFetch.mockReset();
  mockReplace.mockReset();
  mockPush.mockReset();
  localStorage.clear();
});

describe('AdminDashboardPage', () => {
  it('shows admin controls for logged-in admin and hides them for non-admins', async () => {
    // Admin view
    localStorage.setItem('isAdminLoggedIn', 'true');
    const { unmount } = render(<AdminDashboardPage />);

    // Wait for admin controls
    expect(await screen.findByRole('button', { name: 'Add New Item' })).toBeInTheDocument();
    expect((await screen.findAllByRole('button', { name: 'Edit' })).length).toBeGreaterThan(0);
    expect((await screen.findAllByRole('button', { name: 'Delete' })).length).toBeGreaterThan(0);

    // Non-admin view
    unmount();
    localStorage.clear();
    render(<AdminDashboardPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/admin/login');
    });

    expect(screen.queryByRole('button', { name: 'Add New Item' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });
});

