import { validateContributeInput, validateAddItemInput } from '../validation';

describe('validateContributeInput', () => {
  const cases: Array<{ name: string; input: unknown; expected: string | null }> = [
    {
      name: 'valid payload for group gift contribution',
      input: { itemId: '1', name: 'Alice', amount: 100 },
      expected: null,
    },
    {
      name: 'invalid request body',
      input: null,
      expected: 'Invalid request body.',
    },
    {
      name: 'missing itemId',
      input: { name: 'Alice', amount: 100 },
      expected: 'Missing or invalid itemId.',
    },
    {
      name: 'missing name',
      input: { itemId: '1', amount: 100 },
      expected: 'Name is required.',
    },
    {
      name: 'invalid amount (negative)',
      input: { itemId: '1', name: 'Alice', amount: -5 },
      expected: 'Contribution amount must be a positive number.',
    },
    {
      name: 'invalid amount (Infinity)',
      input: { itemId: '1', name: 'Alice', amount: Infinity },
      expected: 'Contribution amount must be a positive number.',
    },
    {
      name: 'empty name',
      input: { itemId: '1', name: '  ', amount: 100 },
      expected: 'Name is required.',
    }
  ];

  test.each(cases)('$name', ({ input, expected }) => {
    expect(validateContributeInput(input)).toBe(expected);
  });
});

describe('validateAddItemInput', () => {
  const cases: Array<{ name: string; input: unknown; expected: string | null }> = [
    {
      name: 'valid payload',
      input: { name: 'Toaster', price: 100, quantity: 1, category: 'Kitchen' },
      expected: null,
    },
    {
      name: 'invalid request body',
      input: null,
      expected: 'Invalid request body.',
    },
    {
      name: 'missing name',
      input: { price: 100, quantity: 1, category: 'Kitchen' },
      expected: 'Item name is required.',
    },
    {
      name: 'invalid price (negative)',
      input: { name: 'Toaster', price: -1, quantity: 1, category: 'Kitchen' },
      expected: 'Price must be a positive number.',
    },
    {
      name: 'invalid price (Infinity)',
      input: { name: 'Toaster', price: Infinity, quantity: 1, category: 'Kitchen' },
      expected: 'Price must be a positive number.',
    },
    {
      name: 'invalid quantity (zero)',
      input: { name: 'Toaster', price: 100, quantity: 0, category: 'Kitchen' },
      expected: 'Quantity must be a positive integer.',
    },
    {
      name: 'invalid quantity (float)',
      input: { name: 'Toaster', price: 100, quantity: 1.5, category: 'Kitchen' },
      expected: 'Quantity must be a positive integer.',
    },
    {
      name: 'missing category',
      input: { name: 'Toaster', price: 100, quantity: 1 },
      expected: 'Category is required.',
    },
  ];

  test.each(cases)('$name', ({ input, expected }) => {
    expect(validateAddItemInput(input)).toBe(expected);
  });
});
