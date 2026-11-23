import { isValidStripePublishableKey } from '@/lib/stripe.client';
import type {
  DemoContributorRecord,
  DemoRegistryItemRecord,
  NormalizedDemoRequest,
  StaticDemoSnapshot,
  StaticDemoStore,
} from '../types';
import {
  errorJson,
  generateDemoId,
  readJsonBody,
  wrapMiddlewareJson,
} from '../responseHelpers';
import {
  getActiveAppConfig,
  pushAuditVersion,
  recalculateRegistryItemTotals,
  toRegistryItemDto,
} from '../dtoMappers';
import { createDemoSvgDataUrl } from '../svgAssets';

const CLAIM_TOKEN_PREFIX = 'demo-claim:';

function encodeDemoClaimToken(
  action: 'confirm' | 'cancel',
  contributorId: string,
): string {
  return `${CLAIM_TOKEN_PREFIX}${action}:${contributorId}`;
}

function decodeDemoClaimToken(
  token: string,
): { action: 'confirm' | 'cancel'; contributorId: string } | null {
  if (!token.startsWith(CLAIM_TOKEN_PREFIX)) return null;
  const rest = token.slice(CLAIM_TOKEN_PREFIX.length);
  const sepIdx = rest.indexOf(':');
  if (sepIdx <= 0) return null;
  const action = rest.slice(0, sepIdx);
  const contributorId = rest.slice(sepIdx + 1).trim();
  if ((action !== 'confirm' && action !== 'cancel') || !contributorId) {
    return null;
  }
  return { action, contributorId };
}

function parseItemType(
  raw: unknown,
): 'PHYSICAL' | 'CASH_FUND' | 'EXPERIENCE_FUND' {
  if (raw === 'CASH_FUND' || raw === 'EXPERIENCE_FUND') {
    return raw;
  }
  return 'PHYSICAL';
}

function resolveClientSafeCapabilities(
  mode: 'browser' | 'msw',
  snapshot: StaticDemoSnapshot,
) {
  const config = getActiveAppConfig(snapshot);
  const shippingAddress = config.shippingAddressLine1
    ? {
      recipientName:
        config.shippingRecipientName ||
        `${config.partner1Name} & ${config.partner2Name}`,
      addressLine1: config.shippingAddressLine1,
      addressLine2: config.shippingAddressLine2 ?? '',
      city: config.shippingCity ?? '',
      state: config.shippingState ?? '',
      zip: config.shippingZip ?? '',
      country: config.shippingCountry ?? 'United States',
      phoneNumber: config.shippingPhone ?? '',
      deliveryNotes: config.shippingDeliveryNotes ?? '',
    }
    : null;

  if (mode === 'msw') {
    const pubKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    const secKey = process.env.STRIPE_SECRET_KEY;
    const hasExplicitEnv = pubKey !== undefined || secKey !== undefined;
    if (hasExplicitEnv) {
      const allowTestPlaceholder = process.env.NODE_ENV === 'test';
      const validPub = isValidStripePublishableKey(pubKey, allowTestPlaceholder);
      const trimmedSec = typeof secKey === 'string' ? secKey.trim() : '';
      const validSec =
        trimmedSec.length > 8 &&
        (trimmedSec.startsWith('sk_') || trimmedSec.startsWith('rk_')) &&
        (allowTestPlaceholder || !trimmedSec.includes('placeholder_mock_key'));
      const cardCheckoutEnabled = Boolean(validPub && validSec);
      return {
        cardCheckoutEnabled,
        stripePublishableKey: cardCheckoutEnabled && pubKey ? pubKey.trim() : null,
      };
    }
    return {
      cardCheckoutEnabled: true,
      stripePublishableKey: 'pk_test_msw_mock_publishable_key',
    };
  }

  const candidateKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  const validLiveKey = isValidStripePublishableKey(candidateKey, false);
  return {
    cardCheckoutEnabled: false,
    stripePublishableKey: validLiveKey ? candidateKey.trim() : null,
    defaultPaymentHandle: config.defaultPaymentHandle || '@AlexAndTaylor2026',
    defaultPaymentHandleType: config.defaultPaymentHandleType || 'Venmo',
    shippingAddress,
  };
}

