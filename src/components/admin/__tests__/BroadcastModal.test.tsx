import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BroadcastModal } from '../BroadcastModal';

const mockAddToast = jest.fn();
jest.mock('@/components/ui/ToastProvider', () => ({
  useToast: () => ({
    addToast: mockAddToast,
  }),
}));

const mockSendBroadcast = jest.fn();
const mockPreviewBroadcast = jest.fn();
const mockSendTestBroadcast = jest.fn();

jest.mock('@/hooks/admin/useAdminBroadcast', () => ({
  useAdminBroadcast: () => ({
    sendBroadcast: mockSendBroadcast,
    previewBroadcast: mockPreviewBroadcast,
    sendTestBroadcast: mockSendTestBroadcast,
    sending: false,
    previewing: false,
    sendingTest: false,
  }),
}));

describe('BroadcastModal Component', () => {
  const defaultProps = {
    isOpen: true,
    onClose: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders modal title and form elements when open', () => {
    render(<BroadcastModal {...defaultProps} />);

    expect(screen.getByText('Compose Multi-Channel Broadcast')).toBeInTheDocument();
    expect(screen.getByLabelText('Channel')).toBeInTheDocument();
    expect(screen.getByLabelText('Subject')).toBeInTheDocument();
    expect(screen.getByLabelText('Message Body')).toBeInTheDocument();
    expect(screen.getByLabelText('Test Destination (Optional)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send Test to Me/i })).toBeInTheDocument();
  });

  it('inserts placeholder variable when button clicked', () => {
    render(<BroadcastModal {...defaultProps} />);

    const guestNameBtn = screen.getByRole('button', { name: /\+ \{\{guestName\}\}/i });
    fireEvent.click(guestNameBtn);

    const bodyInput = screen.getByLabelText('Message Body') as HTMLTextAreaElement;
    expect(bodyInput.value).toContain('{{guestName}}');
  });

  it('switches to live preview when preview button clicked', async () => {
    mockPreviewBroadcast.mockResolvedValue({
      body: 'Hello John',
      sampleGuestName: 'John',
      destination: 'john@example.com',
    });

    render(<BroadcastModal {...defaultProps} />);

    const bodyInput = screen.getByLabelText('Message Body');
    fireEvent.change(bodyInput, { target: { value: 'Hello {{guestName}}' } });

    const previewBtn = screen.getByRole('button', { name: /^Live Preview$/i });
    fireEvent.click(previewBtn);

    expect(mockPreviewBroadcast).toHaveBeenCalled();
  });

  it('clicking Send Test to Me dispatches test message without closing dialog', async () => {
    mockSendTestBroadcast.mockResolvedValueOnce({
      success: true,
      destination: 'admin@wedding.example',
      channel: 'EMAIL',
    });

    render(<BroadcastModal {...defaultProps} />);

    const subjectInput = screen.getByLabelText('Subject');
    fireEvent.change(subjectInput, { target: { value: 'Important Update' } });

    const bodyInput = screen.getByLabelText('Message Body');
    fireEvent.change(bodyInput, { target: { value: 'Hello {{guestName}}' } });

    const sendTestBtn = screen.getByRole('button', { name: /Send Test to Me/i });
    fireEvent.click(sendTestBtn);

    await waitFor(() => {
      expect(mockSendTestBroadcast).toHaveBeenCalledWith({
        channel: 'EMAIL',
        subject: 'Important Update',
        body: 'Hello {{guestName}}',
        destination: undefined,
      });
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.stringContaining('admin@wedding.example'),
        'success'
      );
      // Guardrail: must NOT close the modal dialog on test dispatch
      expect(defaultProps.onClose).not.toHaveBeenCalled();
    });
  });

  it('custom test recipient override sends to entered destination without closing dialog', async () => {
    mockSendTestBroadcast.mockResolvedValueOnce({
      success: true,
      destination: 'assistant@wedding.example',
      channel: 'EMAIL',
    });

    render(<BroadcastModal {...defaultProps} />);

    const subjectInput = screen.getByLabelText('Subject');
    fireEvent.change(subjectInput, { target: { value: 'Rehearsal Info' } });

    const bodyInput = screen.getByLabelText('Message Body');
    fireEvent.change(bodyInput, { target: { value: 'Check schedule' } });

    const destInput = screen.getByLabelText('Test Destination (Optional)');
    fireEvent.change(destInput, { target: { value: 'assistant@wedding.example' } });

    const sendTestBtn = screen.getByRole('button', { name: /Send Test/i });
    fireEvent.click(sendTestBtn);

    await waitFor(() => {
      expect(mockSendTestBroadcast).toHaveBeenCalledWith({
        channel: 'EMAIL',
        subject: 'Rehearsal Info',
        body: 'Check schedule',
        destination: 'assistant@wedding.example',
      });
      expect(defaultProps.onClose).not.toHaveBeenCalled();
    });
  });

  it('displays error toast when test dispatch fails', async () => {
    mockSendTestBroadcast.mockRejectedValueOnce(new Error('Resend API Key is missing in settings'));

    render(<BroadcastModal {...defaultProps} />);

    const subjectInput = screen.getByLabelText('Subject');
    fireEvent.change(subjectInput, { target: { value: 'Failed Test' } });

    const bodyInput = screen.getByLabelText('Message Body');
    fireEvent.change(bodyInput, { target: { value: 'Failing body' } });

    const sendTestBtn = screen.getByRole('button', { name: /Send Test to Me/i });
    fireEvent.click(sendTestBtn);

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        'Resend API Key is missing in settings',
        'error'
      );
      expect(defaultProps.onClose).not.toHaveBeenCalled();
    });
  });
});
