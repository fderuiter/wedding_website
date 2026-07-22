import { withApiMiddleware } from '../withApiMiddleware';
test('withApiMiddleware exports a function', () => {
  expect(typeof withApiMiddleware).toBe('function');
});
