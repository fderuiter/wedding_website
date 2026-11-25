/**
 * Utility functions to format payment deep links for Venmo, Cash App, PayPal, Zelle, and custom handles.
 */
import type { RegistryShippingAddress } from '../types';

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

type PaymentDescriptorKind = 'deep_link' | 'manual_zelle' | 'manual_handle' | 'none';

interface PaymentDescriptor {
  kind: PaymentDescriptorKind;
  providerLabel: string;
  rawHandle: string;
  sanitizedHandle: string;
  copyValue: string | null;
  url: string | null;
  supportsQrCode: boolean;
  instructions: string | null;
}

function formatPositivePaymentAmount(amount?: number | null): string | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  return amount.toFixed(2);
}

function appendAmountToP2PUrl(
  rawUrl: string,
  typeLower: string,
  formattedAmount: string | null
): string {
  if (!formattedAmount) {
    return rawUrl;
  }

  try {
    const parsed = new URL(rawUrl);
    const hostLower = parsed.hostname.toLowerCase();

    if (typeLower === 'venmo' || hostLower === 'venmo.com' || hostLower.endsWith('.venmo.com')) {
      if (!parsed.searchParams.has('txn')) {
        parsed.searchParams.set('txn', 'pay');
      }
      parsed.searchParams.set('amount', formattedAmount);
      return parsed.toString();
    }

    if (
      typeLower === 'cash app' ||
      typeLower === 'cashapp' ||
      hostLower === 'cash.app' ||
      hostLower.endsWith('.cash.app')
    ) {
      const segments = parsed.pathname.split('/').filter(Boolean);
      if (segments.length === 1) {
        parsed.pathname = `/${segments[0]}/${formattedAmount}`;
      }
      return parsed.toString();
    }

    if (
      typeLower === 'paypal' ||
      hostLower === 'paypal.me' ||
      hostLower.endsWith('.paypal.me')
    ) {
      const segments = parsed.pathname.split('/').filter(Boolean);
      if (segments.length === 1) {
        parsed.pathname = `/${segments[0]}/${formattedAmount}`;
      }
      return parsed.toString();
    }
  } catch {
    return rawUrl;
  }

  return rawUrl;
}

/**
 * Resolves a structured descriptor distinguishing deep-linkable P2P handles
 * (Venmo, Cash App, PayPal, HTTP(S) custom links) from manual Zelle transfer handles.
 */
