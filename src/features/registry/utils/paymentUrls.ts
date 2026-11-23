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

function formatPositiveGiftAmount(amount?: number | string | null): string | null {
  if (amount === undefined || amount === null || amount === '') {
    return null;
  }
  const numeric = typeof amount === 'number' ? amount : Number(String(amount).trim());
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  const rounded = Math.round(numeric * 100) / 100;
  if (rounded <= 0) {
    return null;
  }
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

/**
 * Generates a payment URL or deep link based on the payment service type, handle, and optional gift amount.
 *
 * Supported handle types:
 * - Venmo: https://venmo.com/u/<username> (with ?txn=pay&amount=<amount> when amount > 0)
 * - Cash App: https://cash.app/$<cashtag> (with /<amount> when amount > 0)
 * - PayPal: https://paypal.me/<handle> (with /<amount> when amount > 0)
 * - Zelle: returns null (Zelle has no universal consumer P2P deep link; UI renders a copyable handle)
 * - Custom / Other: returns valid HTTP(S) URL or mailto link if applicable, else null
 */
export function getPaymentUrl(
  handleType?: string | null,
  handle?: string | null,
  amount?: number | string | null
): string | null {
  if (!handle || !handle.trim()) {
    return null;
  }

  const rawHandle = handle.trim();

  // Prevent dangerous protocol execution (XSS protection)
  if (/^(javascript|data|vbscript):/i.test(rawHandle)) {
    return null;
  }

  const typeLower = (handleType || '').trim().toLowerCase();

  // Zelle does not support universal consumer payment URLs; expose handle via copy button only.
  if (typeLower === 'zelle') {
    return null;
  }

  const formattedAmount = formatPositiveGiftAmount(amount);

  // If the handle is already a full safe HTTP/HTTPS URL, enrich known P2P providers with amount if applicable
  if (/^https?:\/\//i.test(rawHandle)) {
    if (!formattedAmount) {
      return rawHandle;
    }
    try {
      const parsedUrl = new URL(rawHandle);
      const host = parsedUrl.hostname.toLowerCase().replace(/^www\./, '');
      if (host === 'venmo.com') {
        const venmoParams = new URLSearchParams(parsedUrl.search);
        if (!venmoParams.has('txn')) {
          venmoParams.set('txn', 'pay');
        }
        venmoParams.set('amount', formattedAmount);
        parsedUrl.search = venmoParams.toString();
        return parsedUrl.toString();
      }
      if (host === 'paypal.me' || host === 'cash.app') {
        const segments = parsedUrl.pathname.split('/').filter(Boolean);
        if (segments.length === 1) {
          parsedUrl.pathname = `/${segments[0]}/${encodeURIComponent(formattedAmount)}`;
          return parsedUrl.toString();
        }
      }
    } catch {
      return rawHandle;
    }
    return rawHandle;
  }

  const cleanedHandle = sanitizePaymentHandle(handleType, handle);

  if (!cleanedHandle) {
    return null;
  }

  if (typeLower === 'venmo') {
    const base = `https://venmo.com/u/${cleanedHandle}`;
    return formattedAmount
      ? `${base}?txn=pay&amount=${encodeURIComponent(formattedAmount)}`
      : base;
  }

  if (typeLower === 'cash app' || typeLower === 'cashapp') {
    const base = `https://cash.app/$${cleanedHandle}`;
    return formattedAmount ? `${base}/${encodeURIComponent(formattedAmount)}` : base;
  }

  if (typeLower === 'paypal') {
    const base = `https://paypal.me/${cleanedHandle}`;
    return formattedAmount ? `${base}/${encodeURIComponent(formattedAmount)}` : base;
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
