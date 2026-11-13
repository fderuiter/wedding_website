import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import ThankYouNotesPage from '../page';
import { ToastProvider } from '@/components/ui/ToastProvider';
import { substituteThankYouTemplateTokens } from '@/features/registry';

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

    const tablist = screen.getByRole('tablist', { name: 'Filter contributors by thank-you status' });
    expect(tablist).toBeInTheDocument();

    const allTab = screen.getByRole('tab', { name: 'All' });
    const unsentTab = screen.getByRole('tab', { name: 'Unsent' });
    const sentTab = screen.getByRole('tab', { name: 'Sent' });
    const notNeededTab = screen.getByRole('tab', { name: 'Not Needed' });

    expect(allTab).toHaveAttribute('aria-selected', 'true');
    expect(unsentTab).toHaveAttribute('aria-selected', 'false');
    expect(sentTab).toHaveAttribute('aria-selected', 'false');
    expect(notNeededTab).toHaveAttribute('aria-selected', 'false');

    const searchInput = screen.getByPlaceholderText('Search contributor name or gift item...');
    fireEvent.change(searchInput, { target: { value: 'Alice' } });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('search=Alice')
      );
    });

    fireEvent.click(unsentTab);

    expect(allTab).toHaveAttribute('aria-selected', 'false');
    expect(unsentTab).toHaveAttribute('aria-selected', 'true');

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

  it('triggers download link when Export CSV button is clicked with active filter options', async () => {
    render(
      <ToastProvider>
        <ThankYouNotesPage />
      </ToastProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Alice Johnson')).toBeInTheDocument();
    });

    const exportBtn = screen.getByRole('button', { name: 'Export CSV' });
    expect(exportBtn).toBeInTheDocument();

    const appendChildSpy = jest.spyOn(document.body, 'appendChild');
    const removeChildSpy = jest.spyOn(document.body, 'removeChild');

    fireEvent.click(exportBtn);

    expect(appendChildSpy).toHaveBeenCalled();
    expect(removeChildSpy).toHaveBeenCalled();

    appendChildSpy.mockRestore();
    removeChildSpy.mockRestore();
  });

  it('triggers download link when Export Address Labels dropdown options are clicked', async () => {
    render(
      <ToastProvider>
        <ThankYouNotesPage />
      </ToastProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Alice Johnson')).toBeInTheDocument();
    });

    const exportDropdownBtn = screen.getByRole('button', { name: /Export Address Labels/i });
    expect(exportDropdownBtn).toBeInTheDocument();

    fireEvent.click(exportDropdownBtn);

    const avery5160Option = screen.getByText('Avery 5160 PDF');
    expect(avery5160Option).toBeInTheDocument();

    const appendChildSpy = jest.spyOn(document.body, 'appendChild');
    const removeChildSpy = jest.spyOn(document.body, 'removeChild');

    fireEvent.click(avery5160Option);

    expect(appendChildSpy).toHaveBeenCalled();
    expect(removeChildSpy).toHaveBeenCalled();

    appendChildSpy.mockRestore();
    removeChildSpy.mockRestore();
  });

  it('renders pagination controls and triggers page navigation when clicked', async () => {
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/api/admin/thank-you-notes')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              ...mockData,
              pagination: {
                page: 1,
                pageSize: 1,
                totalItems: 2,
                totalPages: 2,
              },
            }),
        });
      }
      return Promise.reject(new Error('Unknown endpoint'));
    });

    render(
      <ToastProvider>
        <ThankYouNotesPage />
      </ToastProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    });

    const nextBtn = screen.getByRole('button', { name: 'Next page' });
    expect(nextBtn).toBeEnabled();

    fireEvent.click(nextBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('page=2')
      );
    });
  });

  it('renders template dropdown and replaces tokens with contributor details', async () => {
    render(
      <ToastProvider>
        <ThankYouNotesPage />
      </ToastProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Alice Johnson')).toBeInTheDocument();
    });

    const editBtn = screen.getByRole('button', { name: 'Edit thank-you note for Alice Johnson' });
    fireEvent.click(editBtn);

    const templateSelect = screen.getByLabelText('Select thank-you note template for Alice Johnson');
    expect(templateSelect).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Choose a starter template...' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Physical Gift' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Monetary Contribution' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'General Appreciation' })).toBeInTheDocument();

    const textarea = screen.getByLabelText('Thank-you note message for Alice Johnson');
    // Clear textarea to avoid overwrite prompt
    fireEvent.change(textarea, { target: { value: '' } });

    // Select physical gift template
    fireEvent.change(templateSelect, { target: { value: 'physical-gift' } });

    expect(textarea).toHaveValue(
      'Dear Alice Johnson, thank you so much for the wonderful Espresso Machine! We are so grateful for your thoughtfulness and love.'
    );
  });

  it('populates monetary contribution template with formatted amount and item name', async () => {
    render(
      <ToastProvider>
        <ThankYouNotesPage />
      </ToastProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Alice Johnson')).toBeInTheDocument();
    });

    const editBtn = screen.getByRole('button', { name: 'Edit thank-you note for Alice Johnson' });
    fireEvent.click(editBtn);

    const textarea = screen.getByLabelText('Thank-you note message for Alice Johnson');
    fireEvent.change(textarea, { target: { value: '' } });

    const templateSelect = screen.getByLabelText('Select thank-you note template for Alice Johnson');
    fireEvent.change(templateSelect, { target: { value: 'monetary-contribution' } });

    expect(textarea).toHaveValue(
      'Dear Alice Johnson, thank you so much for your generous gift of $150.00 towards our Espresso Machine! Your support means the world to us.'
    );
  });

  it('falls back to "wedding gift" when registry item name is missing', async () => {
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/api/admin/thank-you-notes')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              ...mockData,
              items: [
                {
                  id: 'c3',
                  name: 'Charlie Davis',
                  email: 'charlie@example.com',
                  amount: 50,
                  date: new Date().toISOString(),
                  thankYouStatus: 'Unsent',
                  thankYouSentAt: null,
                  thankYouNote: null,
                  registryItem: null,
                },
              ],
            }),
        });
      }
      return Promise.reject(new Error('Unknown endpoint'));
    });

    render(
      <ToastProvider>
        <ThankYouNotesPage />
      </ToastProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Charlie Davis')).toBeInTheDocument();
    });

    const editBtn = screen.getByRole('button', { name: 'Edit thank-you note for Charlie Davis' });
    fireEvent.click(editBtn);

    const templateSelect = screen.getByLabelText('Select thank-you note template for Charlie Davis');
    fireEvent.change(templateSelect, { target: { value: 'general-appreciation' } });

    const textarea = screen.getByLabelText('Thank-you note message for Charlie Davis');
    expect(textarea).toHaveValue(
      'Dear Charlie Davis, thank you so much for celebrating with us and for your generous wedding gift! We are so blessed to have you in our lives.'
    );
  });

  it('prompts confirmation when replacing note with existing text, respecting cancel and confirm', async () => {
    render(
      <ToastProvider>
        <ThankYouNotesPage />
      </ToastProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Alice Johnson')).toBeInTheDocument();
    });

    const editBtn = screen.getByRole('button', { name: 'Edit thank-you note for Alice Johnson' });
    fireEvent.click(editBtn);

    const textarea = screen.getByLabelText('Thank-you note message for Alice Johnson');
    // Alice Johnson already has 'Initial draft note'
    expect(textarea).toHaveValue('Initial draft note');

    const templateSelect = screen.getByLabelText('Select thank-you note template for Alice Johnson');

    // Trigger template selection with existing note text
    fireEvent.change(templateSelect, { target: { value: 'physical-gift' } });

    // Confirmation dialog should appear
    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
      expect(
        screen.getByText(
          'Replacing the note with a template will overwrite your existing text. Are you sure you want to proceed?'
        )
      ).toBeInTheDocument();
    });

    // Click Cancel in dialog
    const cancelConfirmBtn = within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelConfirmBtn);

    // Note should remain unchanged
    expect(textarea).toHaveValue('Initial draft note');

    // Now trigger again and click Confirm
    fireEvent.change(templateSelect, { target: { value: 'physical-gift' } });

    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    });

    const confirmBtn = within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirm' });
    fireEvent.click(confirmBtn);

    // Note should now be replaced with substituted template
    await waitFor(() => {
      expect(textarea).toHaveValue(
        'Dear Alice Johnson, thank you so much for the wonderful Espresso Machine! We are so grateful for your thoughtfulness and love.'
      );
    });
  });

  it('substituteThankYouTemplateTokens handles custom tokens, whitespace, and defaults', () => {
    const res1 = substituteThankYouTemplateTokens('Hi {{guestName}}, thanks for {{giftName}} ({{amount}})!', {
      guestName: 'Jane',
      giftName: 'Blender',
      amount: 100,
    });
    expect(res1).toBe('Hi Jane, thanks for Blender ($100.00)!');

    const res2 = substituteThankYouTemplateTokens('Hi {{ guestName }}, thanks for {{ giftName }} ({{ amount }})!', {
      guestName: null,
      giftName: null,
      amount: null,
    });
    expect(res2).toBe('Hi Friend, thanks for wedding gift ($0.00)!');
  });
});
