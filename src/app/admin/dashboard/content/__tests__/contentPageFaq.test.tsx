import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ToastProvider } from '@/components/ui/ToastProvider';

// Mock useRouter
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

const mockNodes = [
  {
    id: 'faq-1',
    type: 'FAQ',
    tags: ['Homepage'],
    data: {
      question: 'When is the wedding?',
      answer: 'June 20, 2026',
      category: 'Venue',
      keywords: 'date, time, venue',
    },
  },
];

const mockCreate = jest.fn();
const mockUpdate = jest.fn();

jest.mock('@/hooks/admin/useAdminContent', () => ({
  useAdminContent: () => ({
    data: mockNodes,
    isLoading: false,
    error: null,
    fetchAll: jest.fn(),
    create: mockCreate,
    update: mockUpdate,
    remove: jest.fn(),
  }),
}));

jest.mock('@/features/admin/apiClient', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

import ContentDashboardPage from '../page';

describe('Admin Content Management - FAQ Category & Keywords', () => {
  it('pre-populates category and keywords input fields when creating new FAQ content', () => {
    render(
      <ToastProvider>
        <ContentDashboardPage />
      </ToastProvider>
    );

    const addNewBtn = screen.getByRole('button', { name: /add new content/i });
    fireEvent.click(addNewBtn);

    const categoryInput = screen.getByLabelText(/faq category/i);
    const keywordsInput = screen.getByLabelText(/faq keywords/i);

    expect(categoryInput).toBeInTheDocument();
    expect(keywordsInput).toBeInTheDocument();

    fireEvent.change(categoryInput, { target: { value: 'Dress Code' } });
    fireEvent.change(keywordsInput, { target: { value: 'attire, formal' } });

    expect(categoryInput).toHaveValue('Dress Code');
    expect(keywordsInput).toHaveValue('attire, formal');
  });

  it('populates existing category and keywords values when editing an FAQ node', () => {
    render(
      <ToastProvider>
        <ContentDashboardPage />
      </ToastProvider>
    );

    const editBtn = screen.getByRole('button', { name: /edit content: faq/i });
    fireEvent.click(editBtn);

    const categoryInput = screen.getByLabelText(/faq category/i);
    const keywordsInput = screen.getByLabelText(/faq keywords/i);

    expect(categoryInput).toHaveValue('Venue');
    expect(keywordsInput).toHaveValue('date, time, venue');
  });
});
