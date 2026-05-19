import { validateContributeInput, validateAddItemInput } from '../validation';

describe('validateContributeInput', () => {
  const validContributePayload = {
    itemId: '123-abc',
    name: 'Jane Doe',
    amount: 50,
  };

  const cases = [
    {
      name: 'valid payload for group gift contribution',
      input: validContributePayload,
      expected: null,
    },
    {
      name: 'invalid request body',
      input: null,
      expected: 'Invalid request body.',
    },
    {
      name: 'missing itemId',
      input: { ...validContributePayload, itemId: '' },
      expected: 'Missing or invalid itemId.',
    },
    {
      name: 'missing name',
      input: { ...validContributePayload, name: undefined },
      expected: 'Name is required and must be under 100 characters.',
    },
    {
      name: 'invalid amount (negative)',
      input: { ...validContributePayload, amount: -10 },
      expected: 'Contribution amount must be a positive number.',
    },
    {
      name: 'invalid amount (Infinity)',
      input: { ...validContributePayload, amount: Infinity },
      expected: 'Contribution amount must be a positive number.',
    },
    {
      name: 'empty name',
      input: { ...validContributePayload, name: '  ' },
      expected: 'Name is required and must be under 100 characters.',
    },
  ];

  test.each(cases)('$name', ({ input, expected }) => {
    expect(validateContributeInput(input)).toBe(expected);
  });
});

describe('validateAddItemInput', () => {
  const validAddItemPayload = {
    name: 'Fancy Blender',
    price: 150.00,
    quantity: 1,
    category: 'Kitchen',
  };

  const cases = [
    {
      name: 'valid payload',
      input: validAddItemPayload,
      expected: null,
    },
    {
      name: 'invalid request body',
      input: 'not an object',
      expected: 'Invalid request body.',
    },
    {
      name: 'missing name',
      input: { ...validAddItemPayload, name: '' },
      expected: 'Item name is required and must be under 255 characters.',
    },
    {
      name: 'invalid price (negative)',
      input: { ...validAddItemPayload, price: -50 },
      expected: 'Price must be a positive number.',
    },
    {
      name: 'invalid price (Infinity)',
      input: { ...validAddItemPayload, price: Infinity },
      expected: 'Price must be a positive number.',
    },
    {
      name: 'invalid quantity (zero)',
      input: { ...validAddItemPayload, quantity: 0 },
      expected: 'Quantity must be a positive integer.',
    },
    {
      name: 'invalid quantity (float)',
      input: { ...validAddItemPayload, quantity: 1.5 },
      expected: 'Quantity must be a positive integer.',
    },
    {
      name: 'missing category',
      input: { ...validAddItemPayload, category: '   ' },
      expected: 'Category is required and must be under 255 characters.',
    },
  ];

  test.each(cases)('$name', ({ input, expected }) => {
    expect(validateAddItemInput(input)).toBe(expected);
  });
});
