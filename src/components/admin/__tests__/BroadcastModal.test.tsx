import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { BroadcastModal } from '../BroadcastModal';

expect.extend(toHaveNoViolations);

const mockAddToast = jest.fn();
jest.mock('@/components/ui/ToastProvider', () => ({
  useToast: () => ({
    addToast: mockAddToast,
  }),
}));

const mockSendBroadcast = jest.fn();
const mockPreviewBroadcast = jest.fn();
const mockSendTestBroadcast = jest.fn();
let mockCountRecipients: jest.Mock | undefined = undefined;
let mockSendingTest = false;

jest.mock('@/hooks/admin/useAdminBroadcast', () => ({
  useAdminBroadcast: () => ({
    sendBroadcast: mockSendBroadcast,
    previewBroadcast: mockPreviewBroadcast,
    sendTestBroadcast: mockSendTestBroadcast,
    ...(mockCountRecipients ? { countRecipients: mockCountRecipients } : {}),
    sending: false,
    previewing: false,
    sendingTest: mockSendingTest,
  }),
}));

describe('BroadcastModal Component', () => {
  const defaultProps = {
    isOpen: true,
    onClose: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockCountRecipients = undefined;
    mockSendingTest = false;
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

  it('fills subject and body with {{guestName}} and {{rsvpUrl}} when a starter template is clicked and adapts body when switching channel', () => {
    render(<BroadcastModal {...defaultProps} />);

    const rsvpReminderBtn = screen.getByRole('button', { name: 'RSVP Reminder' });
    fireEvent.click(rsvpReminderBtn);
    expect(rsvpReminderBtn).toHaveAttribute('aria-pressed', 'true');

    const subjectInput = screen.getByLabelText('Subject') as HTMLInputElement;
    const bodyInput = screen.getByLabelText('Message Body') as HTMLTextAreaElement;

    expect(subjectInput.value).toContain('RSVP Reminder');
    expect(bodyInput.value).toContain('{{guestName}}');
    expect(bodyInput.value).toContain('{{rsvpUrl}}');

    // Switching channel from EMAIL to SMS swaps the unmodified starter template body
    fireEvent.change(screen.getByLabelText('Channel'), { target: { value: 'SMS' } });
    expect((screen.getByLabelText('Message Body') as HTMLTextAreaElement).value).toContain('{{guestName}}');
    expect((screen.getByLabelText('Message Body') as HTMLTextAreaElement).value).toContain('{{rsvpUrl}}');

    // Test the other three starter templates
    fireEvent.change(screen.getByLabelText('Channel'), { target: { value: 'EMAIL' } });
    for (const label of ['Final RSVP Call', 'Sub-Event Update', 'Mailing Address Request']) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect((screen.getByLabelText('Subject') as HTMLInputElement).value.length).toBeGreaterThan(0);
      expect((screen.getByLabelText('Message Body') as HTMLTextAreaElement).value).toContain('{{guestName}}');
      expect((screen.getByLabelText('Message Body') as HTMLTextAreaElement).value).toContain('{{rsvpUrl}}');
    }
  });

  it('renders interactive audience controls when manual selection is off, updates live recipient count, and forwards updated filters on send', async () => {
    mockCountRecipients = jest
      .fn()
      .mockResolvedValue({ recipientCount: 2 })
      .mockResolvedValueOnce({ recipientCount: 12 })
      .mockResolvedValueOnce({ recipientCount: 5 });
    mockSendBroadcast.mockResolvedValueOnce({
      status: 'COMPLETED',
      sentCount: 2,
      failedCount: 0,
    });

    const subEvents = [
      { id: 'sub-rehearsal', title: 'Rehearsal Dinner', isPrivate: true },
      { id: 'sub-brunch', title: 'Farewell Brunch', isPrivate: false },
    ];

    render(<BroadcastModal {...defaultProps} subEvents={subEvents} />);

    await waitFor(() => {
      expect(screen.getByTestId('broadcast-recipient-count')).toHaveTextContent('12 matching recipients');
    });

    // Sub-Event RSVP Status is disabled until a Sub-Event is chosen
    const subEventStatusSelect = screen.getByLabelText('Sub-Event RSVP Status') as HTMLSelectElement;
    expect(subEventStatusSelect).toBeDisabled();

    fireEvent.change(screen.getByLabelText('RSVP Status'), { target: { value: 'pending' } });
    await waitFor(() => {
      expect(mockCountRecipients).toHaveBeenLastCalledWith({ attendanceStatus: 'pending' });
      expect(screen.getByTestId('broadcast-recipient-count')).toHaveTextContent('5 matching recipients');
    });

    fireEvent.change(screen.getByLabelText('Address Completion'), { target: { value: 'missing' } });
    fireEvent.change(screen.getByLabelText('Sub-Event'), { target: { value: 'sub-rehearsal' } });
    expect(subEventStatusSelect).not.toBeDisabled();
    fireEvent.change(subEventStatusSelect, { target: { value: 'pending' } });

    await waitFor(() => {
      expect(mockCountRecipients).toHaveBeenLastCalledWith({
        attendanceStatus: 'pending',
        addressStatus: 'missing',
        subEventId: 'sub-rehearsal',
        subEventRsvpStatus: 'pending',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'RSVP Reminder' }));
    fireEvent.click(screen.getByRole('button', { name: /Send Email/i }));

    await waitFor(() => {
      expect(mockSendBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'EMAIL',
          targetFilters: {
            attendanceStatus: 'pending',
            addressStatus: 'missing',
            subEventId: 'sub-rehearsal',
            subEventRsvpStatus: 'pending',
          },
        })
      );
    });
  });

  it('hides interactive audience filter dropdowns when manual selection is active and disables send when recipient count is zero', async () => {
    const { rerender } = render(
      <BroadcastModal
        {...defaultProps}
        selectedCount={3}
        targetFilters={{ selectedIds: ['g1', 'g2', 'g3'] }}
      />
    );

    expect(screen.queryByLabelText('RSVP Status')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Address Completion')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Sub-Event')).not.toBeInTheDocument();
    expect(screen.getByTestId('broadcast-recipient-count')).toHaveTextContent('3 matching recipients');

    mockCountRecipients = jest.fn().mockResolvedValue({
      recipientCount: 0,
      baseUrlWarning: 'AppConfig.baseUrl is not configured; falling back to https://wedding.example.com',
    });

    rerender(<BroadcastModal {...defaultProps} initialRecipientCount={0} />);

    await waitFor(() => {
      expect(screen.getByTestId('broadcast-recipient-count')).toHaveTextContent('0 matching recipients');
    });

    fireEvent.click(screen.getByRole('button', { name: 'RSVP Reminder' }));
    expect(screen.getByTestId('broadcast-baseurl-warning')).toHaveTextContent(/AppConfig\.baseUrl is not configured/i);
    expect(screen.getByRole('button', { name: /Send Email/i })).toBeDisabled();
  });

  it('passes jest-axe accessibility checks with interactive controls and starter templates', async () => {
    const { container } = render(
      <BroadcastModal
        {...defaultProps}
        initialRecipientCount={4}
        subEvents={[{ id: 'sub-1', title: 'Welcome Drinks', isPrivate: false }]}
      />
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('supports SegmentedTabs ArrowRight, ArrowLeft, Home, and End keyboard navigation and passes jest-axe', async () => {
    const { baseElement } = render(<BroadcastModal {...defaultProps} />);

    const composeTab = screen.getByRole('tab', { name: /Compose Message/i });
    const previewTab = screen.getByRole('tab', { name: /Live Preview/i });

    expect(composeTab).toHaveAttribute('tabIndex', '0');
    expect(previewTab).toHaveAttribute('tabIndex', '-1');

    composeTab.focus();
    fireEvent.keyDown(composeTab, { key: 'ArrowRight' });
    expect(previewTab).toHaveFocus();
    expect(previewTab).toHaveAttribute('aria-selected', 'true');
    expect(previewTab).toHaveAttribute('tabIndex', '0');

    fireEvent.keyDown(previewTab, { key: 'ArrowLeft' });
    expect(composeTab).toHaveFocus();
    expect(composeTab).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(composeTab, { key: 'End' });
    expect(previewTab).toHaveFocus();
    expect(previewTab).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(previewTab, { key: 'Home' });
    expect(composeTab).toHaveFocus();
    expect(composeTab).toHaveAttribute('aria-selected', 'true');

    expect(await axe(baseElement)).toHaveNoViolations();
  });

  it('auto-renders unescaped preview on tab switch, re-renders when stale, and supports manual Refresh Preview', async () => {
    mockPreviewBroadcast
      .mockResolvedValueOnce({
        subject: "Update for Sean O'Connor & Family",
        body: "Hi Sean O'Connor & Family, we can't wait!",
        sampleGuestName: "Sean O'Connor",
        destination: 'sean@example.com',
      })
      .mockResolvedValueOnce({
        subject: "Update for Sean O'Connor & Family",
        body: "Revised: St. Mary's & Main Hall at 5 PM!",
        sampleGuestName: "Sean O'Connor",
        destination: 'sean@example.com',
      })
      .mockResolvedValueOnce({
        subject: "Update for Sean O'Connor & Family",
        body: "Refreshed: St. Mary's & Main Hall at 5 PM!",
        sampleGuestName: "Sean O'Connor",
        destination: 'sean@example.com',
      });

    const { baseElement } = render(<BroadcastModal {...defaultProps} />);

    fireEvent.change(screen.getByLabelText('Subject'), {
      target: { value: 'Update for {{householdName}}' },
    });
    fireEvent.change(screen.getByLabelText('Message Body'), {
      target: { value: "Hi {{householdName}}, we can't wait!" },
    });

    // Switching to Live Preview tab automatically triggers previewBroadcast
    fireEvent.click(screen.getByRole('tab', { name: /Live Preview/i }));

    await waitFor(() => {
      expect(mockPreviewBroadcast).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Hi Sean O'Connor & Family, we can't wait!")).toBeInTheDocument();
    });
    expect(screen.queryByText(/&#39;|&amp;/)).not.toBeInTheDocument();
    expect(await axe(baseElement)).toHaveNoViolations();

    // Switch back to Compose, edit message body (making preview stale), and switch to Live Preview again
    fireEvent.click(screen.getByRole('tab', { name: /Compose Message/i }));
    fireEvent.change(screen.getByLabelText('Message Body'), {
      target: { value: "Revised: St. Mary's & Main Hall at 5 PM!" },
    });
    fireEvent.click(screen.getByRole('tab', { name: /Live Preview/i }));

    await waitFor(() => {
      expect(mockPreviewBroadcast).toHaveBeenCalledTimes(2);
      expect(screen.getByText("Revised: St. Mary's & Main Hall at 5 PM!")).toBeInTheDocument();
    });

    // Manual Refresh Preview control triggers fresh preview even without further edits
    fireEvent.click(screen.getByRole('button', { name: /Refresh Preview/i }));
    await waitFor(() => {
      expect(mockPreviewBroadcast).toHaveBeenCalledTimes(3);
      expect(screen.getByText("Refreshed: St. Mary's & Main Hall at 5 PM!")).toBeInTheDocument();
    });
  });

  it('shows live matched and missing-contact counts per channel and attaches View Delivery Logs toast action on send', async () => {
    const onViewDeliveryLogs = jest.fn();
    mockSendBroadcast.mockResolvedValueOnce({
      status: 'PARTIALLY_SENT',
      sentCount: 1,
      failedCount: 1,
    });

    const sampleGuests = [
      {
        id: 'g1',
        guestName: 'Alice EmailOnly',
        email: 'alice@example.com',
        used: false,
        partyGroup: 'Bride',
        extraFields: { attendanceStatus: 'pending' },
      },
      {
        id: 'g2',
        guestName: 'Bob PhoneOnly',
        email: null,
        used: false,
        partyGroup: 'Bride',
        extraFields: { attendanceStatus: 'pending', phone: '+15551234567' },
      },
      {
        id: 'g3',
        guestName: 'Charlie GroomGroup',
        email: 'charlie@example.com',
        used: false,
        partyGroup: 'Groom',
        extraFields: { attendanceStatus: 'pending', phone: '+15559876543' },
      },
      {
        id: 'g-public',
        guestName: 'Public Collector',
        email: 'pub@example.com',
        used: false,
        partyGroup: 'Bride',
        partyTags: ['address-collection'],
        extraFields: { attendanceStatus: 'pending' },
      },
    ];

    render(
      <BroadcastModal
        {...defaultProps}
        guests={sampleGuests}
        targetFilters={{ partyGroup: 'Bride', attendanceStatus: 'pending' }}
        onViewDeliveryLogs={onViewDeliveryLogs}
      />
    );

    // EMAIL channel: 2 matched guests (g1, g2; g-public excluded), 1 missing email (g2)
    expect(screen.getByTestId('broadcast-audience-counts')).toHaveTextContent('2 matched guests');
    expect(screen.getByTestId('broadcast-audience-counts')).toHaveTextContent('1 missing email');

    // Switch channel to SMS: 2 matched guests, 1 missing phone (g1)
    fireEvent.change(screen.getByLabelText('Channel'), { target: { value: 'SMS' } });
    expect(screen.getByTestId('broadcast-audience-counts')).toHaveTextContent('2 matched guests');
    expect(screen.getByTestId('broadcast-audience-counts')).toHaveTextContent('1 missing phone');

    // Dispatch SMS and verify toast includes View Delivery Logs action
    fireEvent.change(screen.getByLabelText('Message Body'), {
      target: { value: 'Shuttle leaves in 10 minutes!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send SMS' }));

    await waitFor(() => {
      expect(mockSendBroadcast).toHaveBeenCalledWith({
        channel: 'SMS',
        subject: undefined,
        body: 'Shuttle leaves in 10 minutes!',
        targetFilters: { partyGroup: 'Bride', attendanceStatus: 'pending' },
        scheduledFor: undefined,
      });
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.stringContaining('Broadcast dispatched!'),
        'info',
        undefined,
        undefined,
        expect.objectContaining({ label: 'View Delivery Logs' })
      );
    });

    const toastAction = mockAddToast.mock.calls[0][4];
    toastAction.onClick();
    expect(onViewDeliveryLogs).toHaveBeenCalledTimes(1);
  });

  it('queries countRecipients on the server for every filter state and displays 122 matched recipients instead of a 50-row slice', async () => {
    mockCountRecipients = jest
      .fn()
      .mockResolvedValueOnce({
        recipientCount: 122,
        matchedCount: 122,
        missingContactCount: 4,
      })
      .mockResolvedValueOnce({
        recipientCount: 80,
        matchedCount: 80,
        missingContactCount: 2,
      });

    const partialGuestsSlice = Array.from({ length: 50 }, (_, idx) => ({
      id: `g-${idx + 1}`,
      guestName: `Household ${idx + 1}`,
      email: `guest${idx + 1}@example.com`,
      used: false,
    }));

    render(<BroadcastModal {...defaultProps} guests={partialGuestsSlice} />);

    await waitFor(() => {
      expect(mockCountRecipients).toHaveBeenCalledWith(undefined);
      expect(screen.getByTestId('broadcast-audience-counts')).toHaveTextContent('122 matched guests');
      expect(screen.getByTestId('broadcast-audience-counts')).toHaveTextContent('4 missing email');
    });

    fireEvent.change(screen.getByLabelText('RSVP Status'), {
      target: { value: 'attending' },
    });

    await waitFor(() => {
      expect(mockCountRecipients).toHaveBeenCalledWith({ attendanceStatus: 'attending' });
      expect(screen.getByTestId('broadcast-audience-counts')).toHaveTextContent('80 matched guests');
    });
  });

  it('preselects initialTemplateId="formal-invitation" and renders the themed HTML stationery card in Live Preview', async () => {
    mockPreviewBroadcast.mockResolvedValueOnce({
      subject: 'Formal Invitation: Sarah & Dan',
      body: '[CARD:formal-invitation]\nDear Alice Smith,\n\nRSVP: https://wedding.example.com/guest?code=ALICE2026',
      htmlBody:
        '<div role="presentation"><h1>Sarah &amp; Dan</h1><a href="https://wedding.example.com/guest?code=ALICE2026">RSVP Online</a><a href="https://calendar.google.com/calendar/render?action=TEMPLATE">Google Calendar</a></div>',
      sampleGuestName: 'Alice Smith',
      destination: 'alice@example.com',
    });

    render(
      <BroadcastModal
        {...defaultProps}
        initialTemplateId="formal-invitation"
        selectedCount={1}
        targetFilters={{ selectedIds: ['g1'] }}
      />
    );

    expect(screen.getByRole('button', { name: 'Save the Date' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Formal Invitation' })).toBeInTheDocument();
    expect((screen.getByLabelText('Message Body') as HTMLTextAreaElement).value).toContain(
      '[CARD:formal-invitation]'
    );

    fireEvent.click(screen.getByRole('tab', { name: /Live Preview/i }));

    await waitFor(() => {
      expect(screen.getByTestId('broadcast-stationery-card-preview')).toBeInTheDocument();
    });
    const cardPreview = screen.getByTestId('broadcast-stationery-card-preview');
    expect(cardPreview).toHaveTextContent('Sarah & Dan');
    expect(cardPreview).toHaveTextContent('RSVP Online');
    expect(cardPreview).toHaveTextContent('Google Calendar');
  });

  it('updates Send Test button accessible name across default, custom destination, and busy Sending Test... states and passes jest-axe', async () => {
    const { rerender } = render(<BroadcastModal {...defaultProps} />);

    const dialog = screen.getByRole('dialog');
    const axeRules = { rules: { 'label-content-name-mismatch': { enabled: true } } };

    expect(screen.getByRole('button', { name: 'Send Test to Me' })).toBeInTheDocument();
    expect(await axe(dialog, axeRules)).toHaveNoViolations();

    fireEvent.change(screen.getByLabelText('Test Destination (Optional)'), {
      target: { value: 'planner@wedding.example' },
    });
    expect(screen.getByRole('button', { name: 'Send Test' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send Test to Me' })).not.toBeInTheDocument();
    expect(await axe(dialog, axeRules)).toHaveNoViolations();

    mockSendingTest = true;
    rerender(<BroadcastModal {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'Sending Test...' })).toBeDisabled();
    expect(await axe(dialog, axeRules)).toHaveNoViolations();
  });
});
