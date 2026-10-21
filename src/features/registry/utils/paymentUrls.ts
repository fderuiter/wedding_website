/**
 * Utility functions to format payment deep links for Venmo, Cash App, PayPal, Zelle, and custom handles.
 */

/**
 * Sanitizes a raw payment handle by removing leading symbols (@, $, u/, paypal.me/, etc.).
 */
export function sanitizePaymentHandle(
  handleType?: string | null,
  handle?: string | null
): string {
  if (!handle) return '';
  let cleaned = handle.trim();

  // If handle is a full URL, return as is
  if (/^https?:\/\//i.test(cleaned)) {
    return cleaned;
  }

  const typeLower = (handleType || '').trim().toLowerCase();

  if (typeLower === 'venmo') {
    cleaned = cleaned.replace(/^@/, '').replace(/^u\//i, '');
  } else if (typeLower === 'cash app' || typeLower === 'cashapp') {
    cleaned = cleaned.replace(/^\$/, '').replace(/^@/, '');
  } else if (typeLower === 'paypal') {
    cleaned = cleaned.replace(/^@/, '').replace(/^paypal\.me\//i, '');
  }

  return cleaned.trim();
}

/**
 * Generates a payment URL or deep link based on the payment service type and handle.
 *
 * Supported handle types:
 * - Venmo: https://venmo.com/u/<username>
 * - Cash App: https://cash.app/$<cashtag>
 * - PayPal: https://paypal.me/<handle>
 * - Zelle: mailto:<email>?subject=... if email, tel:<phone> if phone, or web URL
 * - Custom / Other: returns valid HTTP(S) URL or mailto link if applicable, else null
 */
export function getPaymentUrl(
  handleType?: string | null,
  handle?: string | null
): string | null {
  if (!handle || !handle.trim()) {
    return null;
  }

  const rawHandle = handle.trim();

  // Prevent dangerous protocol execution (XSS protection)
  if (/^(javascript|data|vbscript):/i.test(rawHandle)) {
    return null;
  }

  // If the handle is already a full safe HTTP/HTTPS URL, return as-is
  if (/^https?:\/\//i.test(rawHandle)) {
    return rawHandle;
  }

  const typeLower = (handleType || '').trim().toLowerCase();
  const cleanedHandle = sanitizePaymentHandle(handleType, handle);

  if (!cleanedHandle) {
    return null;
  }

  if (typeLower === 'venmo') {
    return `https://venmo.com/u/${cleanedHandle}`;
  }

  if (typeLower === 'cash app' || typeLower === 'cashapp') {
    return `https://cash.app/$${cleanedHandle}`;
  }

  if (typeLower === 'paypal') {
    return `https://paypal.me/${cleanedHandle}`;
  }

  if (typeLower === 'zelle') {
    // If it's an email address
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanedHandle)) {
      return `mailto:${cleanedHandle}?subject=${encodeURIComponent('Wedding Gift via Zelle')}`;
    }
    // If it's a phone number (e.g. 10+ digits with optional formatting)
    const digitsOnly = cleanedHandle.replace(/\D/g, '');
    if (digitsOnly.length >= 10) {
      return `tel:${digitsOnly}`;
    }
    // Default fallback web link for Zelle
    return 'https://www.zellepay.com';
  }

  // For custom or unspecified handle types
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanedHandle)) {
    return `mailto:${cleanedHandle}?subject=${encodeURIComponent('Wedding Gift')}`;
  }

  return null;
}
