import { getGuestPhone, hasBroadcastChannelContact } from '../audience';

describe('Broadcast Audience Phone Resolution', () => {
  it('reads canonical phone, mobile, phoneNumber, and legacy Phone Number keys', () => {
    expect(getGuestPhone({ extraFields: { phone: '+15551112222' } })).toBe('+15551112222');
    expect(getGuestPhone({ extraFields: { mobile: '+15552223333' } })).toBe('+15552223333');
    expect(getGuestPhone({ extraFields: { phoneNumber: '+15553334444' } })).toBe('+15553334444');
    expect(getGuestPhone({ extraFields: { 'Phone Number': '+15554445555' } })).toBe('+15554445555');
    expect(getGuestPhone({ extraFields: { 'Phone Number': "'+15556667777" } })).toBe('+15556667777');
    expect(getGuestPhone({ extraFields: JSON.stringify({ 'Phone Number': '+15558889999' }) })).toBe(
      '+15558889999'
    );
  });

  it('marks SMS broadcast channel contact available when legacy Phone Number key is populated', () => {
    expect(
      hasBroadcastChannelContact({ extraFields: { 'Phone Number': '+15554445555' } }, 'SMS')
    ).toBe(true);
    expect(
      hasBroadcastChannelContact({ extraFields: { phoneNumber: '+15553334444' } }, 'SMS')
    ).toBe(true);
    expect(hasBroadcastChannelContact({ extraFields: {} }, 'SMS')).toBe(false);
  });
});
