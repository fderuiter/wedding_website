// Centralized validation utility for registry API endpoints

/**
 * Validates if a value is a non-empty string and does not exceed a maximum length.
 * @param {unknown} value - The value to check.
 * @param {number} [maxLength=255] - The maximum allowed length for the string.
 * @returns {boolean} True if valid, false otherwise.
 */
function isValidString(value: unknown, maxLength: number = 255): boolean {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

/**
 * Validates if a value is a positive finite number.
 * @param {unknown} value - The value to check.
 * @returns {boolean} True if valid, false otherwise.
 */
export function isValidPositiveNumber(value: unknown): boolean {
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
  if (!isValidString(data.name, 100)) return 'Name is required and must be under 100 characters.';
  if (!isValidPositiveNumber(data.amount)) return 'Contribution amount must be a positive number.';

  return null;
}

/**
 * Validates the input for adding a new registry item.
 * @param {unknown} input - The input data to validate.
 * @returns {string | null} An error message if validation fails, otherwise null.
 */
export function validateContentNodeInput(input: unknown): string | null {
  if (!input || typeof input !== 'object') return 'Invalid request body.';
  const data = input as Record<string, unknown>;

  if (!isValidString(data.type, 100)) return 'Type is required and must be under 100 characters.';
  if (!Array.isArray(data.tags)) return 'Tags must be an array of strings.';
  for (const tag of data.tags) {
    if (!isValidString(tag, 100)) return 'Each tag must be a string under 100 characters.';
  }

  if (typeof data.data !== 'object' || data.data === null) return 'Data must be an object.';

  // Basic type validation for common flexible fields:
  // e.g. ensuring any key ending in "Url" or "url" contains a valid link
  for (const [key, value] of Object.entries(data.data)) {
    if (key.toLowerCase().includes('url') && typeof value === 'string' && value !== '') {
      try {
        new URL(value);
      } catch (e) {
        return `Field ${key} contains an invalid URL.`;
      }
    }
  }

  return null;
}

export function validateAddItemInput(input: unknown): string | null {
  if (!input || typeof input !== 'object') return 'Invalid request body.';

  const data = input as Record<string, unknown>;

  if (!isValidString(data.name)) return 'Item name is required and must be under 255 characters.';
  if (!isValidPositiveNumber(data.price)) return 'Price must be a positive number.';
  if (!isValidPositiveInteger(data.quantity)) return 'Quantity must be a positive integer.';
  if (!isValidString(data.category)) return 'Category is required and must be under 255 characters.';

  if (data.description !== undefined && data.description !== null && !isValidString(data.description, 2000) && data.description !== '') {
      return 'Description must be under 2000 characters.';
  }

  if (data.image !== undefined && data.image !== null && !isValidString(data.image, 2000) && data.image !== '') {
      return 'Image URL must be under 2000 characters.';
  }

  if (data.vendorUrl !== undefined && data.vendorUrl !== null && !isValidString(data.vendorUrl, 2000) && data.vendorUrl !== '') {
      return 'Vendor URL must be under 2000 characters.';
  }

  return null;
}
