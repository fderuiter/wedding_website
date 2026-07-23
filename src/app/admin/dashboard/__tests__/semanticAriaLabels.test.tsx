import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ToastProvider } from '@/components/ui/ToastProvider';

// Mock useRouter
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

// Mock useAdminAttractions
const mockAttractions = [
  { id: 'att-1', name: 'Golden Gate Bridge', category: 'sightseeing', isVisible: true },
  { id: 'att-2', name: '', category: 'food', isVisible: true } // unnamed
];
jest.mock('@/hooks/admin/useAdminAttractions', () => ({
  useAdminAttractions: () => ({
    data: mockAttractions,
    isLoading: false,
    error: null,
    fetchAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  }),
}));

// Mock useAdminWeddingParty
const mockMembers = [
  { id: 'wp-1', name: 'Jane Doe', role: 'Maid of Honor' },
  { id: 'wp-2', name: '' } // unnamed
];
jest.mock('@/hooks/admin/useAdminWeddingParty', () => ({
  useAdminWeddingParty: () => ({
    data: mockMembers,
    isLoading: false,
    error: null,
    fetchAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  }),
}));

// Mock useAdminContent
const mockNodes = [
  { id: 'content-1', type: 'FAQ', tags: ['Homepage'], data: { question: 'When?', answer: 'Soon' } },
  { id: 'content-2', type: '', tags: [], data: {} } // unnamed
];
jest.mock('@/hooks/admin/useAdminContent', () => ({
  useAdminContent: () => ({
    data: mockNodes,
    isLoading: false,
    error: null,
    fetchAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  }),
}));

// Mock apiClients
jest.mock('@/lib/apiClient', () => ({
  apiClient: {
    get: jest.fn().mockResolvedValue([
      { id: 'media-1', url: 'https://example.com/1.png', altText: 'Wedding Ring', isDecorative: false },
      { id: 'media-2', url: 'https://example.com/2.png', altText: '', isDecorative: true } // unnamed / decorative
    ]),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  }
}));

jest.mock('@/features/admin/apiClient', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  }
}));

import AttractionsDashboardPage from '../attractions/page';
import WeddingPartyDashboardPage from '../wedding-party/page';
import MediaDashboardPage from '../media/page';
import ContentDashboardPage from '../content/page';

describe('Semantic Dynamic Property ARIA Labels tests', () => {
  it('renders correct ARIA labels with entity names and graceful fallbacks for attractions', () => {
    render(
      <ToastProvider>
        <AttractionsDashboardPage />
      </ToastProvider>
    );

    // Edit button with name
    const editBtnWithVal = screen.getByRole('button', { name: 'Edit attraction: Golden Gate Bridge' });
    expect(editBtnWithVal).toBeInTheDocument();

    // Delete button with name
    const deleteBtnWithVal = screen.getByRole('button', { name: 'Delete attraction: Golden Gate Bridge' });
    expect(deleteBtnWithVal).toBeInTheDocument();

    // Edit button with empty name
    const editBtnEmpty = screen.getByRole('button', { name: 'Edit unnamed item' });
    expect(editBtnEmpty).toBeInTheDocument();

    // Delete button with empty name
    const deleteBtnEmpty = screen.getByRole('button', { name: 'Delete unnamed item' });
    expect(deleteBtnEmpty).toBeInTheDocument();
  });

  it('renders correct ARIA labels with entity names and graceful fallbacks for wedding party members', () => {
    render(
      <ToastProvider>
        <WeddingPartyDashboardPage />
      </ToastProvider>
    );

    // Edit button with name
    const editBtnWithVal = screen.getByRole('button', { name: 'Edit wedding party member: Jane Doe' });
    expect(editBtnWithVal).toBeInTheDocument();

    // Delete button with name
    const deleteBtnWithVal = screen.getByRole('button', { name: 'Delete wedding party member: Jane Doe' });
    expect(deleteBtnWithVal).toBeInTheDocument();

    // Edit button with empty name
    const editBtnEmpty = screen.getByRole('button', { name: 'Edit unnamed item' });
    expect(editBtnEmpty).toBeInTheDocument();

    // Delete button with empty name
    const deleteBtnEmpty = screen.getByRole('button', { name: 'Delete unnamed item' });
    expect(deleteBtnEmpty).toBeInTheDocument();
  });

  it('renders correct ARIA labels with entity names and graceful fallbacks for media library', async () => {
    render(
      <ToastProvider>
        <MediaDashboardPage />
      </ToastProvider>
    );

    // Wait for media to load
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Edit media: Wedding Ring' })).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Delete media: Wedding Ring' })).toBeInTheDocument();

    // Unnamed media fallback
    expect(screen.getByRole('button', { name: 'Edit unnamed item' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete unnamed item' })).toBeInTheDocument();
  });

  it('renders content list edit/delete ARIA labels, key-value dynamic field deletion labels, and real-time typed updates', async () => {
    render(
      <ToastProvider>
        <ContentDashboardPage />
      </ToastProvider>
    );

    // List edit and delete buttons
    expect(screen.getByRole('button', { name: 'Edit content: FAQ' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete content: FAQ' })).toBeInTheDocument();

    // Unnamed content fallback
    expect(screen.getByRole('button', { name: 'Edit unnamed item' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete unnamed item' })).toBeInTheDocument();

    // Click 'Edit content: FAQ' to open the editing container containing dynamic data fields
    fireEvent.click(screen.getByRole('button', { name: 'Edit content: FAQ' }));

    // The fields 'question' and 'answer' are mapped in setDynamicData
    // Let's verify their 'X' deletion buttons have the proper ARIA label with key name
    expect(screen.getByRole('button', { name: 'Delete dynamic field: question' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete dynamic field: answer' })).toBeInTheDocument();

    // Let's find the input with value 'question' and change its value to 'who'
    // To verify real-time update
    const keyInputs = screen.getAllByPlaceholderText('Key');
    expect(keyInputs[0]).toHaveValue('question');

    fireEvent.change(keyInputs[0], { target: { value: 'who' } });

    // The deletion button's label should immediately update to 'Delete dynamic field: who'
    expect(screen.queryByRole('button', { name: 'Delete dynamic field: question' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete dynamic field: who' })).toBeInTheDocument();

    // Now clear the input completely
    fireEvent.change(keyInputs[0], { target: { value: '' } });

    // It should fallback to 'Delete dynamic field'
    expect(screen.getByRole('button', { name: 'Delete dynamic field' })).toBeInTheDocument();
  });
});
