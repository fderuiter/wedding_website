import { rateLimit } from '../rateLimit';
test('rateLimit exports a function', () => {
  expect(typeof rateLimit).toBe('function');
});
