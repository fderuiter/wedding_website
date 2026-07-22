import { formatCurrency } from '../intl';
test('formatCurrency formats money', () => {
  expect(formatCurrency(100)).toBeDefined();
});
