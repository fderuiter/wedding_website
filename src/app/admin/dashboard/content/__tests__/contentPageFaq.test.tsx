import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import { ToastProvider } from '@/components/ui/ToastProvider';

expect.extend(toHaveNoViolations);

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
    tags: ['Homepage', 'FAQ'],
    data: {
      question: 'When is the wedding?',
      answer: 'June 20, 2026',
      category: 'Venue',
      keywords: 'date, time, venue',
      displayOrder: 0,
      isVisible: true,
    },
  },
  {
    id: 'faq-2',
    type: 'FAQ',
    tags: ['Homepage', 'FAQ'],
    data: {
      question: 'What is the dress code?',
      answer: 'Cocktail attire.',
      category: 'Attire',
      keywords: 'dress code, cocktail',
      displayOrder: 1,
      isVisible: true,
    },
  },
  {
    id: 'log-1',
    type: 'Logistics',
    tags: ['Homepage', 'Logistics'],
    data: {
      title: 'Parking & Shuttle',
      description: 'Valet at main entrance.',
    },
  },
];

const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockRemove = jest.fn();
const mockRemoveBatch = jest.fn();
const mockReorder = jest.fn();

jest.mock('@/hooks/admin/useAdminContent', () => ({
  useAdminContent: () => ({
    data: mockNodes,
    isLoading: false,
    error: null,
    fetchAll: jest.fn(),
    create: mockCreate,
    update: mockUpdate,
    remove: mockRemove,
    removeBatch: mockRemoveBatch,
    reorder: mockReorder,
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

    const editBtns = screen.getAllByRole('button', { name: /edit content: faq/i });
    fireEvent.click(editBtns[0]);

    const categoryInput = screen.getByLabelText(/faq category/i);
    const keywordsInput = screen.getByLabelText(/faq keywords/i);

    expect(categoryInput).toHaveValue('Venue');
    expect(keywordsInput).toHaveValue('date, time, venue');
  });

  it('exposes accessible labeled inputs for FAQ fields with unique DOM IDs and zero axe violations', async () => {
    const { container } = render(
      <ToastProvider>
        <ContentDashboardPage />
      </ToastProvider>
    );

    fireEvent.click(screen.getAllByRole('button', { name: /edit content: faq/i })[0]);

    expect(screen.getByLabelText(/content type/i)).toHaveValue('FAQ');
    expect(screen.getByLabelText(/^question$/i)).toHaveValue('When is the wedding?');
    expect(screen.getByLabelText(/^answer$/i)).toHaveValue('June 20, 2026');
    expect(screen.getByLabelText(/faq category/i)).toHaveValue('Venue');
    expect(screen.getByLabelText(/faq keywords/i)).toHaveValue('date, time, venue');

    const ids = Array.from(container.querySelectorAll('[id]')).map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);

    const axeResults = await axe(container);
    expect(axeResults).toHaveNoViolations();
  });

  it('supports type filter tabs, starter FAQ templates, inline visibility toggles, custom displayOrder reordering, and bulk deletion', async () => {
    mockUpdate.mockClear();
    mockReorder.mockClear();
    mockRemoveBatch.mockClear();

    render(
      <ToastProvider>
        <ContentDashboardPage />
      </ToastProvider>
    );

    // 1. Type filter tabs filter items cleanly
    const faqTab = screen.getByRole('tab', { name: /^FAQs \(2\)$/i });
    const logisticsTab = screen.getByRole('tab', { name: /^Logistics \(1\)$/i });
    const allTab = screen.getByRole('tab', { name: /^All \(3\)$/i });

    fireEvent.click(faqTab);
    expect(faqTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('When is the wedding?')).toBeInTheDocument();
    expect(screen.queryByText('Parking & Shuttle')).not.toBeInTheDocument();

    fireEvent.click(logisticsTab);
    expect(screen.getByText('Parking & Shuttle')).toBeInTheDocument();
    expect(screen.queryByText('When is the wedding?')).not.toBeInTheDocument();

    fireEvent.click(allTab);
    expect(screen.getByText('When is the wedding?')).toBeInTheDocument();
    expect(screen.getByText('Parking & Shuttle')).toBeInTheDocument();

    // 2. Starter question template pre-fills Question, Answer, Category, and Keywords
    fireEvent.click(screen.getByRole('button', { name: /add new content/i }));
    const templateSelect = screen.getByLabelText(/starter question template/i);
    fireEvent.change(templateSelect, { target: { value: 'accommodations' } });
    expect(screen.getByLabelText(/^question$/i)).toHaveValue(
      'Where should out-of-town guests book accommodations?'
    );
    expect(screen.getByLabelText(/faq category/i)).toHaveValue('Travel');
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

    // 3. Inline Hide button toggles isVisible to false via update()
    fireEvent.click(screen.getByRole('button', { name: /Hide FAQ: When is the wedding\?/i }));
    expect(mockUpdate).toHaveBeenCalledWith(
      'faq-1',
      expect.objectContaining({
        type: 'FAQ',
        data: expect.objectContaining({
          question: 'When is the wedding?',
          isVisible: false,
        }),
      })
    );

    // 4. Move FAQ down reorders FAQ IDs via reorder()
    fireEvent.click(screen.getByRole('button', { name: /Move FAQ down: When is the wedding\?/i }));
    expect(mockReorder).toHaveBeenCalledWith(['faq-2', 'faq-1']);

    // 5. Select All + Delete Selected + Confirm triggers removeBatch()
    fireEvent.click(screen.getByLabelText(/Select all \(3\)/i));
    fireEvent.click(screen.getByRole('button', { name: /Delete Selected \(3\)/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^Confirm$/i }));
    await waitFor(() => {
      expect(mockRemoveBatch).toHaveBeenCalledWith(['faq-2', 'faq-1', 'log-1']);
    });
  });
});
