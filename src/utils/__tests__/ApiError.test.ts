import { ApiError } from '../ApiError';

test('ApiError can be instantiated', () => {
  const error = new ApiError(400, 'Test');
  expect(error.message).toBe('Test');
  expect(error.statusCode).toBe(400);
  expect(error.status).toBe(400);
  expect(error.data).toBeUndefined();
});

test('ApiError supports optional data payload', () => {
  const dataPayload = { reason: 'invalid_credentials', attemptsLeft: 3 };
  const error = new ApiError(401, 'Unauthorized Attempt', dataPayload);
  expect(error.message).toBe('Unauthorized Attempt');
  expect(error.statusCode).toBe(401);
  expect(error.status).toBe(401);
  expect(error.data).toEqual(dataPayload);
});
