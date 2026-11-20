import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe } from 'jest-axe';
import {
  GuestHelpModal,
  GuestHelpProvider,
  GuestHelpTrigger,
  getSafeHostEmailLink,
  getSafeHostPhoneLink,
  resolveHelpCategoryForPath,
  sanitizeConfigText,
  useGuestHelp,
  type GuestHelpCategory,
  type GuestHelpConfig,
  type GuestHelpModalProps,
  type GuestHelpProviderProps,
  type GuestHelpTriggerProps,
} from '../GuestHelpModal';

describe('GuestHelpModal sanitization helpers', () => {
  it('strips HTML tags, angle brackets, URI schemes, and control characters from config strings', () => {
    expect(sanitizeConfigText('  <script>alert("xss")</script>Alex\r\n  ')).toBe('alert("xss")Alex');
    expect(sanitizeConfigText('Taylor <img src=x onerror=alert(1)>')).toBe('Taylor');
    expect(sanitizeConfigText('javascript:alert(1)')).toBe('alert(1)');
    expect(sanitizeConfigText(null)).toBe('');
  });

  it('validates and builds safe mailto links while rejecting XSS payloads', () => {
    const valid = getSafeHostEmailLink('  hosts@example.com  ');
    expect(valid).toEqual({
      email: 'hosts@example.com',
      href: 'mailto:hosts@example.com?subject=Wedding%20Guest%20Question',
    });

    expect(getSafeHostEmailLink('javascript:alert(1)')).toBeNull();
    expect(getSafeHostEmailLink('bad"onclick="alert(1)@example.com')).toBeNull();
    expect(getSafeHostEmailLink('<script>@example.com')).toBeNull();
    expect(getSafeHostEmailLink('')).toBeNull();
  });

  it('validates and builds safe tel links while rejecting unsafe strings', () => {
    const valid = getSafeHostPhoneLink('+1 (555) 234-5678');
    expect(valid).toEqual({
      displayPhone: '+1 (555) 234-5678',
      href: 'tel:+15552345678',
    });

    expect(getSafeHostPhoneLink('javascript:alert(1)')).toBeNull();
    expect(getSafeHostPhoneLink('123')).toBeNull();
    expect(getSafeHostPhoneLink('<svg onload=alert(1)>5551234567')).toBeNull();
  });

  it('resolves contextual help categories from route pathnames', () => {
    const categories: GuestHelpCategory[] = [
      resolveHelpCategoryForPath('/guest'),
      resolveHelpCategoryForPath('/guest/collect'),
      resolveHelpCategoryForPath('/registry'),
      resolveHelpCategoryForPath('/'),
      resolveHelpCategoryForPath(undefined),
    ];
    expect(categories).toEqual(['passcode', 'passcode', 'registry', 'dietary', 'passcode']);
  });
});

