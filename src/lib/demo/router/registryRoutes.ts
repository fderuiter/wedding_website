import { ARCHETYPE_PRESETS } from '@/lib/sampleData/archetypes';
import { findSeededRegistryItemById } from '@/lib/sampleData/builder';
import { formatCurrency } from '@/utils/intl';
import type {
  ContributorRecord,
  InvitationCodeDTO,
  RegistryItem,
  ThankYouTemplateTokens,
} from '@/features/registry';
import { DEMO_SHIPPING_ADDRESS } from '../demoSeed';
import {
  findDemoGuestByCode,
  getActiveArchetypeDataset,
  getDemoState,
  mutateActiveDataset,
  previewDemoClaimToken,
  processDemoClaimToken,
  recordDemoAuditVersion,
  recordDemoContribution,
  resolveDemoRegistryItemIdAlias,
  setDemoGuestSession,
} from '../demoStore';
import {
  type DemoRouteContext,
  binaryResponse,
  buildDemoCsv,
  createMinimalPdfBytes,
  jsonResponse,
  nextDemoId,
  parseJsonBody,
} from './http';

function escapeDemoHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDemoThankYouText(
  template: string,
  tokens: ThankYouTemplateTokens
): string {
  const guestName = tokens.guestName?.trim() || 'Friend';
  const giftName = tokens.giftName?.trim() || 'wedding gift';
  const formattedAmount =
    typeof tokens.amount === 'number'
      ? formatCurrency(tokens.amount)
      : tokens.amount?.trim() || '$0.00';

  return template
    .replace(/\{\{\s*guestName\s*\}\}/g, guestName)
    .replace(/\{\{\s*giftName\s*\}\}/g, giftName)
    .replace(/\{\{\s*amount\s*\}\}/g, formattedAmount);
}

function formatDemoEmailHtml(text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px;">${escapeDemoHtml(p).replace(/\n/g, '<br />')}</p>`)
    .join('');
  return `<div style="font-family:Georgia,serif;color:#1f2937;line-height:1.6;">${paragraphs}</div>`;
}

function normalizeThankYouStatus(
  raw: unknown
): 'Unsent' | 'Sent' | 'Not Needed' {
  const normalized = String(raw ?? 'Unsent')
    .trim()
    .toLowerCase()
    .replace(/_/g, ' ');
  if (normalized === 'sent') return 'Sent';
  if (normalized === 'not needed' || normalized === 'notneeded') return 'Not Needed';
  return 'Unsent';
}

function toThankYouNoteDto(
  contributor: ContributorRecord,
  registryItem: RegistryItem | null,
  guestById: Map<string, InvitationCodeDTO>
) {
  const linked = contributor.invitationCodeId
    ? guestById.get(contributor.invitationCodeId) ?? null
    : null;
  return {
    id: contributor.id,
    name: contributor.name,
    email: contributor.email ?? null,
    addressLine1: contributor.addressLine1 ?? null,
    addressLine2: contributor.addressLine2 ?? null,
    city: contributor.city ?? null,
    state: contributor.state ?? null,
    zipCode: contributor.zipCode ?? null,
    country: contributor.country ?? null,
    message: contributor.message ?? null,
    amount: contributor.amount,
    refundedAmount: contributor.refundedAmount ?? 0,
    status: contributor.status ?? 'CONFIRMED',
    date: contributor.date || new Date().toISOString(),
    thankYouStatus: normalizeThankYouStatus(contributor.thankYouStatus),
    thankYouSentAt: contributor.thankYouSentAt ?? null,
    thankYouEmailSentAt: contributor.thankYouEmailSentAt ?? null,
    thankYouNote: contributor.thankYouNote ?? null,
    invitationCodeId: contributor.invitationCodeId ?? null,
    invitationCode: linked
      ? {
        id: linked.id,
        code: linked.code,
        guestName: linked.guestName,
        email: linked.email ?? null,
        householdName: linked.householdName ?? null,
        addressLine1: linked.addressLine1 ?? null,
        addressLine2: linked.addressLine2 ?? null,
        city: linked.city ?? null,
        state: linked.state ?? null,
        zipCode: linked.zipCode ?? null,
        country: linked.country ?? null,
      }
      : null,
    registryItemId: registryItem?.id ?? contributor.registryItemId ?? null,
    registryItem: registryItem
      ? {
        id: registryItem.id,
        name: registryItem.name,
        category: registryItem.category,
      }
      : null,
  };
}

function buildDeterministicScrapeResult(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    const hostLabel = parsed.hostname.replace(/^www\./i, '').split('.')[0] || 'Retail';
    const slug =
      parsed.pathname
        .split('/')
        .filter(Boolean)
        .pop()
        ?.replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (ch) => ch.toUpperCase()) || 'Signature Registry Gift';
    const titleBrand = hostLabel.charAt(0).toUpperCase() + hostLabel.slice(1);
    return {
      url: rawUrl,
      name: `${titleBrand} ${slug}`.trim().slice(0, 120),
      description: `Curated registry selection from ${parsed.hostname} (previewed locally in showcase mode).`,
      price: 125,
      category: 'Home',
      imageUrl: null,
      vendorUrl: rawUrl,
    };
  } catch {
    return null;
  }
}

function resolveDemoRegistryItemTarget(rawItemId: string): {
  existing: RegistryItem | null;
  target: RegistryItem | null;
} {
  const currentItems = getActiveArchetypeDataset().registryItems;
  const existing = resolveDemoRegistryItemIdAlias(currentItems, rawItemId);
  if (existing) {
    return { existing, target: existing };
  }
  const seeded = findSeededRegistryItemById(rawItemId, { includeContributors: true });
  return { existing: null, target: seeded ?? null };
}