export function getPaymentDescriptor(
  handleType?: string | null,
  handle?: string | null,
  amount?: number | null
): PaymentDescriptor {
  const providerLabel = handleType?.trim() || 'Direct Transfer';
  if (!handle || !handle.trim()) {
    return {
      kind: 'none',
      providerLabel,
      rawHandle: '',
      sanitizedHandle: '',
      copyValue: null,
      url: null,
      supportsQrCode: false,
      instructions: null,
    };
  }

  const rawHandle = handle.trim();
  if (/^(javascript|data|vbscript):/i.test(rawHandle)) {
    return {
      kind: 'none',
      providerLabel,
      rawHandle,
      sanitizedHandle: '',
      copyValue: null,
      url: null,
      supportsQrCode: false,
      instructions: null,
    };
  }

  const typeLower = (handleType || '').trim().toLowerCase();
  const formattedAmount = formatPositivePaymentAmount(amount);

  if (/^https?:\/\//i.test(rawHandle)) {
    const urlWithAmount = appendAmountToP2PUrl(rawHandle, typeLower, formattedAmount);
    return {
      kind: 'deep_link',
      providerLabel,
      rawHandle,
      sanitizedHandle: rawHandle,
      copyValue: rawHandle,
      url: urlWithAmount,
      supportsQrCode: true,
      instructions: null,
    };
  }

  const cleanedHandle = sanitizePaymentHandle(handleType, handle);
  if (!cleanedHandle) {
    return {
      kind: 'none',
      providerLabel,
      rawHandle,
      sanitizedHandle: '',
      copyValue: null,
      url: null,
      supportsQrCode: false,
      instructions: null,
    };
  }

  if (typeLower === 'venmo') {
    const baseUrl = `https://venmo.com/u/${cleanedHandle}`;
    return {
      kind: 'deep_link',
      providerLabel: handleType?.trim() || 'Venmo',
      rawHandle,
      sanitizedHandle: cleanedHandle,
      copyValue: rawHandle,
      url: appendAmountToP2PUrl(baseUrl, typeLower, formattedAmount),
      supportsQrCode: true,
      instructions: null,
    };
  }

  if (typeLower === 'cash app' || typeLower === 'cashapp') {
    const baseUrl = `https://cash.app/$${cleanedHandle}`;
    return {
      kind: 'deep_link',
      providerLabel: handleType?.trim() || 'Cash App',
      rawHandle,
      sanitizedHandle: cleanedHandle,
      copyValue: rawHandle,
      url: appendAmountToP2PUrl(baseUrl, typeLower, formattedAmount),
      supportsQrCode: true,
      instructions: null,
    };
  }

  if (typeLower === 'paypal') {
    const baseUrl = `https://paypal.me/${cleanedHandle}`;
    return {
      kind: 'deep_link',
      providerLabel: handleType?.trim() || 'PayPal',
      rawHandle,
      sanitizedHandle: cleanedHandle,
      copyValue: rawHandle,
      url: appendAmountToP2PUrl(baseUrl, typeLower, formattedAmount),
      supportsQrCode: true,
      instructions: null,
    };
  }

  if (typeLower === 'zelle') {
    return {
      kind: 'manual_zelle',
      providerLabel: handleType?.trim() || 'Zelle',
      rawHandle,
      sanitizedHandle: cleanedHandle,
      copyValue: cleanedHandle,
      url: null,
      supportsQrCode: false,
      instructions:
        "Open your bank's app or Zelle, copy this recipient handle, send your gift, and submit the form below to record your contribution.",
    };
  }

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanedHandle)) {
    return {
      kind: 'deep_link',
      providerLabel,
      rawHandle,
      sanitizedHandle: cleanedHandle,
      copyValue: cleanedHandle,
      url: `mailto:${cleanedHandle}?subject=${encodeURIComponent('Wedding Gift')}`,
      supportsQrCode: false,
      instructions: null,
    };
  }

  return {
    kind: 'manual_handle',
    providerLabel,
    rawHandle,
    sanitizedHandle: cleanedHandle,
    copyValue: rawHandle,
    url: null,
    supportsQrCode: false,
    instructions: null,
  };
}

/**
 * Generates a payment URL or deep link based on the payment service type, handle, and optional positive amount.
 *
 * Supported handle types:
 * - Venmo: https://venmo.com/u/<username> (with ?txn=pay&amount=<amount> when positive amount supplied)
 * - Cash App: https://cash.app/$<cashtag> (with /<amount> when positive amount supplied)
 * - PayPal: https://paypal.me/<handle> (with /<amount> when positive amount supplied)
 * - Zelle: returns valid explicit HTTP(S) URL if provided, or null for manual email/phone bank handles
 * - Custom / Other: returns valid HTTP(S) URL or mailto link if applicable, else null
 */
export function getPaymentUrl(
  handleType?: string | null,
  handle?: string | null,
  amount?: number | null
): string | null {
  return getPaymentDescriptor(handleType, handle, amount).url;
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

/**
 * Extracts normalized couple shipping address fields and presence boolean from AppConfig.
 */
export function extractShippingAddressFromConfig(
  config?: {
    shippingRecipientName?: string | null;
    shippingAddressLine1?: string | null;
    shippingAddressLine2?: string | null;
    shippingCity?: string | null;
    shippingState?: string | null;
    shippingZip?: string | null;
    shippingCountry?: string | null;
    shippingPhone?: string | null;
    shippingDeliveryNotes?: string | null;
  } | null
): {
  shippingCandidate: RegistryShippingAddress;
  hasShippingAddress: boolean;
} {
  const shippingCandidate: RegistryShippingAddress = {
    recipientName: config?.shippingRecipientName?.trim() || '',
    addressLine1: config?.shippingAddressLine1?.trim() || '',
    addressLine2: config?.shippingAddressLine2?.trim() || '',
    city: config?.shippingCity?.trim() || '',
    state: config?.shippingState?.trim() || '',
    zip: config?.shippingZip?.trim() || '',
    country: config?.shippingCountry?.trim() || '',
    phone: config?.shippingPhone?.trim() || '',
    deliveryNotes: config?.shippingDeliveryNotes?.trim() || '',
  };

  const hasShippingAddress = Boolean(
    shippingCandidate.recipientName ||
      shippingCandidate.addressLine1 ||
      shippingCandidate.city ||
      shippingCandidate.state ||
      shippingCandidate.zip ||
      shippingCandidate.country
  );

  return { shippingCandidate, hasShippingAddress };
}
