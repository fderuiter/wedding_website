import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { InvitationQRPrintLabelsModal } from '../InvitationQRPrintLabelsModal';

expect.extend(toHaveNoViolations);

describe('InvitationQRPrintLabelsModal Component', () => {
  const sampleCodes = [
    {
      id: 'c-1',
      guestName: 'Jane Austen',
      code: 'AUSTEN26',
      householdName: 'Austen Family',
      partyGroup: 'VIP',
      plusOneFirstName: 'Cassandra',
      plusOneLastName: 'Austen',
    },
    {
      id: 'c-2',
      guestName: 'Charles Bingley',
      code: 'BINGLEY26',
      householdName: 'Bingley Estate',
      partyGroup: 'Groom',
      plusOneFirstName: null,
      plusOneLastName: null,
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <InvitationQRPrintLabelsModal isOpen={false} onClose={jest.fn()} codes={sampleCodes} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders modal dialog with sheet title, summary count, and label cards', () => {
    render(
      <InvitationQRPrintLabelsModal isOpen={true} onClose={jest.fn()} codes={sampleCodes} />
    );

    expect(screen.getByText(/Print QR Code Labels \(2 guests\)/i)).toBeInTheDocument();
    expect(screen.getByTestId('qr-print-sheet')).toBeInTheDocument();

    const labelCards = screen.getAllByTestId('qr-label-card');
    expect(labelCards).toHaveLength(2);
    expect(screen.getByText('Jane Austen')).toBeInTheDocument();
    expect(screen.getByText('& Cassandra Austen')).toBeInTheDocument();
    expect(screen.getByText('AUSTEN26')).toBeInTheDocument();
    expect(screen.getByText('Charles Bingley')).toBeInTheDocument();
    expect(screen.getByText('BINGLEY26')).toBeInTheDocument();
  });

  it('adds printing-qr-labels and printing-qr-portal classes to body when mounted', () => {
    render(
      <InvitationQRPrintLabelsModal isOpen={true} onClose={jest.fn()} codes={sampleCodes} />
    );
    expect(document.body.classList.contains('printing-qr-labels')).toBe(true);
    expect(document.body.classList.contains('printing-qr-portal')).toBe(true);
  });

  it('allows switching between Avery 5163 and Avery 5160 templates without triggering print', () => {
    const originalPrint = window.print;
    const mockPrint = jest.fn();
    window.print = mockPrint;

    render(
      <InvitationQRPrintLabelsModal isOpen={true} onClose={jest.fn()} codes={sampleCodes} />
    );

    const select = screen.getByLabelText(/Select Avery label template/i) as HTMLSelectElement;
    expect(select.value).toBe('avery_5163');

    fireEvent.change(select, { target: { value: 'avery_5160' } });
    expect(select.value).toBe('avery_5160');
    expect(mockPrint).not.toHaveBeenCalled();

    window.print = originalPrint;
  });

  it('does not automatically call window.print when modal is mounted or progressive rendering completes', () => {
    jest.useFakeTimers();
    const originalPrint = window.print;
    const mockPrint = jest.fn();
    window.print = mockPrint;

    render(
      <InvitationQRPrintLabelsModal isOpen={true} onClose={jest.fn()} codes={sampleCodes} />
    );

    // Fast-forward past progressive rendering and former print timer thresholds
    jest.advanceTimersByTime(1000);

    expect(mockPrint).not.toHaveBeenCalled();

    window.print = originalPrint;
    jest.useRealTimers();
  });

  it('displays empty preview state safely when codes array is empty without triggering print', () => {
    jest.useFakeTimers();
    const originalPrint = window.print;
    const mockPrint = jest.fn();
    window.print = mockPrint;

    render(
      <InvitationQRPrintLabelsModal isOpen={true} onClose={jest.fn()} codes={[]} />
    );

    expect(screen.getByText(/Print QR Code Labels \(0 guests\)/i)).toBeInTheDocument();
    expect(screen.queryByTestId('qr-label-card')).not.toBeInTheDocument();

    jest.advanceTimersByTime(1000);
    expect(mockPrint).not.toHaveBeenCalled();

    window.print = originalPrint;
    jest.useRealTimers();
  });

  it('triggers window.print when Print Sheet button is clicked and passes jest-axe', async () => {
    const originalPrint = window.print;
    const mockPrint = jest.fn();
    window.print = mockPrint;

    render(
      <InvitationQRPrintLabelsModal isOpen={true} onClose={jest.fn()} codes={sampleCodes} />
    );

    const dialog = screen.getByRole('dialog', { name: 'Printable Invitation QR Labels' });
    expect(
      await axe(dialog, { rules: { 'label-content-name-mismatch': { enabled: true } } })
    ).toHaveNoViolations();

    const printBtn = screen.getByRole('button', { name: 'Print Sheet of QR code labels' });
    fireEvent.click(printBtn);

    expect(mockPrint).toHaveBeenCalled();
    window.print = originalPrint;
  });

  it('removes printing-qr-labels and printing-qr-portal classes from body and calls onClose when Done is clicked', () => {
    const mockClose = jest.fn();
    render(
      <InvitationQRPrintLabelsModal isOpen={true} onClose={mockClose} codes={sampleCodes} />
    );

    const doneBtn = screen.getByRole('button', { name: /Done/i });
    fireEvent.click(doneBtn);

    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(document.body.classList.contains('printing-qr-labels')).toBe(false);
    expect(document.body.classList.contains('printing-qr-portal')).toBe(false);
  });

  it('renders via document.body portal outside clipped ancestors, disables Print Sheet while empty or progressively rendering, and encodes AppConfig.baseUrl', async () => {
    jest.useFakeTimers();
    const { act } = await import('@testing-library/react');
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
    const queryClient = new QueryClient();
    queryClient.setQueryData(['admin-settings', 'global'], {
      baseUrl: 'https://wedding.custom-domain.org/',
    });
    queryClient.setQueryData(['admin-profiles-list'], []);

    const sixtyCodes = Array.from({ length: 60 }, (_, idx) => ({
      id: `code-${idx + 1}`,
      guestName: `Household ${idx + 1}`,
      code: `INV${String(idx + 1).padStart(3, '0')}`,
    }));

    const { container, rerender } = render(
      <QueryClientProvider client={queryClient}>
        <div className="overflow-hidden fixed inset-0" data-testid="clipped-wrapper">
          <InvitationQRPrintLabelsModal isOpen={true} onClose={jest.fn()} codes={sixtyCodes} />
        </div>
      </QueryClientProvider>
    );

    const portalRoot = document.body.querySelector('.printable-qr-portal-root');
    expect(portalRoot).not.toBeNull();
    expect(portalRoot?.parentElement).toBe(document.body);
    expect(container.querySelector('.printable-qr-portal-root')).toBeNull();

    // Initially only 30 of 60 QR canvases are rendered -> Print Sheet must be disabled
    const printBtn = screen.getByRole('button', { name: 'Print Sheet of QR code labels' });
    expect(printBtn).toBeDisabled();

    // Advance timers so all 60 labels complete rendering -> Print Sheet becomes enabled
    act(() => {
      jest.advanceTimersByTime(100);
    });
    await screen.findByText('Household 60');
    expect(printBtn).not.toBeDisabled();

    const sheet = screen.getByTestId('qr-print-sheet');
    expect(sheet).toHaveClass('qr-print-sheet--avery-5163');
    fireEvent.change(screen.getByLabelText(/Select Avery label template/i), {
      target: { value: 'avery_5160' },
    });
    expect(sheet).toHaveClass('qr-print-sheet--avery-5160');

    // Empty codes array keeps Print Sheet disabled
    rerender(
      <QueryClientProvider client={queryClient}>
        <InvitationQRPrintLabelsModal isOpen={true} onClose={jest.fn()} codes={[]} />
      </QueryClientProvider>
    );
    expect(screen.getByRole('button', { name: 'Print Sheet of QR code labels' })).toBeDisabled();

    jest.useRealTimers();
  });

  it('defaults modal title heading to h2 so page-level h1 remains unique with zero heading-order violations', async () => {
    render(
      <main>
        <h1>Pre-Authorized Guest Invitation Codes</h1>
        <InvitationQRPrintLabelsModal isOpen={true} onClose={jest.fn()} codes={sampleCodes} />
      </main>
    );

    expect(document.body.querySelectorAll('h1')).toHaveLength(1);
    expect(
      screen.getByRole('heading', { level: 2, name: 'Printable Invitation QR Labels' })
    ).toBeInTheDocument();
    expect(
      await axe(document.body, {
        rules: {
          'page-has-heading-one': { enabled: true },
          'heading-order': { enabled: true },
        },
      })
    ).toHaveNoViolations();
  });

  it('exposes tabIndex=0 on scrollable print sheet, sets inert on background landmarks, and restores trigger focus on Escape', () => {
    function Wrapper() {
      const [open, setOpen] = useState(false);
      return (
        <main>
          <button type="button" onClick={() => setOpen(true)}>
            Launch Print Labels
          </button>
          <InvitationQRPrintLabelsModal
            isOpen={open}
            onClose={() => setOpen(false)}
            codes={sampleCodes}
          />
        </main>
      );
    }

    render(<Wrapper />);
    const main = screen.getByRole('main');
    const launchBtn = screen.getByRole('button', { name: 'Launch Print Labels' });
    launchBtn.focus();
    fireEvent.click(launchBtn);

    expect(main.closest('[inert]')).not.toBeNull();
    expect(Array.from(document.body.children).some((el) => el.hasAttribute('inert'))).toBe(true);
    const printSheet = screen.getByTestId('qr-print-sheet');
    expect(printSheet).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(main.closest('[inert]')).toBeNull();
    expect(launchBtn).toHaveFocus();
  });
});
