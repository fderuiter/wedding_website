// Centralized validation utility for registry API endpoints
import { RegistryItem, Contributor } from '@/types/registry';

export function validateContributeInput(input: any): string | null {
  if (!input || typeof input !== 'object') return 'Invalid request body.';
  if (!input.itemId || typeof input.itemId !== 'string') return 'Missing or invalid itemId.';
  if (!input.purchaserName || typeof input.purchaserName !== 'string' || input.purchaserName.trim().length === 0) return 'Name is required.';
  if (typeof input.amount !== 'number' || isNaN(input.amount) || input.amount <= 0) return 'Contribution amount must be a positive number.';
  return null;
}

export function validateAddItemInput(input: any): string | null {
  if (!input || typeof input !== 'object') return 'Invalid request body.';
  if (!input.name || typeof input.name !== 'string' || input.name.trim().length === 0) return 'Item name is required.';
  if (!input.price || typeof input.price !== 'number' || isNaN(input.price) || input.price <= 0) return 'Price must be a positive number.';
  if (!input.quantity || typeof input.quantity !== 'number' || isNaN(input.quantity) || input.quantity <= 0) return 'Quantity must be a positive number.';
  if (!input.category || typeof input.category !== 'string' || input.category.trim().length === 0) return 'Category is required.';
  // Optional: image, vendorUrl, isGroupGift
  return null;
}

// Add more validators as needed for edit, etc.