function applyDemoRegistryItemPatch(
  target: RegistryItem,
  body: Record<string, unknown>
): RegistryItem {
  const nextName = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : target.name;
  const nextItemType =
    body.itemType === 'CASH_FUND' ||
    body.itemType === 'EXPERIENCE_FUND' ||
    body.itemType === 'PHYSICAL'
      ? body.itemType
      : target.itemType;

  let nextImage = target.image ?? null;
  let nextImageId = target.imageId ?? null;
  const hasImageUrlField = 'imageUrl' in body;
  const rawImageUrl = typeof body.imageUrl === 'string' ? body.imageUrl.trim() : '';

  if (body.image && typeof body.image === 'object' && !Array.isArray(body.image)) {
    const imgObj = body.image as Record<string, unknown>;
    const imgUrl = typeof imgObj.url === 'string' ? imgObj.url.trim() : nextImage?.url || '';
    if (imgUrl) {
      const resolvedId =
        typeof imgObj.id === 'string' && imgObj.id ? imgObj.id : nextImage?.id || `${target.id}-img`;
      nextImageId = resolvedId;
      nextImage = {
        id: resolvedId,
        url: imgUrl,
        altText:
          typeof imgObj.altText === 'string'
            ? imgObj.altText
            : nextImage?.altText || nextName,
        isDecorative:
          typeof imgObj.isDecorative === 'boolean'
            ? imgObj.isDecorative
            : Boolean(nextImage?.isDecorative),
        isSample: false,
      };
    }
  } else if (hasImageUrlField) {
    if (rawImageUrl) {
      const resolvedId = nextImage?.id || `${target.id}-img`;
      nextImageId = resolvedId;
      nextImage = {
        id: resolvedId,
        url: rawImageUrl,
        altText:
          typeof body.imageAlt === 'string'
            ? body.imageAlt
            : nextImage?.altText || nextName,
        isDecorative:
          typeof body.imageDecorative === 'boolean'
            ? body.imageDecorative
            : Boolean(nextImage?.isDecorative),
        isSample: false,
      };
    } else if (body.imageUrl === null || body.imageUrl === '') {
      nextImage = null;
      nextImageId = null;
    }
  } else if (
    nextImage &&
    (typeof body.imageAlt === 'string' || typeof body.imageDecorative === 'boolean')
  ) {
    nextImage = {
      ...nextImage,
      ...(typeof body.imageAlt === 'string' ? { altText: body.imageAlt } : {}),
      ...(typeof body.imageDecorative === 'boolean' ? { isDecorative: body.imageDecorative } : {}),
    };
  }

  return {
    ...target,
    name: nextName,
    ...(typeof body.description === 'string' ? { description: body.description } : {}),
    ...(typeof body.category === 'string' ? { category: body.category } : {}),
    ...(typeof body.price === 'number' && Number.isFinite(body.price) ? { price: body.price } : {}),
    ...(typeof body.quantity === 'number' && Number.isFinite(body.quantity)
      ? { quantity: Math.max(1, body.quantity) }
      : {}),
    itemType: nextItemType,
    ...(typeof body.isGroupGift === 'boolean' ? { isGroupGift: body.isGroupGift } : {}),
    ...(typeof body.isMostWanted === 'boolean' ? { isMostWanted: body.isMostWanted } : {}),
    ...(typeof body.displayOrder === 'number' && Number.isFinite(body.displayOrder)
      ? { displayOrder: body.displayOrder }
      : {}),
    ...(body.vendorUrl === null || typeof body.vendorUrl === 'string'
      ? { vendorUrl: body.vendorUrl }
      : {}),
    ...(body.paymentHandleType === null || typeof body.paymentHandleType === 'string'
      ? { paymentHandleType: body.paymentHandleType }
      : {}),
    ...(body.paymentHandle === null || typeof body.paymentHandle === 'string'
      ? { paymentHandle: body.paymentHandle }
      : {}),
    ...(typeof body.imageId === 'string' || body.imageId === null
      ? { imageId: body.imageId }
      : { imageId: nextImageId }),
    image: nextImage,
    isSample: false,
  };
}

