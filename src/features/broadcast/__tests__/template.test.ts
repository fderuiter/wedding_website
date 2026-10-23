import { renderBroadcastTemplate } from '../template';

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
});
