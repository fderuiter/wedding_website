import { generateSecureUUID } from '../uuid';

describe('generateSecureUUID', () => {
  it('generates a valid v4 UUID string format', () => {
    const uuid = generateSecureUUID();
    
    // UUID v4 regex: 8-4-4-4-12 hex characters with a '4' at the start of the 3rd group
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(uuid).toMatch(uuidRegex);
  });

  it('generates unique UUIDs on subsequent calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateSecureUUID());
    }
    expect(ids.size).toBe(100);
  });
});
