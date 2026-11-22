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

export interface EffectivePaymentHandle {
  paymentHandleType: string | null;
  paymentHandle: string | null;
  source: 'item' | 'default' | 'none';
}

/**
 * Resolves the effective peer-to-peer payment handle for a group gift or fund,
 * preferring an item-specific handle when set and falling back to site-wide defaults.
 */
export function resolveEffectivePaymentHandle(
  item?: { paymentHandleType?: string | null; paymentHandle?: string | null } | null,
  defaults?: { defaultPaymentHandleType?: string | null; defaultPaymentHandle?: string | null } | null
): EffectivePaymentHandle {
  const itemHandle = item?.paymentHandle?.trim() || '';
  if (itemHandle) {
    return {
      paymentHandleType: item?.paymentHandleType?.trim() || null,
      paymentHandle: itemHandle,
      source: 'item',
    };
  }

  const defaultHandle = defaults?.defaultPaymentHandle?.trim() || '';
  if (defaultHandle) {
    return {
      paymentHandleType: defaults?.defaultPaymentHandleType?.trim() || null,
      paymentHandle: defaultHandle,
      source: 'default',
    };
  }

  return {
    paymentHandleType: null,
    paymentHandle: null,
    source: 'none',
  };
}

/**
 * Formats an authenticated registry shipping address into multi-line plain text for display and clipboard copying.
 */
export function formatRegistryShippingAddress(shipping: {
  recipientName?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
  phone?: string | null;
  deliveryNotes?: string | null;
}): string {
  const lines: string[] = [];
  const recipient = shipping.recipientName?.trim() || '';
  const line1 = shipping.addressLine1?.trim() || '';
  const line2 = shipping.addressLine2?.trim() || '';
  const city = shipping.city?.trim() || '';
  const state = shipping.state?.trim() || '';
  const zip = shipping.zip?.trim() || '';
  const country = shipping.country?.trim() || '';
  const phone = shipping.phone?.trim() || '';
  const notes = shipping.deliveryNotes?.trim() || '';

  if (recipient) lines.push(recipient);
  if (line1) lines.push(line1);
  if (line2) lines.push(line2);

  const cityState = [city, state].filter(Boolean).join(', ');
  const localityLine = [cityState, zip].filter(Boolean).join(' ');
  if (localityLine) lines.push(localityLine);

  if (country) lines.push(country);
  if (phone) lines.push(`Phone: ${phone}`);
  if (notes) lines.push(`Delivery Notes: ${notes}`);

  return lines.join('\n');
}
