import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InvitationQRPreviewModal } from '../InvitationQRPreviewModal';

const mockAddToast = jest.fn();
jest.mock('@/components/ui/ToastProvider', () => ({
  useToast: () => ({
    addToast: mockAddToast,
  }),
}));

describe('InvitationQRPreviewModal Component', () => {
  const sampleGuest = {
    id: 'guest-1',
    guestName: 'Elizabeth Bennet',
    code: 'PEMBERLEY26',
    householdName: 'Bennet Household',
    partyGroup: 'Bridal Party',
    plusOneFirstName: 'Fitzwilliam',
    plusOneLastName: 'Darcy',
  };

  const defaultProps = {
    isOpen: true,
    onClose: jest.fn(),
    guest: sampleGuest,
  };

  beforeAll(() => {
    HTMLCanvasElement.prototype.toDataURL = jest.fn(() => 'data:image/png;base64,mockData');
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders nothing when guest is null', () => {
    const { container } = render(
      <InvitationQRPreviewModal isOpen={true} onClose={jest.fn()} guest={null} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders guest name, plus-one, household, and code when open', () => {
    render(<InvitationQRPreviewModal {...defaultProps} />);

    expect(screen.getByTestId('qr-modal-guest-name')).toHaveTextContent('Elizabeth Bennet');
    expect(screen.getByText(/Fitzwilliam Darcy/)).toBeInTheDocument();
    expect(screen.getByText(/Bennet Household/)).toBeInTheDocument();
    expect(screen.getByText('PEMBERLEY26')).toBeInTheDocument();
  });

  it('displays the personalized RSVP URL in an accessible input', () => {
    render(<InvitationQRPreviewModal {...defaultProps} />);

    const urlInput = screen.getByLabelText('Personalized RSVP URL') as HTMLInputElement;
    expect(urlInput).toBeInTheDocument();
    expect(urlInput.value).toContain('/guest?code=PEMBERLEY26');
  });

  it('renders the high contrast QR code canvas with accessible label', () => {
    render(<InvitationQRPreviewModal {...defaultProps} />);

    const canvas = screen.getByLabelText('Personalized QR code for Elizabeth Bennet');
    expect(canvas).toBeInTheDocument();
  });

  it('copies personalized RSVP link to clipboard and triggers toast', async () => {
    const originalClipboard = navigator.clipboard;
    const writeTextMock = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(<InvitationQRPreviewModal {...defaultProps} />);

    const copyBtn = screen.getByRole('button', { name: /Copy personalized RSVP URL/i });
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith(expect.stringContaining('/guest?code=PEMBERLEY26'));
      expect(mockAddToast).toHaveBeenCalledWith('Personalized RSVP link copied to clipboard!', 'success');
    });

    Object.assign(navigator, { clipboard: originalClipboard });
  });

  it('triggers 512x512 PNG download named qr-<code>.png when clicking Download PNG', () => {
    render(<InvitationQRPreviewModal {...defaultProps} />);

    const appendChildSpy = jest.spyOn(document.body, 'appendChild');
    const removeChildSpy = jest.spyOn(document.body, 'removeChild');

    const downloadBtn = screen.getByRole('button', { name: /Download QR code as PNG image/i });
    fireEvent.click(downloadBtn);

    expect(appendChildSpy).toHaveBeenCalled();
    const appendedElement = appendChildSpy.mock.calls[appendChildSpy.mock.calls.length - 1][0] as HTMLAnchorElement;
    expect(appendedElement.download).toBe('qr-PEMBERLEY26.png');
    expect(mockAddToast).toHaveBeenCalledWith('Downloaded qr-PEMBERLEY26.png', 'success');

    appendChildSpy.mockRestore();
    removeChildSpy.mockRestore();
  });
});
