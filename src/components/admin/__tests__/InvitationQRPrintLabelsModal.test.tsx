import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { InvitationQRPrintLabelsModal } from '../InvitationQRPrintLabelsModal';

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

  it('adds printing-qr-labels class to body when mounted', () => {
    render(
      <InvitationQRPrintLabelsModal isOpen={true} onClose={jest.fn()} codes={sampleCodes} />
    );
    expect(document.body.classList.contains('printing-qr-labels')).toBe(true);
  });

  it('allows switching between Avery 5163 and Avery 5160 templates', () => {
    render(
      <InvitationQRPrintLabelsModal isOpen={true} onClose={jest.fn()} codes={sampleCodes} />
    );

    const select = screen.getByLabelText(/Select Avery label template/i) as HTMLSelectElement;
    expect(select.value).toBe('avery_5163');

    fireEvent.change(select, { target: { value: 'avery_5160' } });
    expect(select.value).toBe('avery_5160');
  });

  it('triggers window.print when Print Sheet button is clicked', () => {
    const originalPrint = window.print;
    const mockPrint = jest.fn();
    window.print = mockPrint;

    render(
      <InvitationQRPrintLabelsModal isOpen={true} onClose={jest.fn()} codes={sampleCodes} />
    );

    const printBtn = screen.getByRole('button', { name: /Print label sheet/i });
    fireEvent.click(printBtn);

    expect(mockPrint).toHaveBeenCalled();
    window.print = originalPrint;
  });

  it('removes printing-qr-labels class from body and calls onClose when Done is clicked', () => {
    const mockClose = jest.fn();
    render(
      <InvitationQRPrintLabelsModal isOpen={true} onClose={mockClose} codes={sampleCodes} />
    );

    const doneBtn = screen.getByRole('button', { name: /Done/i });
    fireEvent.click(doneBtn);

    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(document.body.classList.contains('printing-qr-labels')).toBe(false);
  });
});
