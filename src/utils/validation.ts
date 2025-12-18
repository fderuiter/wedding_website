// Centralized validation utility for registry API endpoints

/**
 * Validates if a value is a non-empty string.
 * @param {unknown} value - The value to check.
 * @returns {boolean} True if valid, false otherwise.
 */
function isValidString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validates if a value is a positive finite number.
 * @param {unknown} value - The value to check.
 * @returns {boolean} True if valid, false otherwise.
 */
function isValidPositiveNumber(value: unknown): boolean {
  return typeof value === 'number' && !isNaN(value) && Number.isFinite(value) && value > 0;
}

/**
 * Validates if a value is a positive integer.
 * @param {unknown} value - The value to check.
 * @returns {boolean} True if valid, false otherwise.
 */
function isValidPositiveInteger(value: unknown): boolean {
  return isValidPositiveNumber(value) && Number.isInteger(value);
}

/**
 * Validates the input for a contribution to a registry item.
 * @param {unknown} input - The input data to validate.
 * @returns {string | null} An error message if validation fails, otherwise null.
 */
export function validateContributeInput(input: unknown): string | null {
  if (!input || typeof input !== 'object') return 'Invalid request body.';

  const data = input as Record<string, unknown>;

  if (!isValidString(data.itemId)) return 'Missing or invalid itemId.';
  if (!isValidString(data.name)) return 'Name is required.';
  if (!isValidPositiveNumber(data.amount)) return 'Contribution amount must be a positive number.';

  return null;
}

/**
 * Validates the input for adding a new registry item.
 * @param {unknown} input - The input data to validate.
 * @returns {string | null} An error message if validation fails, otherwise null.
 */
export function validateAddItemInput(input: unknown): string | null {
  if (!input || typeof input !== 'object') return 'Invalid request body.';

  const data = input as Record<string, unknown>;

  if (!isValidString(data.name)) return 'Item name is required.';
  if (!isValidPositiveNumber(data.price)) return 'Price must be a positive number.';
  if (!isValidPositiveInteger(data.quantity)) return 'Quantity must be a positive integer.';
  if (!isValidString(data.category)) return 'Category is required.';
  // Optional: image, vendorUrl, isGroupGift

  return null;
}
