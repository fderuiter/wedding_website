import LegacyButton, { legacyHelper } from '@/components/ui/LegacyButton';

export function test() {
  const h = legacyHelper();
  return { LegacyButton, h };
}

describe('importLegacyButton', () => {
  it('should import legacy helper', () => {
    expect(test()).toBeDefined();
  });
});

