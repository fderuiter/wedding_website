// Centralized validation utility for registry API endpoints

/**
 * Validates the input for a contribution to a registry item.
 * @param {unknown} input - The input data to validate.
 * @returns {string | null} An error message if validation fails, otherwise null.
 */
export function validateContributeInput(input: unknown): string | null { // Changed 'any' to 'unknown'
  if (!input || typeof input !== 'object') return 'Invalid request body.';
  // Use type assertion or type guards for property access
  const data = input as Record<string, unknown>;
  if (!data.itemId || typeof data.itemId !== 'string') return 'Missing or invalid itemId.';
  if (!data.purchaserName || typeof data.purchaserName !== 'string' || String(data.purchaserName).trim().length === 0) return 'Name is required.';
  if (typeof data.amount !== 'number' || isNaN(data.amount) || data.amount <= 0) return 'Contribution amount must be a positive number.';
  return null;
}

/**
 * Validates the input for adding a new registry item.
 * @param {unknown} input - The input data to validate.
 * @returns {string | null} An error message if validation fails, otherwise null.
 */
export function validateAddItemInput(input: unknown): string | null { // Changed 'any' to 'unknown'
  if (!input || typeof input !== 'object') return 'Invalid request body.';
   // Use type assertion or type guards for property access
  const data = input as Record<string, unknown>;
  if (!data.name || typeof data.name !== 'string' || String(data.name).trim().length === 0) return 'Item name is required.';
  if (!data.price || typeof data.price !== 'number' || isNaN(data.price) || data.price <= 0) return 'Price must be a positive number.';
  if (!data.quantity || typeof data.quantity !== 'number' || isNaN(data.quantity) || data.quantity <= 0) return 'Quantity must be a positive number.';
  if (!data.category || typeof data.category !== 'string' || String(data.category).trim().length === 0) return 'Category is required.';
  // Optional: image, vendorUrl, isGroupGift
  return null;
}

// Add more validators as needed for edit, etc.
