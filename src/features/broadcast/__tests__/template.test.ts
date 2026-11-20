import {
  AVAILABLE_TEMPLATE_PLACEHOLDERS,
  BROADCAST_STARTER_TEMPLATES,
  buildGuestRsvpUrl,
  renderBroadcastTemplate,
  sanitizeEmailSubject,
} from '../template';

describe('renderBroadcastTemplate', () => {
  const sampleContext = {
    guestName: 'Alice Smith',
    invitationCode: 'ALICE2026',
    householdName: 'Smith Family',
    weddingDate: 'October 25, 2026',
    venueName: 'Sunset Pavilion',
  };

  it('replaces all supported dynamic placeholders accurately', () => {
    const template = 'Dear {{guestName}}, your code is {{invitationCode}} for the {{householdName}} household. Event at {{venueName}} on {{weddingDate}}.';
    const result = renderBroadcastTemplate(template, sampleContext);

    expect(result).toBe(
      'Dear Alice Smith, your code is ALICE2026 for the Smith Family household. Event at Sunset Pavilion on October 25, 2026.'
    );
  });

  it('handles {{code}} alias for invitation code', () => {
    const template = 'Use code: {{code}}';
    const result = renderBroadcastTemplate(template, sampleContext);
    expect(result).toBe('Use code: ALICE2026');
  });

  it('leaves unrecognized placeholders intact or handles gracefully', () => {
    const template = 'Hello {{unknownKey}}, see you soon!';
    const result = renderBroadcastTemplate(template, sampleContext);
    expect(result).toBe('Hello {{unknownKey}}, see you soon!');
  });

  it('returns empty string if template is empty', () => {
    expect(renderBroadcastTemplate('', sampleContext)).toBe('');
  });

  it('escapes &, <, >, ", and \' in placeholder values when escapeHtml is true while preserving template HTML', () => {
    const htmlTemplate = '<p>Dear {{guestName}} ({{householdName}}), code: {{code}}</p>';
    const unsafeContext = {
      guestName: '<b data-canary="guest-html-marker">O\'Connor & "Friends"</b>',
      invitationCode: 'CODE<1>&"2"\'3\'',
      householdName: '<i data-canary="household-html-marker">O\'Connor & Family</i>',
    };

    const result = renderBroadcastTemplate(htmlTemplate, unsafeContext, { escapeHtml: true });

    expect(result).toBe(
      '<p>Dear &lt;b data-canary=&quot;guest-html-marker&quot;&gt;O&#39;Connor &amp; &quot;Friends&quot;&lt;/b&gt; (&lt;i data-canary=&quot;household-html-marker&quot;&gt;O&#39;Connor &amp; Family&lt;/i&gt;), code: CODE&lt;1&gt;&amp;&quot;2&quot;&#39;3&#39;</p>'
    );
    expect(result).not.toContain('<b data-canary=');
    expect(result).not.toContain('<i data-canary=');
  });

  it('leaves placeholder values unescaped when escapeHtml is false or omitted (e.g. SMS plain text)', () => {
    const smsTemplate = 'Hi {{guestName}} ({{householdName}})!';
    const context = {
      guestName: "Sean O'Connor",
      invitationCode: 'SEAN2026',
      householdName: "O'Connor & Family",
    };

    expect(renderBroadcastTemplate(smsTemplate, context)).toBe(
      "Hi Sean O'Connor (O'Connor & Family)!"
    );
    expect(renderBroadcastTemplate(smsTemplate, context, { escapeHtml: false })).toBe(
      "Hi Sean O'Connor (O'Connor & Family)!"
    );
  });
});

describe('sanitizeEmailSubject', () => {
  it('strips CR, LF, and angle brackets while preserving apostrophes and ampersands', () => {
    const rawSubject = "Event update for <b data-canary=\"m\">O'Connor & Family</b>\r\nBcc: attacker@example.invalid";
    const sanitized = sanitizeEmailSubject(rawSubject);

    expect(sanitized).toBe('Event update for b data-canary="m"O\'Connor & Family/bBcc: attacker@example.invalid');
    expect(sanitized).not.toMatch(/[\r\n<>]/);
  });
});

describe('{{rsvpUrl}} placeholder and BROADCAST_STARTER_TEMPLATES', () => {
  it('builds encoded personalized RSVP URLs and strips trailing slashes', () => {
    expect(buildGuestRsvpUrl('https://wedding.example.com/', 'ALICE 2026+1')).toBe(
      'https://wedding.example.com/guest?code=ALICE%202026%2B1'
    );
    expect(buildGuestRsvpUrl('', 'ALICE2026')).toBe('/guest?code=ALICE2026');
  });

  it('registers {{rsvpUrl}} in AVAILABLE_TEMPLATE_PLACEHOLDERS and resolves it in EMAIL and SMS templates', () => {
    expect(AVAILABLE_TEMPLATE_PLACEHOLDERS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ placeholder: '{{rsvpUrl}}' }),
      ])
    );

    const ctx = {
      guestName: 'Alice Smith',
      invitationCode: 'ALICE&2026',
      baseUrl: 'https://wedding.example.com',
    };

    const emailBody = renderBroadcastTemplate(
      '<p>Hi {{guestName}}, RSVP at <a href="{{rsvpUrl}}">{{rsvpUrl}}</a></p>',
      ctx,
      { escapeHtml: true }
    );
    expect(emailBody).toBe(
      '<p>Hi Alice Smith, RSVP at <a href="https://wedding.example.com/guest?code=ALICE%262026">https://wedding.example.com/guest?code=ALICE%262026</a></p>'
    );

    const smsBody = renderBroadcastTemplate('Hi {{guestName}}: {{rsvpUrl}}', ctx);
    expect(smsBody).toBe(
      'Hi Alice Smith: https://wedding.example.com/guest?code=ALICE%262026'
    );
  });

  it('provides starter templates for RSVP reminders, final RSVP calls, sub-event updates, and mailing address requests with {{guestName}} and {{rsvpUrl}}', () => {
    const templateIds = BROADCAST_STARTER_TEMPLATES.map((t) => t.id);
    expect(templateIds).toEqual([
      'rsvp-reminder',
      'final-rsvp-call',
      'sub-event-update',
      'mailing-address-request',
    ]);

    for (const tpl of BROADCAST_STARTER_TEMPLATES) {
      expect(tpl.subject.trim().length).toBeGreaterThan(0);
      expect(tpl.emailBody).toContain('{{guestName}}');
      expect(tpl.emailBody).toContain('{{rsvpUrl}}');
      expect(tpl.smsBody).toContain('{{guestName}}');
      expect(tpl.smsBody).toContain('{{rsvpUrl}}');
    }
  });
});