describe('GuestHelpModal component & WAI-ARIA compliance', () => {
  const sampleConfig: GuestHelpConfig = {
    partner1Name: 'Alex',
    partner2Name: 'Taylor',
    contactEmail: 'couple@example.com',
    twilioFromNumber: '+1 (555) 867-5309',
  };

  it('opens on trigger click, moves focus to first interactive element, traps Tab focus, and returns focus on Escape', async () => {
    const providerProps: GuestHelpProviderProps = {
      config: sampleConfig,
      pathname: '/guest',
      children: null,
    };
    const triggerProps: GuestHelpTriggerProps = {
      label: 'Need Help?',
      defaultCategory: 'passcode',
    };

    render(
      <GuestHelpProvider {...providerProps}>
        <GuestHelpTrigger {...triggerProps} />
      </GuestHelpProvider>
    );

    const trigger = screen.getByRole('button', { name: /Need Help\?/i });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: /Guest Help & Support/i });
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    // Focus moves immediately to the first interactive element inside the dialog
    const closeIconBtn = within(dialog).getByRole('button', { name: /Close guest help/i });
    expect(document.activeElement).toBe(closeIconBtn);

    // Verify Shift+Tab from first focusable wraps to last focusable button
    const footerCloseBtn = within(dialog).getByRole('button', { name: /^Close$/i });
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(footerCloseBtn);

    // Verify forward Tab from last focusable wraps back to first focusable
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: false });
    expect(document.activeElement).toBe(closeIconBtn);

    // Pressing Escape closes the modal and returns focus to the initiating trigger
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('renders passcode, dietary, and registry tabs with keyboard roving navigation', () => {
    const modalProps: GuestHelpModalProps = {
      isOpen: true,
      onClose: jest.fn(),
      initialCategory: 'passcode',
      config: sampleConfig,
    };

    render(<GuestHelpModal {...modalProps} />);

    const passcodeTab = screen.getByRole('tab', { name: /Invitation Code/i });
    const dietaryTab = screen.getByRole('tab', { name: /RSVP & Dietary/i });
    const registryTab = screen.getByRole('tab', { name: /Registry & Gifts/i });

    expect(passcodeTab).toHaveAttribute('aria-selected', 'true');
    expect(passcodeTab).toHaveAttribute('tabindex', '0');
    expect(dietaryTab).toHaveAttribute('tabindex', '-1');

    // Passcode guidance covers physical envelopes and digital announcements
    expect(screen.getByText(/Physical envelopes & paper mailers/i)).toBeInTheDocument();
    expect(screen.getByText(/Digital announcements & emails/i)).toBeInTheDocument();

    // ArrowRight moves to RSVP & Dietary tab
    fireEvent.keyDown(passcodeTab, { key: 'ArrowRight' });
    expect(dietaryTab).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(dietaryTab);
    expect(screen.getByText(/Event RSVPs & Severe Allergy Notes/i)).toBeInTheDocument();
    expect(screen.getByText(/Dietary Requirements \/ Notes/i)).toBeInTheDocument();

    // End moves to Registry & Gifts tab
    fireEvent.keyDown(dietaryTab, { key: 'End' });
    expect(registryTab).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(registryTab);
    expect(screen.getByText(/Wedding Registry & Gift Questions/i)).toBeInTheDocument();

    // Home returns to Invitation Code tab
    fireEvent.keyDown(registryTab, { key: 'Home' });
    expect(passcodeTab).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(passcodeTab);
  });

  it('renders host email and telephone links from configuration and fallback when absent', () => {
    const { rerender } = render(
      <GuestHelpModal isOpen={true} onClose={jest.fn()} config={sampleConfig} />
    );

    const emailLink = screen.getByRole('link', { name: /couple@example\.com/i });
    expect(emailLink).toHaveAttribute(
      'href',
      'mailto:couple@example.com?subject=Wedding%20Guest%20Question'
    );

    const phoneLink = screen.getByRole('link', { name: /\+1 \(555\) 867-5309/i });
    expect(phoneLink).toHaveAttribute('href', 'tel:+15558675309');

    rerender(<GuestHelpModal isOpen={true} onClose={jest.fn()} config={{}} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(
      screen.getByText(/contact the couple directly using the email address or phone number/i)
    ).toBeInTheDocument();
  });

  it('sanitizes malicious configuration strings and supports programmatic useGuestHelp hook', () => {
    function CustomConsumer() {
      const { openHelp } = useGuestHelp();
      return (
        <button type="button" onClick={() => openHelp('dietary')}>
          Open Dietary Help
        </button>
      );
    }

    render(
      <GuestHelpProvider
        config={{
          partner1Name: '<img src=x onerror=alert(1)>Jordan',
          partner2Name: '<script>evil()</script>Casey',
          contactEmail: 'javascript:alert(1)',
          twilioFromNumber: 'javascript:alert(2)',
        }}
      >
        <CustomConsumer />
      </GuestHelpProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /Open Dietary Help/i }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.innerHTML).not.toContain('<script>');
    expect(dialog.innerHTML).not.toContain('<img');
    expect(within(dialog).getByText(/Jordan & evil\(\)Casey's celebration/i)).toBeInTheDocument();
    expect(within(dialog).queryByRole('link')).not.toBeInTheDocument();
  });

  it('passes automated jest-axe WCAG 2.1 AA accessibility checks across tabs', async () => {
    const { container } = render(
      <GuestHelpModal isOpen={true} onClose={jest.fn()} config={sampleConfig} />
    );

    expect(await axe(container)).toHaveNoViolations();

    fireEvent.click(screen.getByRole('tab', { name: /RSVP & Dietary/i }));
    expect(await axe(container)).toHaveNoViolations();

    fireEvent.click(screen.getByRole('tab', { name: /Registry & Gifts/i }));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('displays the formatted active RSVP deadline while open and shows closed guidance linking to host contacts once RSVPs close', async () => {
    const { container, rerender } = render(
      <GuestHelpModal
        isOpen={true}
        onClose={jest.fn()}
        initialCategory="dietary"
        config={{
          ...sampleConfig,
          rsvpOpen: true,
          isRsvpOpen: true,
          rsvpDeadlineDate: '2026-08-15',
          timezone: 'America/Chicago',
        }}
      />
    );

    expect(screen.getByText(/RSVP deadline & updating responses/i)).toBeInTheDocument();
    expect(screen.getByText(/August 15, 2026 \(midnight in America\/Chicago\)/i)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    rerender(
      <GuestHelpModal
        isOpen={true}
        onClose={jest.fn()}
        initialCategory="dietary"
        config={{
          ...sampleConfig,
          rsvpOpen: false,
          isRsvpOpen: false,
          rsvpClosedMessage: '<script>xss()</script>RSVPs are now closed — reach out to us directly!',
          timezone: 'America/Chicago',
        }}
      />
    );

    expect(
      screen.getByText(/Online RSVPs Are Closed — Host Contact Guidance/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/xss\(\)RSVPs are now closed — reach out to us directly!/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Need to update a closed RSVP\? Contact the hosts/i)
    ).toBeInTheDocument();

    const jumpLink = screen.getByRole('link', { name: /Contact the hosts below/i });
    expect(jumpLink.getAttribute('href')).toMatch(/^#help-contacts-/);
    expect(screen.getByRole('link', { name: /couple@example\.com/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /\+1 \(555\) 867-5309/i })).toBeInTheDocument();

    expect(await axe(container)).toHaveNoViolations();
  });

  it('propagates live RSVP closed config overrides from GuestHelpTrigger to GuestHelpProvider', () => {
    render(
      <GuestHelpProvider
        pathname="/guest"
        config={{ ...sampleConfig, rsvpOpen: true, isRsvpOpen: true }}
      >
        <GuestHelpTrigger
          defaultCategory="dietary"
          label="Host Contact Details & Help"
          config={{
            rsvpOpen: false,
            isRsvpOpen: false,
            rsvpClosedMessage: 'Online RSVPs closed at midnight.',
            timezone: 'America/Chicago',
          }}
        />
      </GuestHelpProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /Host Contact Details & Help/i }));

    expect(screen.getByTestId('help-modal-rsvp-closed')).toBeInTheDocument();
    expect(screen.getByText('Online RSVPs closed at midnight.')).toBeInTheDocument();
  });
});
