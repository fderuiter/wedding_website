import { ApiError } from '../ApiError';
test('ApiError can be instantiated', () => {
  const error = new ApiError(400, 'Test');
  expect(error.message).toBe('Test');
  expect(error.statusCode).toBe(400);
});
