import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ThankYouNotesPage from '../page';
import { ToastProvider } from '@/components/ui/ToastProvider';

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
}));

const mockData = {
  success: true,
  items: [
    {
      id: 'c1',
      name: 'Alice Johnson',
      email: 'alice@example.com',
      amount: 150,
      date: new Date().toISOString(),
      thankYouStatus: 'Unsent',
      thankYouSentAt: null,
      thankYouNote: 'Initial draft note',
      registryItem: {
        id: 'r1',
        name: 'Espresso Machine',
        category: 'Kitchen',
      },
    },
    {
      id: 'c2',
      name: 'Bob Smith',
      email: 'bob@example.com',
      amount: 75,
      date: new Date().toISOString(),
      thankYouStatus: 'Sent',
      thankYouSentAt: new Date().toISOString(),
      thankYouNote: 'Sent physical card',
      registryItem: {
        id: 'r2',
        name: 'Cookware Set',
        category: 'Kitchen',
      },
    },
  ],
  metrics: {
    total: 2,
    sent: 1,
    unsent: 1,
    notNeeded: 0,
    thanked: 1,
    completionPercentage: 50,
  },
};

describe('ThankYouNotesPage', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('/api/admin/thank-you-notes')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockData),
        });
      }
      return Promise.reject(new Error('Unknown endpoint'));
    }) as any;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders title, progress summary metrics, and contributor list', async () => {
    render(
      <ToastProvider>
        <ThankYouNotesPage />
      </ToastProvider>
    );

    expect(screen.getByText('Thank-You Note Manager')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Alice Johnson')).toBeInTheDocument();
      expect(screen.getByText('Bob Smith')).toBeInTheDocument();
      expect(screen.getByText('Espresso Machine')).toBeInTheDocument();
      expect(screen.getByText('50%')).toBeInTheDocument();
    });
  });

  it('allows filtering by status and searching', async () => {
    render(
      <ToastProvider>
        <ThankYouNotesPage />
      </ToastProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Alice Johnson')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Search contributor name or gift item...');
    fireEvent.change(searchInput, { target: { value: 'Alice' } });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('search=Alice')
      );
    });

    const unsentFilterBtn = screen.getByRole('button', { name: 'Unsent' });
    fireEvent.click(unsentFilterBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('status=Unsent')
      );
    });
  });

  it('supports selecting items for batch update', async () => {
    render(
      <ToastProvider>
        <ThankYouNotesPage />
      </ToastProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Alice Johnson')).toBeInTheDocument();
    });

    const checkbox = screen.getByLabelText('Select contributor Alice Johnson');
    fireEvent.click(checkbox);

    expect(screen.getByText('1 contributor record(s) selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark Selected as Sent' })).toBeInTheDocument();
  });
});
