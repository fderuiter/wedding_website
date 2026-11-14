import { generateSecureUUID } from '../uuid';

describe('generateSecureUUID', () => {
  it('generates a valid v4 UUID string format conforming to RFC 4122', () => {
    const uuid = generateSecureUUID();
    
    // RFC 4122 UUID v4 regex: 8-4-4-4-12 hex characters with a '4' at the start of the 3rd group
    // and variant '8', '9', 'a', or 'b' at the start of the 4th group
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(uuid).toMatch(uuidRegex);
  });

  it('delegates to native crypto.randomUUID', () => {
    const spy = jest.spyOn(crypto, 'randomUUID');
    const result = generateSecureUUID();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(typeof result).toBe('string');
    spy.mockRestore();
  });

  it('generates unique UUIDs on subsequent calls without collisions', () => {
    const count = 1000;
    const ids = new Set<string>();
    for (let i = 0; i < count; i++) {
      ids.add(generateSecureUUID());
    }
    expect(ids.size).toBe(count);
  });
});