export async function handleRegistryAndThankYouRoutes(
  ctx: DemoRouteContext
): Promise<Response | null> {
  const { url, path, method, init, rawInput } = ctx;

  // 1. Registry Capabilities
  if (path === '/api/registry/capabilities' && method === 'GET') {
    return jsonResponse({
      cardCheckoutEnabled: true,
      stripePublishableKey: null,
      defaultPaymentHandleType: 'Venmo',
      defaultPaymentHandle: '@alex-and-taylor',
      shippingAddress: DEMO_SHIPPING_ADDRESS,
    });
  }

  // 2. Public Registry Items List & Create
  if (path === '/api/registry/items') {
    if (method === 'GET') {
      const items = getActiveArchetypeDataset().registryItems;
      const page = Math.max(1, Number(url.searchParams.get('page') || '1'));
      const limit = Math.max(1, Number(url.searchParams.get('limit') || '100'));
      return jsonResponse({
        items,
        total: items.length,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(items.length / limit)),
      });
    }
    if (method === 'POST') {
      const body = await parseJsonBody(init, rawInput);
      const id = nextDemoId('demo-custom-item');
      const newItem = applyDemoRegistryItemPatch(
        {
          id,
          name: String(body.name || 'Custom Gift'),
          description: String(body.description || ''),
          category: String(body.category || 'Home'),
          price: Number(body.price || 50),
          quantity: Number(body.quantity || 1),
          itemType:
            body.itemType === 'CASH_FUND' || body.itemType === 'EXPERIENCE_FUND'
              ? body.itemType
              : 'PHYSICAL',
          isGroupGift: Boolean(body.isGroupGift),
          isMostWanted: Boolean(body.isMostWanted),
          displayOrder: Number(body.displayOrder || 0),
          vendorUrl: typeof body.vendorUrl === 'string' ? body.vendorUrl : null,
          paymentHandleType: 'Venmo',
          paymentHandle: '@alex-and-taylor',
          purchased: false,
          purchaserName: null,
          amountContributed: 0,
          isSample: false,
          imageId: null,
          image: null,
          contributors: [],
        },
        body
      );
      mutateActiveDataset((current) => ({
        ...current,
        registryItems: [newItem, ...current.registryItems],
      }));
      return jsonResponse(newItem, 201);
    }
  }

  if (path === '/api/registry/items/batch' && (method === 'POST' || method === 'PUT')) {
    const body = await parseJsonBody(init, rawInput);
    const items = Array.isArray(body.items)
      ? (body.items as Array<Record<string, unknown>>)
      : [];
    const created: RegistryItem[] = items.map((entry, idx) =>
      applyDemoRegistryItemPatch(
        {
          id: nextDemoId(`demo-batch-item-${idx}`),
          name: String(entry.name || `Imported Gift ${idx + 1}`),
          description: String(entry.description || ''),
          category: String(entry.category || 'Home'),
          price: Math.max(1, Number(entry.price || 75)),
          quantity: Math.max(1, Number(entry.quantity || 1)),
          itemType:
            entry.itemType === 'CASH_FUND' || entry.itemType === 'EXPERIENCE_FUND'
              ? entry.itemType
              : 'PHYSICAL',
          isGroupGift: Boolean(entry.isGroupGift),
          isMostWanted: Boolean(entry.isMostWanted),
          displayOrder: idx,
          vendorUrl: typeof entry.vendorUrl === 'string' ? entry.vendorUrl : null,
          paymentHandleType: 'Venmo',
          paymentHandle: '@alex-and-taylor',
          purchased: false,
          purchaserName: null,
          amountContributed: 0,
          isSample: false,
          imageId: null,
          image: null,
          contributors: [],
        },
        entry
      )
    );
    if (created.length > 0) {
      mutateActiveDataset((current) => ({
        ...current,
        registryItems: [...created, ...current.registryItems],
      }));
    }
    return jsonResponse({ success: true, items: created, data: { items: created } }, 201);
  }

  // Single registry item CRUD (with alias resolution across /api/registry/items/:id and /api/admin/registry-items/:id)
  if (path.startsWith('/api/registry/items/') || path.startsWith('/api/admin/registry-items/')) {
    const isAdminRoute = path.startsWith('/api/admin/registry-items/');
    const prefix = isAdminRoute ? '/api/admin/registry-items/' : '/api/registry/items/';
    const rawRest = path.slice(prefix.length);
    if (!rawRest || rawRest.includes('/') || rawRest === 'batch') {
      return null;
    }
    const rawItemId = decodeURIComponent(rawRest);
    const { existing, target } = resolveDemoRegistryItemTarget(rawItemId);

    if (method === 'GET') {
      if (!target) {
        return jsonResponse({ error: 'Item not found' }, 404);
      }
      return jsonResponse(isAdminRoute ? { success: true, data: target, ...target } : target);
    }
    if (method === 'DELETE') {
      if (!existing) return jsonResponse({ error: 'Item not found' }, 404);
      mutateActiveDataset((current) => ({
        ...current,
        registryItems: current.registryItems.filter((i) => i.id !== existing.id),
      }));
      if (isAdminRoute) {
        recordDemoAuditVersion(
          'RegistryItem',
          existing.id,
          'DELETE',
          `Deleted registry gift "${existing.name}"`
        );
      }
      return jsonResponse(existing);
    }
    if (method === 'PUT' || method === 'PATCH') {
      if (!target) return jsonResponse({ error: 'Item not found' }, 404);
      const body = await parseJsonBody(init, rawInput);
      const updated = applyDemoRegistryItemPatch(target, body);
      mutateActiveDataset((current) => ({
        ...current,
        registryItems: existing
          ? current.registryItems.map((i) => (i.id === existing.id ? updated : i))
          : [updated, ...current.registryItems],
      }));
      if (isAdminRoute) {
        recordDemoAuditVersion(
          'RegistryItem',
          updated.id,
          'UPDATE',
          `Updated registry gift "${updated.name}"`,
          updated as unknown as Record<string, unknown>
        );
      }
      return jsonResponse(updated);
    }
  }

  // 3. Registry Contributions, Payment Intents, Reconcile, Scrape, Claims & Session
  if (path === '/api/registry/contribute' && method === 'POST') {
    const body = await parseJsonBody(init, rawInput);
    const itemId = String(body.itemId || '');
    const purchaserName = String(body.purchaserName || body.name || '').trim();
    const amount = Number(body.amount || 0);
    if (!itemId || !purchaserName || !(amount > 0)) {
      return jsonResponse({ error: 'Missing contribution details.' }, 400);
    }
    const updated = recordDemoContribution({
      itemId,
      purchaserName,
      amount,
      code: typeof body.code === 'string' ? body.code : undefined,
      message: typeof body.message === 'string' ? body.message : null,
      coverFee: Boolean(body.coverFee),
      email: typeof body.email === 'string' ? body.email : null,
      paymentIntentId:
        typeof body.paymentIntentId === 'string' && body.paymentIntentId
          ? body.paymentIntentId
          : undefined,
      retailerOrderNumber:
        typeof body.retailerOrderNumber === 'string' ? body.retailerOrderNumber : undefined,
      carrier: typeof body.carrier === 'string' ? body.carrier : undefined,
      trackingNumber:
        typeof body.trackingNumber === 'string' ? body.trackingNumber : undefined,
      addressLine1: typeof body.addressLine1 === 'string' ? body.addressLine1 : undefined,
      addressLine2: typeof body.addressLine2 === 'string' ? body.addressLine2 : undefined,
      city: typeof body.city === 'string' ? body.city : undefined,
      state: typeof body.state === 'string' ? body.state : undefined,
      zipCode: typeof body.zipCode === 'string' ? body.zipCode : undefined,
      country: typeof body.country === 'string' ? body.country : undefined,
    });
    if (!updated) {
      return jsonResponse({ error: 'Registry item not found.' }, 404);
    }
    return jsonResponse(updated);
  }

  if (path === '/api/registry/payment-intent' && method === 'POST') {
    const body = await parseJsonBody(init, rawInput);
    const amount = Math.max(1, Number(body.amount || 50));
    const intentId = nextDemoId('pi_demo');
    return jsonResponse({
      success: true,
      paymentIntentId: intentId,
      clientSecret: `${intentId}_secret_demo`,
      amount: Math.round(amount * 100),
      currency: 'usd',
      simulated: true,
    });
  }

  if (path === '/api/registry/payment-intent/reconcile' && method === 'POST') {
    const body = await parseJsonBody(init, rawInput);
    const paymentIntentId =
      typeof body.paymentIntentId === 'string' ? body.paymentIntentId.trim() : '';
    const clientSecret = typeof body.clientSecret === 'string' ? body.clientSecret.trim() : '';
    const rawItemId = typeof body.itemId === 'string' ? body.itemId.trim() : '';

    if (!paymentIntentId || !clientSecret) {
      return jsonResponse(
        { error: 'Missing or invalid paymentIntentId.' },
        400
      );
    }

    const items = getActiveArchetypeDataset().registryItems;
    const resolvedTarget = rawItemId
      ? resolveDemoRegistryItemTarget(rawItemId).target
      : (items[0] ?? null);
    if (!resolvedTarget) {
      return jsonResponse({ error: 'Item not found' }, 404);
    }
    const alreadyRecorded = Boolean(
      resolvedTarget.contributors.some((c) => c.stripePaymentIntentId === paymentIntentId)
    );
    const session = getDemoState().guestSession;
    const activeGuest = session ? findDemoGuestByCode(session.invitationCode) : null;
    const resolvedEmail =
      activeGuest && typeof activeGuest.email === 'string' && activeGuest.email.trim().length > 0
        ? activeGuest.email.trim()
        : null;

    return jsonResponse({
      reconciled: true,
      status: 'succeeded',
      paymentIntentId,
      itemId: resolvedTarget.id,
      alreadyRecorded,
      item: resolvedTarget,
      receipt: {
        itemId: resolvedTarget.id,
        paymentIntentId,
        contributorName: activeGuest?.guestName || session?.guestName || 'Demo Guest',
        contributorEmail: resolvedEmail,
        baseAmount: resolvedTarget.price,
        feeAmount: 0,
        coverFee: false,
        totalChargeAmount: resolvedTarget.price,
        message: null,
      },
    });
  }

  if (path === '/api/registry/webhook/stripe' && method === 'POST') {
    return jsonResponse({ received: true, demo: true });
  }

  if (path === '/api/registry/scrape' && method === 'POST') {
    const body = await parseJsonBody(init, rawInput);
    const rawUrl = typeof body.url === 'string' ? body.url.trim() : '';
    const scraped = buildDeterministicScrapeResult(rawUrl);
    if (!scraped) {
      return jsonResponse({ success: false, error: 'Valid product URL is required.' }, 400);
    }
    return jsonResponse({ success: true, ...scraped, data: scraped });
  }

  if (path === '/api/registry/scrape/batch' && method === 'POST') {
    const body = await parseJsonBody(init, rawInput);
    const urls = Array.isArray(body.urls)
      ? body.urls.filter((u): u is string => typeof u === 'string')
      : [];
    const results = urls
      .map((u) => buildDeterministicScrapeResult(u.trim()))
      .filter((r): r is NonNullable<typeof r> => Boolean(r));
    return jsonResponse({ success: true, items: results, results, data: { items: results } });
  }

  if (path === '/api/registry/claim') {
    if (method === 'GET') {
      const token = (url.searchParams.get('token') || '').trim();
      if (!token) {
        return jsonResponse({ error: 'Missing claim token.' }, 400);
      }
      const preview = previewDemoClaimToken(token);
      if (!preview) {
        return jsonResponse({ error: 'Invalid or expired reservation token.' }, 404);
      }
      return jsonResponse(preview);
    }

    if (method === 'POST') {
      const token = String((await parseJsonBody(init, rawInput)).token || '').trim();
      if (!token) {
        return jsonResponse({ error: 'Missing claim token.' }, 400);
      }
      const result = processDemoClaimToken(token);
      if (!result) {
        return jsonResponse({ error: 'Invalid or expired reservation token.' }, 404);
      }
      return jsonResponse(result);
    }
  }

  if (path === '/api/registry/validate-code') {
    if (method !== 'POST') {
      return jsonResponse({ error: 'Method Not Allowed' }, 405);
    }
    const rawCode = String((await parseJsonBody(init, rawInput)).code || '');
    const trimmedInput = rawCode.trim();
    if (!trimmedInput) {
      return jsonResponse(
        {
          valid: false,
          success: false,
          error: 'Code is required.',
        },
        400
      );
    }
    const matched = findDemoGuestByCode(trimmedInput);
    if (!matched) {
      const envPasscode =
        typeof process !== 'undefined' && typeof process.env?.GUEST_PASSCODE === 'string'
          ? process.env.GUEST_PASSCODE.trim()
          : '';
      if (trimmedInput === 'WEDDING2026' || (envPasscode && trimmedInput === envPasscode)) {
        const guidanceError =
          'That is the shared website passcode. Please enter the personal household invitation code printed on your invitation.';
        return jsonResponse(
          {
            valid: false,
            success: false,
            reason: 'shared_passcode',
            error: guidanceError,
          },
          401
        );
      }
      return jsonResponse(
        {
          valid: false,
          success: false,
          error: 'Invalid invitation code for the active wedding archetype.',
        },
        404
      );
    }
    setDemoGuestSession({
      invitationCode: matched.code,
      guestName: matched.guestName,
    });
    return jsonResponse({
      valid: true,
      success: true,
      code: matched.code,
      guestName: matched.guestName,
      data: {
        valid: true,
        code: matched.code,
        guestName: matched.guestName,
      },
    });
  }

  if (path === '/api/registry/session') {
    if (method === 'GET') {
      const session = getDemoState().guestSession;
      const activeGuest = session ? findDemoGuestByCode(session.invitationCode) : null;
      if (!session || !activeGuest) {
        return jsonResponse({ isVerified: false, invitationCode: '', guestName: '', email: null });
      }
      return jsonResponse({
        isVerified: true,
        invitationCode: activeGuest.code,
        code: activeGuest.code,
        guestName: activeGuest.guestName || session.guestName,
        email: activeGuest.email ?? null,
      });
    }
    if (method === 'DELETE') {
      setDemoGuestSession(null);
      return jsonResponse({ success: true });
    }
  }

  // 4. Admin Registry Unclaim & Contributors
  if (
    path.startsWith('/api/admin/registry/items/') &&
    path.endsWith('/unclaim') &&
    method === 'POST'
  ) {
    const itemId = decodeURIComponent(
      path.slice('/api/admin/registry/items/'.length, -'/unclaim'.length)
    );
    let updatedItem: RegistryItem | null = null;
    mutateActiveDataset((current) => ({
      ...current,
      registryItems: current.registryItems.map((item) => {
        if (item.id !== itemId) return item;
        updatedItem = {
          ...item,
          purchased: false,
          purchaserName: null,
          amountContributed: 0,
          contributors: [],
        };
        return updatedItem;
      }),
    }));
    if (!updatedItem) {
      return jsonResponse({ error: 'Registry item not found.' }, 404);
    }
    return jsonResponse({ success: true, data: { item: updatedItem }, item: updatedItem });
  }

  if (path.startsWith('/api/admin/contributors/')) {
    const rawRest = path.slice('/api/admin/contributors/'.length);
    const isAction = rawRest.endsWith('/action');
    const contributorId = decodeURIComponent(
      isAction ? rawRest.slice(0, -'/action'.length) : rawRest
    );
    const body = await parseJsonBody(init, rawInput);
    let matchedContributor: ContributorRecord | null = null;
    let updatedParentItem: RegistryItem | null = null;
    let deleted = false;

    mutateActiveDataset((current) => {
      const nextRegistryItems = current.registryItems.map((item) => {
        const idx = (item.contributors || []).findIndex((c) => c.id === contributorId);
        if (idx === -1) return item;
        const target = item.contributors[idx];

        if (method === 'DELETE' && !isAction) {
          deleted = true;
          const nextContributors = item.contributors.filter((c) => c.id !== contributorId);
          const nextTotal = nextContributors.reduce(
            (sum, c) => (c.status === 'CANCELLED' ? sum : sum + c.amount),
            0
          );
          updatedParentItem = {
            ...item,
            contributors: nextContributors,
            amountContributed: nextTotal,
            purchased: item.isGroupGift ? nextTotal >= item.price : nextContributors.length > 0,
            purchaserName: nextContributors[0]?.name ?? null,
          };
          return updatedParentItem;
        }

        const nextStatus =
          isAction && method === 'POST'
            ? body.action === 'void' || body.action === 'cancel'
              ? 'CANCELLED'
              : body.action === 'confirm'
                ? 'CONFIRMED'
                : target.status
            : body.status === 'CONFIRMED' ||
                body.status === 'RESERVED' ||
                body.status === 'CANCELLED'
              ? body.status
              : target.status;

        const nextContributor: ContributorRecord = {
          ...target,
          ...(typeof body.name === 'string' && body.name.trim() ? { name: body.name.trim() } : {}),
          ...(body.email === null || typeof body.email === 'string' ? { email: body.email } : {}),
          ...(typeof body.amount === 'number' && body.amount > 0 ? { amount: body.amount } : {}),
          ...(body.message === null || typeof body.message === 'string'
            ? { message: body.message }
            : {}),
          status: nextStatus,
        };
        matchedContributor = nextContributor;
        const nextContributors = item.contributors.map((c) =>
          c.id === contributorId ? nextContributor : c
        );
        const nextTotal = nextContributors.reduce(
          (sum, c) => (c.status === 'CANCELLED' ? sum : sum + c.amount),
          0
        );
        updatedParentItem = {
          ...item,
          contributors: nextContributors,
          amountContributed: nextTotal,
          purchased: item.isGroupGift
            ? nextTotal >= item.price
            : nextContributors.some((c) => c.status !== 'CANCELLED'),
        };
        return updatedParentItem;
      });

      const offlineIdx = current.offlineContributors.findIndex((c) => c.id === contributorId);
      let nextOffline = current.offlineContributors;
      if (offlineIdx !== -1) {
        if (method === 'DELETE' && !isAction) {
          deleted = true;
          nextOffline = current.offlineContributors.filter((c) => c.id !== contributorId);
        } else {
          const target = current.offlineContributors[offlineIdx];
          const nextStatus =
            isAction && method === 'POST'
              ? body.action === 'void' || body.action === 'cancel'
                ? 'CANCELLED'
                : 'CONFIRMED'
              : body.status === 'CONFIRMED' ||
                  body.status === 'RESERVED' ||
                  body.status === 'CANCELLED'
                ? body.status
                : target.status;
          const updatedOffline: ContributorRecord = {
            ...target,
            ...(typeof body.name === 'string' && body.name.trim() ? { name: body.name.trim() } : {}),
            ...(body.email === null || typeof body.email === 'string' ? { email: body.email } : {}),
            ...(typeof body.amount === 'number' && body.amount > 0 ? { amount: body.amount } : {}),
            ...(body.message === null || typeof body.message === 'string'
              ? { message: body.message }
              : {}),
            status: nextStatus,
          };
          matchedContributor = updatedOffline;
          nextOffline = current.offlineContributors.map((c) =>
            c.id === contributorId ? updatedOffline : c
          );
        }
      }

      return {
        ...current,
        registryItems: nextRegistryItems,
        offlineContributors: nextOffline,
      };
    });

    if (method === 'DELETE' && !isAction) {
      if (!deleted) return jsonResponse({ error: 'Contributor not found.' }, 404);
      return jsonResponse({
        success: true,
        deletedId: contributorId,
        item: updatedParentItem,
        data: { deletedId: contributorId, item: updatedParentItem },
      });
    }
    if (!matchedContributor) {
      return jsonResponse({ error: 'Contributor not found.' }, 404);
    }
    return jsonResponse({
      success: true,
      changed: true,
      action: typeof body.action === 'string' ? body.action : 'confirm',
      contributor: matchedContributor,
      item: updatedParentItem,
      data: {
        changed: true,
        contributor: matchedContributor,
        item: updatedParentItem,
      },
    });
  }

  // 5. Admin Thank-You Notes (List, Offline Gift Persistence, Batch, Send-Email, Exports)
  if (path === '/api/admin/thank-you-notes' && method === 'POST') {
    const body = await parseJsonBody(init, rawInput);
    const name = String(body.name || '').trim();
    const amount = Number(body.amount ?? 0);
    if (!name) {
      return jsonResponse({ success: false, error: 'Donor name is required.' }, 400);
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return jsonResponse({ success: false, error: 'Gift amount must be greater than 0.' }, 400);
    }

    const nowIso = new Date().toISOString();
    const thankYouStatus = normalizeThankYouStatus(body.thankYouStatus);
    const targetItemId =
      typeof body.registryItemId === 'string' && body.registryItemId.trim()
        ? body.registryItemId.trim()
        : null;
    const invitationCodeId =
      typeof body.invitationCodeId === 'string' && body.invitationCodeId.trim()
        ? body.invitationCodeId.trim()
        : null;

    const createdRecord: ContributorRecord = {
      id: nextDemoId('demo-offline-gift'),
      name,
      isPlusOne: false,
      email: typeof body.email === 'string' && body.email.trim() ? body.email.trim() : null,
      amount: Math.round(amount * 100) / 100,
      refundedAmount: 0,
      status: 'CONFIRMED',
      coverFee: false,
      feeAmount: 0,
      date:
        typeof body.date === 'string' && body.date.trim()
          ? body.date.trim()
          : nowIso,
      transactionTimestamp: nowIso,
      message: typeof body.message === 'string' && body.message.trim() ? body.message.trim() : null,
      thankYouStatus,
      thankYouSentAt: thankYouStatus === 'Sent' ? nowIso : null,
      thankYouEmailSentAt: null,
      thankYouNote:
        typeof body.thankYouNote === 'string' && body.thankYouNote.trim()
          ? body.thankYouNote.trim()
          : null,
      invitationCodeId,
      registryItemId: targetItemId,
      addressLine1:
        typeof body.addressLine1 === 'string' && body.addressLine1.trim()
          ? body.addressLine1.trim()
          : null,
      addressLine2:
        typeof body.addressLine2 === 'string' && body.addressLine2.trim()
          ? body.addressLine2.trim()
          : null,
      city: typeof body.city === 'string' && body.city.trim() ? body.city.trim() : null,
      state: typeof body.state === 'string' && body.state.trim() ? body.state.trim() : null,
      zipCode: typeof body.zipCode === 'string' && body.zipCode.trim() ? body.zipCode.trim() : null,
      country:
        typeof body.country === 'string' && body.country.trim() ? body.country.trim() : null,
    };

    let matchedItem: RegistryItem | null = null;
    mutateActiveDataset((current) => {
      if (targetItemId) {
        const found = current.registryItems.find((r) => r.id === targetItemId) ?? null;
        if (found) {
          matchedItem = found;
          const nextRegistryItems = current.registryItems.map((item) => {
            if (item.id !== targetItemId) return item;
            const nextContributors = [createdRecord, ...(item.contributors || [])];
            const nextTotal = nextContributors.reduce(
              (sum, c) => (c.status === 'CANCELLED' ? sum : sum + c.amount),
              0
            );
            return {
              ...item,
              contributors: nextContributors,
              amountContributed: nextTotal,
              purchased: item.isGroupGift ? nextTotal >= item.price : true,
              purchaserName: item.purchaserName || createdRecord.name,
            };
          });
          return {
            ...current,
            registryItems: nextRegistryItems,
          };
        }
      }
      return {
        ...current,
        offlineContributors: [createdRecord, ...current.offlineContributors],
      };
    });

    const datasetAfter = getActiveArchetypeDataset();
    const guestById = new Map(datasetAfter.guests.map((g) => [g.id, g]));
    const dto = toThankYouNoteDto(createdRecord, matchedItem, guestById);

    recordDemoAuditVersion(
      'Contributor',
      createdRecord.id,
      'CREATE',
      `Recorded offline gift from ${createdRecord.name} (${formatCurrency(createdRecord.amount)})`,
      dto as unknown as Record<string, unknown>
    );

    return jsonResponse({ success: true, ...dto, item: dto, data: dto }, 201);
  }

  if (path === '/api/admin/thank-you-notes' && method === 'GET') {
    const dataset = getActiveArchetypeDataset();
    const guestById = new Map(dataset.guests.map((g) => [g.id, g]));
    const registryNotes = dataset.registryItems.flatMap((registryItem) =>
      (registryItem.contributors || []).map((contributor) =>
        toThankYouNoteDto(contributor, registryItem, guestById)
      )
    );
    const offlineNotes = dataset.offlineContributors.map((contributor) =>
      toThankYouNoteDto(contributor, null, guestById)
    );

    const allItems = [...offlineNotes, ...registryNotes].sort((a, b) =>
      String(b.date).localeCompare(String(a.date))
    );

    const sent = allItems.filter((i) => i.thankYouStatus === 'Sent').length;
    const notNeeded = allItems.filter((i) => i.thankYouStatus === 'Not Needed').length;
    const unsent = allItems.length - sent - notNeeded;
    const thanked = sent + notNeeded;

    const statusFilter = (url.searchParams.get('status') || 'all').trim().toLowerCase();
    const searchFilter = (url.searchParams.get('search') || '').trim().toLowerCase();
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const pageSize = Math.max(
      1,
      parseInt(url.searchParams.get('pageSize') || String(Math.max(50, allItems.length)), 10) || 50
    );

    const filtered = allItems.filter((item) => {
      if (statusFilter && statusFilter !== 'all') {
        const normalizedItem = item.thankYouStatus.toLowerCase().replace(/_/g, ' ');
        const normalizedTarget = statusFilter.replace(/_/g, ' ');
        if (normalizedItem !== normalizedTarget) return false;
      }
      if (searchFilter) {
        const matchesName = item.name.toLowerCase().includes(searchFilter);
        const matchesGift = (item.registryItem?.name || 'Offline Gift')
          .toLowerCase()
          .includes(searchFilter);
        const matchesNote = (item.message || '').toLowerCase().includes(searchFilter);
        if (!matchesName && !matchesGift && !matchesNote) return false;
      }
      return true;
    });

    const totalItems = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const pagedItems = filtered.slice((page - 1) * pageSize, page * pageSize);

    return jsonResponse({
      success: true,
      items: pagedItems,
      metrics: {
        total: allItems.length,
        sent,
        unsent,
        notNeeded,
        thanked,
        completionPercentage: allItems.length > 0 ? Math.round((thanked / allItems.length) * 100) : 0,
      },
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages,
      },
    });
  }

  if (path === '/api/admin/thank-you-notes/export' && (method === 'GET' || method === 'POST')) {
    const dataset = getActiveArchetypeDataset();
    const guestById = new Map(dataset.guests.map((g) => [g.id, g]));
    const rows = [
      ...dataset.offlineContributors.map((c) => toThankYouNoteDto(c, null, guestById)),
      ...dataset.registryItems.flatMap((item) =>
        (item.contributors || []).map((c) => toThankYouNoteDto(c, item, guestById))
      ),
    ];
    const csv = buildDemoCsv(
      [
        'Contributor Name',
        'Email',
        'Gift Item',
        'Amount',
        'Contribution Status',
        'Thank-You Status',
        'Sent At',
        'Note',
        'Mailing Address',
      ],
      rows.map((r) => {
        const ownAddress = [r.addressLine1, r.city, r.state, r.zipCode].filter(Boolean).join(', ');
        const fallbackAddress = r.invitationCode
          ? [
            r.invitationCode.addressLine1,
            r.invitationCode.city,
            r.invitationCode.state,
            r.invitationCode.zipCode,
          ]
            .filter(Boolean)
            .join(', ')
          : '';
        return [
          r.name,
          r.email ?? '',
          r.registryItem?.name || 'Offline Gift',
          r.amount.toFixed(2),
          r.status,
          r.thankYouStatus,
          r.thankYouSentAt ?? '',
          r.thankYouNote ?? '',
          ownAddress || fallbackAddress,
        ];
      })
    );
    return binaryResponse(
      csv,
      'text/csv; charset=utf-8',
      `thank-you-notes-${new Date().toISOString().slice(0, 10)}.csv`
    );
  }

  if (
    path === '/api/admin/thank-you-notes/export-labels' &&
    (method === 'GET' || method === 'POST')
  ) {
    const template = url.searchParams.get('template') === 'avery_5163' ? 'avery_5163' : 'avery_5160';
    const skipUnaddressed = url.searchParams.get('skipUnaddressed') !== 'false';
    const dataset = getActiveArchetypeDataset();
    const guestById = new Map(dataset.guests.map((g) => [g.id, g]));
    const rows = [
      ...dataset.offlineContributors.map((c) => toThankYouNoteDto(c, null, guestById)),
      ...dataset.registryItems.flatMap((item) =>
        (item.contributors || []).map((c) => toThankYouNoteDto(c, item, guestById))
      ),
    ];
    const lines: string[] = [];
    for (const r of rows) {
      const ownAddr = [r.addressLine1, r.addressLine2, r.city, r.state, r.zipCode]
        .filter(Boolean)
        .join(', ');
      const fallbackAddr = r.invitationCode
        ? [
          r.invitationCode.addressLine1,
          r.invitationCode.addressLine2,
          r.invitationCode.city,
          r.invitationCode.state,
          r.invitationCode.zipCode,
        ]
          .filter(Boolean)
          .join(', ')
        : '';
      const resolvedAddr = ownAddr || fallbackAddr;
      if (skipUnaddressed && !resolvedAddr) continue;
      lines.push(`${r.name} — ${resolvedAddr || 'Address pending'}`);
    }
    const title = `Thank-You Mailing Labels (${template === 'avery_5163' ? 'Avery 5163' : 'Avery 5160'})`;
    const pdf = createMinimalPdfBytes(
      title,
      lines.length > 0 ? lines : ['No mailing addresses on file yet.']
    );
    return binaryResponse(
      pdf,
      'application/pdf',
      `thank-you-labels-${template}-${new Date().toISOString().slice(0, 10)}.pdf`
    );
  }

  if (
    path === '/api/admin/thank-you-notes/batch' &&
    (method === 'POST' || method === 'PUT' || method === 'PATCH')
  ) {
    const body = await parseJsonBody(init, rawInput);
    const rawIds = body.ids ?? body.contributorIds ?? [];
    const ids = Array.isArray(rawIds)
      ? rawIds.filter((id): id is string => typeof id === 'string')
      : [];
    const nextStatus = normalizeThankYouStatus(body.thankYouStatus ?? body.status ?? 'Sent');
    const nowIso = new Date().toISOString();

    if (ids.length > 0) {
      const idSet = new Set(ids);
      mutateActiveDataset((current) => ({
        ...current,
        registryItems: current.registryItems.map((item) => ({
          ...item,
          contributors: (item.contributors || []).map((c) =>
            c.id && idSet.has(c.id)
              ? {
                ...c,
                thankYouStatus: nextStatus,
                thankYouSentAt: nextStatus === 'Sent' ? c.thankYouSentAt || nowIso : null,
              }
              : c
          ),
        })),
        offlineContributors: current.offlineContributors.map((c) =>
          c.id && idSet.has(c.id)
            ? {
              ...c,
              thankYouStatus: nextStatus,
              thankYouSentAt: nextStatus === 'Sent' ? c.thankYouSentAt || nowIso : null,
            }
            : c
        ),
      }));
    }
    return jsonResponse({ success: true, updatedCount: ids.length, count: ids.length });
  }

  if (
    path.startsWith('/api/admin/thank-you-notes/') &&
    path.endsWith('/send-email') &&
    method === 'POST'
  ) {
    const noteId = decodeURIComponent(
      path.slice('/api/admin/thank-you-notes/'.length, -'/send-email'.length)
    );
    const body = await parseJsonBody(init, rawInput);
    const mode = body.mode === 'test' || body.mode === 'send' ? body.mode : 'preview';
    const dataset = getActiveArchetypeDataset();
    let foundContributor: ContributorRecord | null =
      dataset.offlineContributors.find((c) => c.id === noteId) ?? null;
    let foundItem: RegistryItem | null = null;

    if (!foundContributor) {
      for (const regItem of dataset.registryItems) {
        const match = (regItem.contributors || []).find((c) => c.id === noteId);
        if (match) {
          foundContributor = match;
          foundItem = regItem;
          break;
        }
      }
    }
    if (!foundContributor) {
      return jsonResponse({ error: 'Contributor record not found' }, 404);
    }

    const linkedGuest = foundContributor.invitationCodeId
      ? dataset.guests.find((g) => g.id === foundContributor.invitationCodeId) ?? null
      : null;
    const demoState = getDemoState();
    const presetConfig = ARCHETYPE_PRESETS[demoState.archetype].siteConfig;
    const p1 = demoState.configOverrides.partner1Name || presetConfig.partner1Name;
    const p2 = demoState.configOverrides.partner2Name || presetConfig.partner2Name;
    const contactEmail = demoState.configOverrides.contactEmail || presetConfig.contactEmail;

    const rawBody = typeof body.body === 'string' ? body.body.trim() : '';
    const renderedText = formatDemoThankYouText(rawBody, {
      guestName: foundContributor.name,
      giftName: foundItem?.name || 'Wedding Gift',
      amount: foundContributor.amount,
    });
    const rawSubject =
      typeof body.subject === 'string' && body.subject.trim()
        ? body.subject.trim()
        : `Thank you from ${p1} & ${p2}!`;
    const safeSubject = rawSubject.replace(/[\r\n]+/g, ' ').trim();
    const overrideEmail =
      typeof body.recipientEmail === 'string' && body.recipientEmail.trim()
        ? body.recipientEmail.trim()
        : null;
    const resolvedRecipient =
      overrideEmail || foundContributor.email || linkedGuest?.email || null;

    if (mode === 'preview') {
      return jsonResponse({
        mode: 'preview',
        to: resolvedRecipient,
        testRecipient: contactEmail || null,
        subject: safeSubject,
        textBody: renderedText,
        htmlBody: formatDemoEmailHtml(renderedText),
      });
    }

    if (mode === 'test') {
      const targetTestEmail = overrideEmail || contactEmail || 'couple-demo@example.com';
      return jsonResponse({
        mode: 'test',
        to: targetTestEmail,
        subject: `[TEST] ${safeSubject}`,
        messageId: `demo-test-${Date.now()}`,
      });
    }

    if (!resolvedRecipient) {
      return jsonResponse(
        { error: 'Contributor has no email address on file. Please provide a recipient email.' },
        400
      );
    }
    const nowIso = new Date().toISOString();
    mutateActiveDataset((current) => ({
      ...current,
      registryItems: current.registryItems.map((item) => ({
        ...item,
        contributors: (item.contributors || []).map((c) =>
          c.id === noteId
            ? {
              ...c,
              ...(overrideEmail && !c.email ? { email: overrideEmail } : {}),
              thankYouStatus: 'Sent',
              thankYouSentAt: c.thankYouSentAt || nowIso,
              thankYouEmailSentAt: nowIso,
              thankYouNote: renderedText,
            }
            : c
        ),
      })),
      offlineContributors: current.offlineContributors.map((c) =>
        c.id === noteId
          ? {
            ...c,
            ...(overrideEmail && !c.email ? { email: overrideEmail } : {}),
            thankYouStatus: 'Sent',
            thankYouSentAt: c.thankYouSentAt || nowIso,
            thankYouEmailSentAt: nowIso,
            thankYouNote: renderedText,
          }
          : c
      ),
    }));
    return jsonResponse({
      mode: 'send',
      to: resolvedRecipient,
      subject: safeSubject,
      messageId: `demo-send-${Date.now()}`,
      thankYouStatus: 'Sent',
      thankYouSentAt: foundContributor.thankYouSentAt || nowIso,
      thankYouEmailSentAt: nowIso,
    });
  }

  if (path.startsWith('/api/admin/thank-you-notes/')) {
    const noteId = decodeURIComponent(path.slice('/api/admin/thank-you-notes/'.length));

    if (method === 'DELETE') {
      let removed = false;
      mutateActiveDataset((current) => {
        const nextOffline = current.offlineContributors.filter((c) => {
          if (c.id === noteId) {
            removed = true;
            return false;
          }
          return true;
        });
        const nextRegistryItems = current.registryItems.map((item) => {
          if (!(item.contributors || []).some((c) => c.id === noteId)) return item;
          removed = true;
          const nextContribs = item.contributors.filter((c) => c.id !== noteId);
          const nextTotal = nextContribs.reduce(
            (sum, c) => (c.status === 'CANCELLED' ? sum : sum + c.amount),
            0
          );
          return {
            ...item,
            contributors: nextContribs,
            amountContributed: nextTotal,
            purchased: item.isGroupGift ? nextTotal >= item.price : nextContribs.length > 0,
          };
        });
        return {
          ...current,
          offlineContributors: nextOffline,
          registryItems: nextRegistryItems,
        };
      });
      if (!removed) {
        return jsonResponse({ error: 'Thank-you note record not found.' }, 404);
      }
      return jsonResponse({ success: true, deletedId: noteId });
    }

    if (method === 'PATCH' || method === 'PUT') {
      const body = await parseJsonBody(init, rawInput);
      const nowIso = new Date().toISOString();
      let foundAny = false;

      const applyContributorPatch = (
        c: ContributorRecord,
        onSync: (inviteId: string, addr: Record<string, string>) => void
      ): ContributorRecord => {
        foundAny = true;
        const nextStatus =
          body.thankYouStatus !== undefined
            ? normalizeThankYouStatus(body.thankYouStatus)
            : normalizeThankYouStatus(c.thankYouStatus);
        const resolvedInviteId =
          body.invitationCodeId === null
            ? null
            : typeof body.invitationCodeId === 'string'
              ? body.invitationCodeId
              : (c.invitationCodeId ?? null);
        const nextContrib: ContributorRecord = {
          ...c,
          ...(typeof body.name === 'string' && body.name.trim() ? { name: body.name.trim() } : {}),
          ...(body.email === null || typeof body.email === 'string' ? { email: body.email } : {}),
          ...(typeof body.amount === 'number' && body.amount > 0 ? { amount: body.amount } : {}),
          thankYouStatus: nextStatus,
          thankYouSentAt:
            body.thankYouSentAt !== undefined
              ? typeof body.thankYouSentAt === 'string'
                ? body.thankYouSentAt
                : null
              : nextStatus === 'Sent'
                ? c.thankYouSentAt || nowIso
                : nextStatus === 'Unsent'
                  ? null
                  : (c.thankYouSentAt ?? null),
          ...(body.thankYouNote === null || typeof body.thankYouNote === 'string'
            ? { thankYouNote: body.thankYouNote }
            : {}),
          invitationCodeId: resolvedInviteId,
          ...(body.addressLine1 === null || typeof body.addressLine1 === 'string'
            ? { addressLine1: body.addressLine1 || null }
            : {}),
          ...(body.addressLine2 === null || typeof body.addressLine2 === 'string'
            ? { addressLine2: body.addressLine2 || null }
            : {}),
          ...(body.city === null || typeof body.city === 'string'
            ? { city: body.city || null }
            : {}),
          ...(body.state === null || typeof body.state === 'string'
            ? { state: body.state || null }
            : {}),
          ...(body.zipCode === null || typeof body.zipCode === 'string'
            ? { zipCode: body.zipCode || null }
            : {}),
          ...(body.country === null || typeof body.country === 'string'
            ? { country: body.country || null }
            : {}),
        };
        if (body.syncAddressToGuest && resolvedInviteId) {
          onSync(resolvedInviteId, {
            addressLine1: nextContrib.addressLine1 || '',
            addressLine2: nextContrib.addressLine2 || '',
            city: nextContrib.city || '',
            state: nextContrib.state || '',
            zipCode: nextContrib.zipCode || '',
            country: nextContrib.country || '',
          });
        }
        return nextContrib;
      };

      mutateActiveDataset((current) => {
        let targetInviteId: string | null = null;
        let syncedAddress: Record<string, string> | null = null;
        const captureSync = (inviteId: string, addr: Record<string, string>) => {
          targetInviteId = inviteId;
          syncedAddress = addr;
        };

        const nextRegistryItems = current.registryItems.map((item) => ({
          ...item,
          contributors: (item.contributors || []).map((c) =>
            c.id === noteId ? applyContributorPatch(c, captureSync) : c
          ),
        }));
        const nextOffline = current.offlineContributors.map((c) =>
          c.id === noteId ? applyContributorPatch(c, captureSync) : c
        );
        const nextGuests =
          syncedAddress && targetInviteId
            ? current.guests.map((g) => (g.id === targetInviteId ? { ...g, ...syncedAddress } : g))
            : current.guests;
        return {
          ...current,
          registryItems: nextRegistryItems,
          offlineContributors: nextOffline,
          guests: nextGuests,
        };
      });

      if (!foundAny) {
        return jsonResponse({ error: 'Contributor thank-you record not found.' }, 404);
      }
      return jsonResponse({ success: true, id: noteId, data: { id: noteId } });
    }
  }

  return null;
}
