import LegacyButton, { legacyHelper } from '@/components/ui/LegacyButton';

export function test() {
  const h = legacyHelper();
  return { LegacyButton, h };
}
