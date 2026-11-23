import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import { SampleDataBanner } from '../SampleDataBanner';

expect.extend(toHaveNoViolations);

const mockRefresh = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: mockRefresh,
  }),
}));

const mockAddToast = jest.fn();
const mockConfirm = jest.fn();
jest.mock('@/components/ui/ToastProvider', () => ({
  useToast: () => ({
    addToast: mockAddToast,
    confirm: mockConfirm,
  }),
}));

describe('SampleDataBanner', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfirm.mockResolvedValue(true);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('derives Purge Sample Data button accessible name from live visible text across idle and purging states and passes jest-axe', async () => {
    let resolveDelete!: (res: Response) => void;
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          hasSampleData: true,
          counts: { registry: 4, guests: 6 },
        }),
      } as Response)
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveDelete = resolve;
          })
      );

    const { container } = render(<SampleDataBanner />);

    const idleButton = await screen.findByRole('button', { name: 'Purge Sample Data' });
    expect(idleButton).toBeInTheDocument();
    expect(
      await axe(container, { rules: { 'label-content-name-mismatch': { enabled: true } } })
    ).toHaveNoViolations();

    fireEvent.click(idleButton);

    const busyButton = await screen.findByRole('button', { name: 'Purging Sample Data...' });
    expect(busyButton).toBeDisabled();
    expect(
      await axe(container, { rules: { 'label-content-name-mismatch': { enabled: true } } })
    ).toHaveNoViolations();

    resolveDelete({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        'All sample data has been successfully purged.',
        'success'
      );
      expect(mockRefresh).toHaveBeenCalled();
    });
  });
});
