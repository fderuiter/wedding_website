import {
  AVAILABLE_TEMPLATE_PLACEHOLDERS,
  BROADCAST_STARTER_TEMPLATES,
  buildGuestRsvpUrl,
  escapeHtmlEntities,
  isStationeryCardBody,
  parseStationeryCardDirective,
  renderBroadcastTemplate,
  renderStationeryCardHtml,
  sanitizeEmailSubject,
  stripStationeryCardDirective,
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

describe('escapeHtmlEntities', () => {
  it('escapes HTML entities in untrusted text', () => {
    expect(escapeHtmlEntities('<script>alert("O\'Connor & Co")</script>')).toBe(
      '&lt;script&gt;alert(&quot;O&#39;Connor &amp; Co&quot;)&lt;/script&gt;'
    );
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

  it('provides starter templates including Save the Date and Formal Invitation alongside RSVP and address templates with {{guestName}} and {{rsvpUrl}}', () => {
    const templateIds = BROADCAST_STARTER_TEMPLATES.map((t) => t.id);
    expect(templateIds).toEqual([
      'save-the-date',
      'formal-invitation',
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

  it('parses [CARD:...] directives and renders accessible themed HTML stationery cards with calendar links and RSVP button', () => {
    const saveDateTpl = BROADCAST_STARTER_TEMPLATES.find((t) => t.id === 'save-the-date')!;
    const formalTpl = BROADCAST_STARTER_TEMPLATES.find((t) => t.id === 'formal-invitation')!;

    expect(isStationeryCardBody(saveDateTpl.emailBody)).toBe(true);
    expect(isStationeryCardBody(formalTpl.emailBody)).toBe(true);
    expect(isStationeryCardBody('Plain paragraph body')).toBe(false);

    const stripped = stripStationeryCardDirective('[CARD:save-the-date]\nHello Alice!');
    expect(stripped).toBe('Hello Alice!');

    const renderedBody = renderBroadcastTemplate(
      formalTpl.emailBody,
      {
        guestName: 'Alice & <script>bad()</script>',
        householdName: 'Smith Family',
        invitationCode: 'ALICE2026',
        coupleNames: 'Sarah & Dan',
        weddingDate: 'October 25, 2026',
        venueName: 'Sunset Pavilion',
        venueLocation: '123 Ocean View Dr, Monterey, CA',
        baseUrl: 'https://wedding.example.com',
      },
      { escapeHtml: true }
    );

    const parsed = parseStationeryCardDirective(renderedBody);
    expect(parsed?.variant).toBe('formal-invitation');

    const cardHtml = renderStationeryCardHtml(parsed!.variant, parsed!.content, {
      partner1Name: 'Sarah',
      partner2Name: 'Dan',
      weddingDate: new Date('2026-10-25T17:00:00Z'),
      venueName: 'Sunset Pavilion',
      venueAddress: '123 Ocean View Dr',
      venueCity: 'Monterey',
      venueState: 'CA',
      colorPrimary: '#1F3A52',
      colorSecondary: '#C49A45',
    });

    expect(cardHtml).toContain('Sarah &amp; Dan');
    expect(cardHtml).toContain('Sunset Pavilion');
    expect(cardHtml).toContain('123 Ocean View Dr, Monterey, CA');
    expect(cardHtml).toContain('https://calendar.google.com/calendar/render');
    expect(cardHtml).toContain('https://outlook.live.com/calendar/');
    expect(cardHtml).toContain('https://calendar.yahoo.com/');
    expect(cardHtml).toContain('href="https://wedding.example.com/guest?code=ALICE2026"');
    expect(cardHtml).toContain('RSVP &amp; View Invitation');
    expect(cardHtml).not.toContain('<script>');
  });

  it('filters unsafe baseUrl and rsvpUrl schemes via sanitizeUrl before rendering href attributes', () => {
    for (const unsafeBaseUrl of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'mailto:attacker@example.com',
      '//evil.example.com',
    ]) {
      expect(buildGuestRsvpUrl(unsafeBaseUrl, 'GUEST26')).toBe(
        '/guest?code=GUEST26'
      );

      const emailHtml = renderBroadcastTemplate(
        '<a href="{{rsvpUrl}}">RSVP</a>',
        {
          guestName: 'Alice',
          invitationCode: 'GUEST26',
          baseUrl: unsafeBaseUrl,
        },
        { escapeHtml: true }
      );
      expect(emailHtml).toBe('<a href="/guest?code=GUEST26">RSVP</a>');
    }

    const explicitUnsafeRsvpHtml = renderBroadcastTemplate(
      '<a href="{{rsvpUrl}}">RSVP</a>',
      {
        guestName: 'Alice',
        invitationCode: 'GUEST26',
        rsvpUrl: 'javascript:alert("xss")',
      },
      { escapeHtml: true }
    );
    expect(explicitUnsafeRsvpHtml).toBe('<a href="/guest">RSVP</a>');

    const unsafeCardHtml = renderStationeryCardHtml(
      'save-the-date',
      'We cannot wait to celebrate with you!',
      {
        partner1Name: 'Sarah',
        partner2Name: 'Dan',
        baseUrl: 'javascript:alert(1)',
        rsvpUrl: 'javascript:alert("card-xss")',
      }
    );
    expect(unsafeCardHtml).toContain('href="/guest"');
    expect(unsafeCardHtml).not.toContain('javascript:');
  });

  it('formats stationery card display date and calendar links in config.timezone for healed legacy and evening ceremonies', () => {
    const legacyChicagoCard = renderStationeryCardHtml(
      'save-the-date',
      'Save our date!',
      {
        partner1Name: 'Maya',
        partner2Name: 'Liam',
        weddingDate: new Date('2027-06-20T00:00:00.000Z'),
        timezone: 'America/Chicago',
        venueName: 'The Rookery',
        venueCity: 'Chicago',
        venueState: 'IL',
        baseUrl: 'https://mayaliam.example.com',
      }
    );
    expect(legacyChicagoCard).toContain('June 20, 2027');
    expect(legacyChicagoCard).not.toContain('June 19, 2027');
    expect(legacyChicagoCard).toContain('20270620T160000%2F20270620T220000');

    const eveningLaCard = renderStationeryCardHtml(
      'formal-invitation',
      'Join us for an evening ceremony!',
      {
        partner1Name: 'Maya',
        partner2Name: 'Liam',
        weddingDate: new Date('2027-06-21T02:30:00.000Z'),
        timezone: 'America/Los_Angeles',
        venueName: 'Sunset Cliff Estate',
        venueCity: 'Malibu',
        venueState: 'CA',
        baseUrl: 'https://mayaliam.example.com',
      }
    );
    expect(eveningLaCard).toContain('June 20, 2027');
    expect(eveningLaCard).not.toContain('June 21, 2027');
    expect(eveningLaCard).toContain('20270620T193000%2F20270621T013000');
  });
});