export async function handleRegistryRoutes(
  req: NormalizedDemoRequest,
  store: StaticDemoStore,
  mode: 'browser' | 'msw',
): Promise<Response | null> {
  const { method, pathname, searchParams, request } = req;

  if (pathname === '/api/registry/capabilities' && method === 'GET') {
    const snapshot = store.getSnapshot();
    return wrapMiddlewareJson(resolveClientSafeCapabilities(mode, snapshot));
  }

  if (pathname === '/api/registry/items' && method === 'GET') {
    const snapshot = store.getSnapshot();
    const category = searchParams.get('category')?.trim();
    const items = snapshot.registryItem
      .filter((item) => {
        if (category && category !== 'All') {
          return item.category.toLowerCase() === category.toLowerCase();
        }
        return true;
      })
      .sort(
        (a, b) =>
          a.displayOrder - b.displayOrder || b.createdAt.localeCompare(a.createdAt),
      )
      .map((item) =>
        toRegistryItemDto(snapshot, item, {
          maskPublic: !snapshot.isAdminAuthenticated,
        }),
      );
    return wrapMiddlewareJson(items);
  }

  if (pathname === '/api/registry/items' && method === 'POST') {
    const body = await readJsonBody(request);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return errorJson(400, 'Gift name is required.');
    }
    const created = store.mutate((draft) => {
      const nowIso = new Date().toISOString();
      let imageId =
        typeof body.imageId === 'string' && body.imageId.trim()
          ? body.imageId.trim()
          : typeof body.mediaId === 'string' && body.mediaId.trim()
            ? body.mediaId.trim()
            : '';
      const rawImageUrl =
        typeof body.imageUrl === 'string' && body.imageUrl.trim()
          ? body.imageUrl.trim()
          : null;
      if (!imageId) {
        imageId = generateDemoId('media-reg');
        draft.media.unshift({
          id: imageId,
          url:
            rawImageUrl ||
            createDemoSvgDataUrl(
              name,
              typeof body.category === 'string' ? body.category : 'Registry',
              draft.activeArchetype,
            ),
          altText: `${name} product photo`,
          isDecorative: false,
          isSample: false,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      }
      const newItem: DemoRegistryItemRecord = {
        id: generateDemoId('reg'),
        name,
        description:
          typeof body.description === 'string' ? body.description : '',
        price: Math.max(0, Number(body.price ?? 0) || 0),
        amountContributed: 0,
        purchaserName: null,
        vendorUrl:
          typeof body.vendorUrl === 'string' && body.vendorUrl.trim()
            ? body.vendorUrl.trim()
            : null,
        quantity: Math.max(1, Number(body.quantity ?? 1) || 1),
        purchased: Boolean(body.purchased),
        isGroupGift: Boolean(body.isGroupGift),
        itemType: parseItemType(body.itemType),
        paymentHandle:
          typeof body.paymentHandle === 'string' && body.paymentHandle.trim()
            ? body.paymentHandle.trim()
            : null,
        paymentHandleType:
          typeof body.paymentHandleType === 'string' &&
          body.paymentHandleType.trim()
            ? body.paymentHandleType.trim()
            : null,
        isMostWanted: Boolean(body.isMostWanted),
        isSample: false,
        category:
          typeof body.category === 'string' && body.category.trim()
            ? body.category.trim()
            : 'Home',
        displayOrder: draft.registryItem.length + 1,
        imageId,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      draft.registryItem.push(newItem);
      pushAuditVersion(draft, 'RegistryItem', newItem.id, newItem);
      return toRegistryItemDto(draft, newItem);
    });

    return wrapMiddlewareJson(created, { status: 201 });
  }

  if (pathname === '/api/registry/items/batch' && method === 'POST') {
    const body = await readJsonBody(request);
    const rawItems = Array.isArray(body.items) ? body.items : [];
    const createdList = store.mutate((draft) => {
      const nowIso = new Date().toISOString();
      const added: Array<Record<string, unknown>> = [];
      for (const raw of rawItems) {
        if (!raw || typeof raw !== 'object') continue;
        const entry = raw as Record<string, unknown>;
        const name = typeof entry.name === 'string' ? entry.name.trim() : '';
        if (!name) continue;
        const imageId = generateDemoId('media-reg');
        const imgUrl =
          typeof entry.imageUrl === 'string' && entry.imageUrl.trim()
            ? entry.imageUrl.trim()
            : createDemoSvgDataUrl(name, 'Registry', draft.activeArchetype);
        draft.media.unshift({
          id: imageId,
          url: imgUrl,
          altText: `${name} product photo`,
          isDecorative: false,
          isSample: false,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
        const newItem: DemoRegistryItemRecord = {
          id: generateDemoId('reg'),
          name,
          description:
            typeof entry.description === 'string' ? entry.description : '',
          price: Math.max(0, Number(entry.price ?? 50) || 50),
          amountContributed: 0,
          purchaserName: null,
          vendorUrl:
            typeof entry.vendorUrl === 'string' ? entry.vendorUrl : null,
          quantity: Math.max(1, Number(entry.quantity ?? 1) || 1),
          purchased: false,
          isGroupGift: Boolean(entry.isGroupGift),
          itemType: parseItemType(entry.itemType),
          paymentHandle: null,
          paymentHandleType: null,
          isMostWanted: Boolean(entry.isMostWanted),
          isSample: false,
          category:
            typeof entry.category === 'string' && entry.category.trim()
              ? entry.category.trim()
              : 'Home',
          displayOrder: draft.registryItem.length + 1,
          imageId,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        draft.registryItem.push(newItem);
        added.push(toRegistryItemDto(draft, newItem));
      }
      return added;
    });

    return wrapMiddlewareJson(
      {
        createdCount: createdList.length,
        items: createdList,
      },
      { status: 201 },
    );
  }

  const itemMatch = pathname.match(/^\/api\/registry\/items\/([^/]+)$/);
  if (itemMatch) {
    const itemId = decodeURIComponent(itemMatch[1]);
    if (method === 'GET') {
      const snapshot = store.getSnapshot();
      const item = snapshot.registryItem.find((r) => r.id === itemId);
      if (!item) {
        return errorJson(404, 'Registry item not found');
      }
      return wrapMiddlewareJson(
        toRegistryItemDto(snapshot, item, {
          maskPublic: !snapshot.isAdminAuthenticated,
        }),
      );
    }

    if (method === 'PUT') {
      const body = await readJsonBody(request);
      const updated = store.mutate((draft) => {
        const item = draft.registryItem.find((r) => r.id === itemId);
        if (!item) return null;
        if (typeof body.name === 'string' && body.name.trim()) {
          item.name = body.name.trim();
        }
        if (typeof body.description === 'string') {
          item.description = body.description;
        }
        if (body.price !== undefined) {
          item.price = Math.max(0, Number(body.price) || 0);
        }
        if (body.vendorUrl !== undefined) {
          item.vendorUrl =
            typeof body.vendorUrl === 'string' && body.vendorUrl.trim()
              ? body.vendorUrl.trim()
              : null;
        }
        if (body.quantity !== undefined) {
          item.quantity = Math.max(1, Number(body.quantity) || 1);
        }
        if (typeof body.purchased === 'boolean') {
          item.purchased = body.purchased;
        }
        if (typeof body.isGroupGift === 'boolean') {
          item.isGroupGift = body.isGroupGift;
        }
        if (body.itemType !== undefined) {
          item.itemType = parseItemType(body.itemType);
        }
        if (body.paymentHandle !== undefined) {
          item.paymentHandle =
            typeof body.paymentHandle === 'string' && body.paymentHandle.trim()
              ? body.paymentHandle.trim()
              : null;
        }
        if (body.paymentHandleType !== undefined) {
          item.paymentHandleType =
            typeof body.paymentHandleType === 'string' &&
            body.paymentHandleType.trim()
              ? body.paymentHandleType.trim()
              : null;
        }
        if (typeof body.isMostWanted === 'boolean') {
          item.isMostWanted = body.isMostWanted;
        }
        if (typeof body.category === 'string' && body.category.trim()) {
          item.category = body.category.trim();
        }
        if (typeof body.imageId === 'string' && body.imageId.trim()) {
          item.imageId = body.imageId.trim();
        } else if (typeof body.imageUrl === 'string' && body.imageUrl.trim()) {
          const media = draft.media.find((m) => m.id === item.imageId);
          if (media) {
            media.url = body.imageUrl.trim();
            media.updatedAt = new Date().toISOString();
          } else {
            const newMediaId = generateDemoId('media-reg');
            draft.media.unshift({
              id: newMediaId,
              url: body.imageUrl.trim(),
              altText: `${item.name} product photo`,
              isDecorative: false,
              isSample: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
            item.imageId = newMediaId;
          }
        }
        item.updatedAt = new Date().toISOString();
        pushAuditVersion(draft, 'RegistryItem', item.id, item);
        return toRegistryItemDto(draft, item);
      });

      if (!updated) {
        return errorJson(404, 'Registry item not found');
      }
      return wrapMiddlewareJson(updated);
    }

    if (method === 'DELETE') {
      const deleted = store.mutate((draft) => {
        const idx = draft.registryItem.findIndex((r) => r.id === itemId);
        if (idx < 0) return false;
        const [removed] = draft.registryItem.splice(idx, 1);
        draft.contributor = draft.contributor.filter(
          (c) => c.registryItemId !== itemId,
        );
        pushAuditVersion(draft, 'RegistryItem', itemId, {
          deleted: true,
          previous: removed,
        });
        return true;
      });
      if (!deleted) {
        return errorJson(404, 'Registry item not found');
      }
      return wrapMiddlewareJson({ id: itemId, deleted: true });
    }
  }

  if (pathname === '/api/registry/contribute' && method === 'POST') {
    const body = await readJsonBody(request);
    const itemId = typeof body.itemId === 'string' ? body.itemId.trim() : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const amount = Number(body.amount ?? 0);

    if (!itemId || !name || !Number.isFinite(amount) || amount <= 0) {
      return errorJson(
        400,
        'Valid itemId, contributor name, and positive amount are required.',
      );
    }

    const outcome = store.mutate((draft) => {
      const item = draft.registryItem.find((r) => r.id === itemId);
      if (!item) {
        return { errorStatus: 404, errorMessage: 'Registry item not found' } as const;
      }
      if (item.isSample) {
        return {
          errorStatus: 400,
          errorMessage:
            'Sample registry items do not accept contributions or payments.',
        } as const;
      }

      const nowIso = new Date().toISOString();
      const paymentIntentId =
        typeof body.paymentIntentId === 'string' && body.paymentIntentId.trim()
          ? body.paymentIntentId.trim()
          : null;
      const codeInput =
        typeof body.code === 'string' && body.code.trim()
          ? body.code.trim()
          : draft.guestSession?.code ?? null;
      const matchedInvite = codeInput
        ? draft.invitationCode.find(
          (inv) => inv.code.toLowerCase() === codeInput.toLowerCase(),
        )
        : null;

      const contributorId = generateDemoId('contrib');
      const newContributor: DemoContributorRecord = {
        id: contributorId,
        name,
        email:
          typeof body.email === 'string' && body.email.trim()
            ? body.email.trim()
            : matchedInvite?.email ?? null,
        isPlusOne: false,
        amount: Math.round(amount * 100) / 100,
        refundedAmount: 0,
        status: paymentIntentId ? 'CONFIRMED' : 'RESERVED',
        coverFee: Boolean(body.coverFee),
        feeAmount: body.coverFee
          ? Math.round(amount * 0.029 * 100 + 30) / 100
          : 0,
        date: nowIso,
        message: typeof body.message === 'string' ? body.message : null,
        thankYouStatus: 'Unsent',
        thankYouSentAt: null,
        thankYouNote: null,
        stripePaymentIntentId: paymentIntentId,
        stripeChargeId: paymentIntentId ? `ch_demo_${contributorId}` : null,
        transactionTimestamp: nowIso,
        confirmationEmailSentAt: nowIso,
        alertEmailSentAt: nowIso,
        reminderEmailSentAt: null,
        retailerOrderNumber:
          typeof body.retailerOrderNumber === 'string'
            ? body.retailerOrderNumber
            : null,
        carrier: typeof body.carrier === 'string' ? body.carrier : null,
        trackingNumber:
          typeof body.trackingNumber === 'string' ? body.trackingNumber : null,
        registryItemId: item.id,
        invitationCodeId: matchedInvite?.id ?? null,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      draft.contributor.unshift(newContributor);
      recalculateRegistryItemTotals(draft, item.id);
      pushAuditVersion(draft, 'Contributor', newContributor.id, newContributor, name);

      const dto = toRegistryItemDto(draft, item);
      if (!paymentIntentId) {
        return {
          errorStatus: null,
          payload: {
            ...dto,
            claimActions: {
              confirmToken: encodeDemoClaimToken('confirm', contributorId),
              cancelToken: encodeDemoClaimToken('cancel', contributorId),
            },
          },
        } as const;
      }
      return { errorStatus: null, payload: dto } as const;
    });

    if (outcome.errorStatus !== null) {
      return errorJson(outcome.errorStatus, outcome.errorMessage);
    }
    return wrapMiddlewareJson(outcome.payload);
  }

  if (
    pathname === '/api/registry/claim' &&
    (method === 'GET' || method === 'POST')
  ) {
    if (method === 'GET') {
      const token = searchParams.get('token')?.trim() ?? '';
      const decoded = decodeDemoClaimToken(token);
      if (!decoded) {
        return errorJson(401, 'This gift link is invalid or has expired.');
      }
      const snapshot = store.getSnapshot();
      const contributor = snapshot.contributor.find(
        (c) => c.id === decoded.contributorId,
      );
      const item = contributor?.registryItemId
        ? snapshot.registryItem.find((r) => r.id === contributor.registryItemId)
        : null;
      if (!contributor || !item) {
        return errorJson(404, 'Gift reservation not found.');
      }
      const config = getActiveAppConfig(snapshot);
      return wrapMiddlewareJson({
        action: decoded.action,
        status: contributor.status,
        amount: contributor.amount,
        itemId: item.id,
        itemName: item.name,
        itemType: item.itemType || 'PHYSICAL',
        isGroupGift: Boolean(item.isGroupGift),
        vendorUrl: item.vendorUrl,
        paymentHandle: item.paymentHandle || config.defaultPaymentHandle || null,
        paymentHandleType:
          item.paymentHandleType || config.defaultPaymentHandleType || null,
      });
    }

    const body = await readJsonBody(request);
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    const decoded = decodeDemoClaimToken(token);
    if (!decoded) {
      return errorJson(401, 'This gift link is invalid or has expired.');
    }

    const mutated = store.mutate((draft) => {
      const contributor = draft.contributor.find(
        (c) => c.id === decoded.contributorId,
      );
      const item = contributor?.registryItemId
        ? draft.registryItem.find((r) => r.id === contributor.registryItemId)
        : null;
      if (!contributor || !item) return null;

      const targetStatus =
        decoded.action === 'confirm' ? 'CONFIRMED' : 'CANCELLED';
      const changed = contributor.status !== targetStatus;
      contributor.status = targetStatus;
      contributor.updatedAt = new Date().toISOString();
      recalculateRegistryItemTotals(draft, item.id);
      pushAuditVersion(draft, 'Contributor', contributor.id, contributor, 'Guest');

      return {
        action: decoded.action,
        status: contributor.status,
        changed,
        item: toRegistryItemDto(draft, item, { maskPublic: true }),
      };
    });

    if (!mutated) {
      return errorJson(404, 'Gift reservation not found.');
    }
    return wrapMiddlewareJson(mutated);
  }

  if (pathname === '/api/registry/payment-intent' && method === 'POST') {
    const body = await readJsonBody(request);
    const amount = Math.max(1, Number(body.amount ?? 50) || 50);
    const piId = generateDemoId('pi_demo');
    return wrapMiddlewareJson({
      clientSecret: `${piId}_secret_demo`,
      paymentIntentId: piId,
      amount: Math.round(amount * 100),
    });
  }

  if (pathname === '/api/registry/validate-code' && method === 'GET') {
    const code = searchParams.get('code')?.trim().toUpperCase();
    if (!code) {
      return errorJson(400, 'Code is required.');
    }
    const snapshot = store.getSnapshot();
    const invite = snapshot.invitationCode.find(
      (inv) => inv.code.toUpperCase() === code,
    );
    if (!invite) {
      return errorJson(404, 'Invalid invitation code.');
    }
    store.mutate((draft) => {
      draft.guestSession = {
        code: invite.code,
        guestName: invite.guestName,
        sessionType: 'invite',
      };
    });
    return wrapMiddlewareJson({
      valid: true,
      guestName: invite.guestName,
      code: invite.code,
    });
  }

  if (pathname === '/api/registry/session') {
    if (method === 'GET') {
      const snapshot = store.getSnapshot();
      const sessionCode = snapshot.guestSession?.code;
      const invite = sessionCode
        ? snapshot.invitationCode.find(
          (i) => i.code.toUpperCase() === sessionCode.toUpperCase(),
        )
        : null;
      if (!invite) {
        return wrapMiddlewareJson({
          isVerified: false,
          invitationCode: null,
          code: null,
          guestName: null,
        });
      }
      return wrapMiddlewareJson({
        isVerified: true,
        invitationCode: invite.code,
        code: invite.code,
        guestName: invite.guestName,
      });
    }

    if (method === 'DELETE') {
      store.mutate((draft) => {
        draft.guestSession = null;
      });
      return wrapMiddlewareJson({
        isVerified: false,
        invitationCode: null,
        code: null,
        guestName: null,
      });
    }
  }

  if (pathname === '/api/registry/scrape' && method === 'POST') {
    const body = await readJsonBody(request);
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    if (!url) {
      return errorJson(400, 'Product URL is required.');
    }
    const snapshot = store.getSnapshot();
    let hostLabel = 'Curated Gift';
    try {
      const parsed = new URL(url);
      hostLabel = parsed.hostname.replace(/^www\./, '');
    } catch {
      hostLabel = 'Registry Gift';
    }
    const title = `Artisan Gift from ${hostLabel}`;
    return wrapMiddlewareJson({
      title,
      name: title,
      description: `Imported preview from ${url}`,
      price: 125,
      imageUrl: createDemoSvgDataUrl(title, hostLabel, snapshot.activeArchetype),
      vendorUrl: url,
      category: 'Home',
    });
  }

  if (pathname === '/api/registry/scrape/batch' && method === 'POST') {
    const body = await readJsonBody(request);
    const urls = Array.isArray(body.urls)
      ? body.urls.filter(
        (u): u is string => typeof u === 'string' && u.trim().length > 0,
      )
      : [];
    const snapshot = store.getSnapshot();
    const results = urls.map((url, idx) => {
      let hostLabel = 'Retailer';
      try {
        hostLabel = new URL(url).hostname.replace(/^www\./, '');
      } catch {
        hostLabel = 'Store';
      }
      const title = `Gift Item ${idx + 1} (${hostLabel})`;
      return {
        url,
        success: true,
        data: {
          title,
          name: title,
          description: `Imported from ${url}`,
          price: 95 + idx * 25,
          imageUrl: createDemoSvgDataUrl(
            title,
            hostLabel,
            snapshot.activeArchetype,
          ),
          vendorUrl: url,
          category: 'Home',
        },
      };
    });
    return wrapMiddlewareJson({
      results,
      total: results.length,
      succeeded: results.length,
      failed: 0,
    });
  }

  if (pathname === '/api/registry/webhook/stripe' && method === 'POST') {
    return wrapMiddlewareJson({ received: true });
  }

  return null;
}
