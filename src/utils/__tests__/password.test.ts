import { verifyPassword } from '../password';
test('verifyPassword exports a function', () => {
  expect(typeof verifyPassword).toBe('function');
});
