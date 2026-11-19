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

  it('switches tabs passively without calling preview API when tab is clicked', () => {
    render(<BroadcastModal {...defaultProps} />);

    const previewTab = screen.getByRole('tab', { name: /Live Preview/i });
    fireEvent.click(previewTab);

    expect(previewTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: /Live Preview/i })).toBeInTheDocument();
    expect(mockPreviewBroadcast).not.toHaveBeenCalled();
    expect(mockAddToast).not.toHaveBeenCalled();
  });

  it('renders standard WAI-ARIA tab semantics and attributes', () => {
    render(<BroadcastModal {...defaultProps} />);

    const tablist = screen.getByRole('tablist', { name: 'Broadcast navigation tabs' });
    expect(tablist).toBeInTheDocument();

    const composeTab = screen.getByRole('tab', { name: /Compose Message/i });
    const previewTab = screen.getByRole('tab', { name: /Live Preview/i });

    expect(composeTab).toHaveAttribute('aria-selected', 'true');
    expect(composeTab).toHaveAttribute('aria-controls', 'broadcast-tabpanel-compose');

    expect(previewTab).toHaveAttribute('aria-selected', 'false');
    expect(previewTab).toHaveAttribute('aria-controls', 'broadcast-tabpanel-preview');

    const composePanel = screen.getByRole('tabpanel', { name: /Compose Message/i });
    expect(composePanel).toHaveAttribute('id', 'broadcast-tabpanel-compose');

    fireEvent.click(previewTab);

    expect(composeTab).toHaveAttribute('aria-selected', 'false');
    expect(previewTab).toHaveAttribute('aria-selected', 'true');

    const previewPanel = screen.getByRole('tabpanel', { name: /Live Preview/i });
    expect(previewPanel).toHaveAttribute('id', 'broadcast-tabpanel-preview');
  });

  it('displays empty state placeholder when switching to preview tab without preview and without error toast', () => {
    render(<BroadcastModal {...defaultProps} />);

    const previewTab = screen.getByRole('tab', { name: /Live Preview/i });
    fireEvent.click(previewTab);

    expect(screen.getByText(/render dynamic variables/i)).toBeInTheDocument();
    expect(mockAddToast).not.toHaveBeenCalled();
    expect(mockPreviewBroadcast).not.toHaveBeenCalled();
  });

  it('explicit preview generation on footer button triggers preview broadcast', async () => {
    mockPreviewBroadcast.mockResolvedValueOnce({
      body: 'Hello John',
      sampleGuestName: 'John',
      destination: 'john@example.com',
    });

    render(<BroadcastModal {...defaultProps} />);

    const bodyInput = screen.getByLabelText('Message Body');
    fireEvent.change(bodyInput, { target: { value: 'Hello {{guestName}}' } });

    const previewBtn = screen.getByRole('button', { name: /^Preview$/i });
    fireEvent.click(previewBtn);

    await waitFor(() => {
      expect(mockPreviewBroadcast).toHaveBeenCalledWith({
        channel: 'EMAIL',
        subject: '',
        body: 'Hello {{guestName}}',
        targetFilters: undefined,
      });
      expect(screen.getByText('Hello John')).toBeInTheDocument();
    });
  });

  it('preserves existing preview state when switching between tabs without duplicate API calls', async () => {
    mockPreviewBroadcast.mockResolvedValueOnce({
      body: 'Hello John',
      sampleGuestName: 'John',
      destination: 'john@example.com',
    });

    render(<BroadcastModal {...defaultProps} />);

    const bodyInput = screen.getByLabelText('Message Body');
    fireEvent.change(bodyInput, { target: { value: 'Hello {{guestName}}' } });

    const previewBtn = screen.getByRole('button', { name: /^Preview$/i });
    fireEvent.click(previewBtn);

    await waitFor(() => {
      expect(screen.getByText('Hello John')).toBeInTheDocument();
    });

    expect(mockPreviewBroadcast).toHaveBeenCalledTimes(1);

    // Switch back to Compose tab
    const composeTab = screen.getByRole('tab', { name: /Compose Message/i });
    fireEvent.click(composeTab);
    expect(screen.getByRole('tabpanel', { name: /Compose Message/i })).toBeInTheDocument();

    // Switch back to Preview tab
    const previewTab = screen.getByRole('tab', { name: /Live Preview/i });
    fireEvent.click(previewTab);
    expect(screen.getByRole('tabpanel', { name: /Live Preview/i })).toBeInTheDocument();
    expect(screen.getByText('Hello John')).toBeInTheDocument();

    // Ensure no redundant API preview call was made
    expect(mockPreviewBroadcast).toHaveBeenCalledTimes(1);
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
