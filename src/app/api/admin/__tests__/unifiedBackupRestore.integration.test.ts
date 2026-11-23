/** @jest-environment node */

jest.unmock('@prisma/client');
jest.unmock('@prisma/adapter-pg');
jest.unmock('pg');
jest.unmock('@/lib/prisma');

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { GET as exportBackup } from '../maintenance/export/route';
import { POST as importBackup } from '../maintenance/import/route';
import { POST as restoreVersion } from '../versions/[id]/restore/route';
import { isAdminRequest } from '@/core/auth/auth.server';
import { DEFAULT_MODULE_CONFIG } from '@/lib/modules';

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn(),
}));

const mockIsAdminRequest = isAdminRequest as jest.MockedFunction<
  typeof isAdminRequest
>;

async function wipeAllTables() {
  await prisma.$transaction([
    prisma.broadcastRecipient.deleteMany(),
    prisma.broadcastMessage.deleteMany(),
    prisma.subEventRsvp.deleteMany(),
    prisma.subEventAccess.deleteMany(),
    prisma.subEvent.deleteMany(),
    prisma.contributor.deleteMany(),
    prisma.registryItem.deleteMany(),
    prisma.invitationCode.deleteMany(),
    prisma.seatingTable.deleteMany(),
    prisma.attraction.deleteMany(),
    prisma.weddingPartyMember.deleteMany(),
    prisma.media.deleteMany(),
    prisma.contentNode.deleteMany(),
    prisma.appConfig.deleteMany(),
    prisma.snapshotVersion.deleteMany(),
  ]);
}

async function readStreamResponseJson(res: Response) {
  const maybeMock = res as unknown as {
    bodyContent?: ReadableStream<Uint8Array>;
  };
  const stream = maybeMock.bodyContent ?? res.body;
  if (stream && typeof stream.getReader === 'function') {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let out = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
    }
    out += decoder.decode();
    return JSON.parse(out);
  }
  return JSON.parse(await res.text());
}

describe('Unified 15-Model Backup, Restore & Rollback PostgreSQL Integration', () => {
  beforeEach(async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    await wipeAllTables();
  });

  afterAll(async () => {
    await wipeAllTables();
    await prisma.$disconnect();
  });

  it('round-trips all 15 Prisma models across export and clean restore while redacting and preserving provider secrets', async () => {
    await prisma.appConfig.create({
      data: {
        id: 'global',
        partner1Name: 'Alex',
        partner2Name: 'Taylor',
        brideName: 'Alex',
        groomName: 'Taylor',
        weddingDate: new Date('2026-09-19T16:00:00.000Z'),
        baseUrl: 'https://wedding.example.com',
        venueName: 'Conservatory Hall',
        venueAddress: '100 Park Ave',
        venueCity: 'Chicago',
        venueState: 'IL',
        venueZip: '60601',
        latitude: 41.88,
        longitude: -87.63,
        contactEmail: 'hosts@example.com',
        brandMonogram: 'A&T',
        brandLogoUrl: '/images/logo.svg',
        brandLogoAlt: 'Couple monogram logo',
        heroImageUrl: '/images/hero.jpg',
        heroImageAlt: 'Garden terrace',
        brandWatermarkUrl: '/images/watermark.svg',
        brandWatermarkAlt: 'Botanical crest',
        badgeGraphicUrl: '/images/badge.svg',
        badgeGraphicAlt: 'Seal',
        colorPrimary: '#2F5233',
        colorSecondary: '#B17457',
        themePreset: 'editorial',
        themeTokens: { '--color-surface': '#FAF7F2' },
        layoutContainerMaxWidth: '72rem',
        layoutGridGap: '2rem',
        layoutCardPadding: '2.25rem',
        layoutBorderRadius: '0.75rem',
        modules: { ...DEFAULT_MODULE_CONFIG, weather: false, gallery: false },
        timezone: 'America/Chicago',
        showCountdown: true,
        showAddToCalendar: true,
        emailProvider: 'smtp',
        smtpHost: 'smtp.example.com',
        smtpPort: 587,
        smtpUser: 'wedding-mailer',
        smtpPass: 'super-secret-smtp-pass',
        smtpFrom: 'invites@example.com',
        smtpSecure: true,
        resendApiKey: 're_live_secret_key',
        resendFrom: 'updates@example.com',
        sendgridApiKey: 'SG.live_secret_key',
        sendgridFrom: 'rsvp@example.com',
        smsProvider: 'twilio',
        twilioAccountSid: 'AC1234567890ABCDEF',
        twilioAuthToken: 'twilio-live-secret-token',
        twilioFromNumber: '+15550001111',
        broadcastBatchSize: 25,
        broadcastBatchDelayMs: 500,
      },
    });

    await prisma.contentNode.create({
      data: {
        id: 'node-faq-1',
        type: 'FAQ',
        tags: ['Homepage', 'FAQ'],
        data: {
          question: 'Is parking available?',
          answer: 'Complimentary valet at main gate.',
        },
      },
    });

    await prisma.media.create({
      data: {
        id: 'media-1',
        url: '/images/venue.jpg',
        altText: 'Conservatory exterior',
        isDecorative: false,
      },
    });

    await prisma.seatingTable.create({
      data: {
        id: 'table-1',
        name: 'Garden Table 1',
        shape: 'round',
        capacity: 10,
        x: 120,
        y: 240,
      },
    });

    // Seed 105 guests to exercise >100 row chunked cursor pagination in export
    const guestRows = Array.from({ length: 105 }, (_, idx) => ({
      id: `guest-${String(idx + 1).padStart(3, '0')}`,
      code: `INV-${String(idx + 1).padStart(3, '0')}`,
      guestName: `Guest ${idx + 1}`,
      email: `guest${idx + 1}@example.com`,
      dietaryNotes: idx === 0 ? 'Gluten-free' : null,
      plusOneAllocations: idx === 0 ? 1 : 0,
      partyTags: idx === 0 ? ['family', 'rehearsal'] : ['friends'],
      extraFields: idx === 0 ? { shuttleNeeded: true } : undefined,
      tableId: idx < 8 ? 'table-1' : null,
      seatNumber: idx < 8 ? idx + 1 : null,
    }));
    await prisma.invitationCode.createMany({ data: guestRows });

    await prisma.weddingPartyMember.create({
      data: {
        id: 'wp-1',
        name: 'Morgan Rivera',
        role: 'Best Person',
        side: 'BRIDE',
        bio: 'College roommate and lifelong friend.',
        photoId: 'media-1',
        order: 1,
      },
    });

    await prisma.attraction.create({
      data: {
        id: 'attr-hotel-1',
        name: 'Parkview Suites',
        description: 'Preferred guest hotel block.',
        imageId: 'media-1',
        category: 'Hotel',
        website: 'https://parkview.example.com',
        directions: 'Two blocks north of the conservatory.',
        latitude: 41.885,
        longitude: -87.628,
        isVisible: true,
        promoCode: 'ATWED26',
        bookingUrl: 'https://parkview.example.com/group',
        roomRate: '$199/night',
        cutoffDate: '2026-08-15',
        shuttleInfo: 'Continuous loop from 3:30 PM to midnight.',
      },
    });

    await prisma.registryItem.create({
      data: {
        id: 'reg-item-1',
        itemType: 'CASH_FUND',
        name: 'Honeymoon Rail Pass',
        description: 'Scenic train journey across the Alps.',
        category: 'Experiences',
        price: 300,
        imageId: 'media-1',
        quantity: 1,
        isGroupGift: true,
        amountContributed: 150,
      },
    });

    // Guest gift linked to InvitationCode via Contributor.invitationCodeId
    await prisma.contributor.create({
      data: {
        id: 'contrib-guest-1',
        name: 'Guest 1',
        email: 'guest1@example.com',
        amount: 150,
        coverFee: true,
        feeAmount: 4.65,
        message: 'Have an unforgettable trip!',
        thankYouStatus: 'Sent',
        thankYouSentAt: new Date('2026-09-25T10:00:00.000Z'),
        thankYouNote: 'Thank you so much for celebrating with us!',
        registryItemId: 'reg-item-1',
        invitationCodeId: 'guest-001',
      },
    });

    await prisma.subEvent.create({
      data: {
        id: 'subevent-1',
        title: 'Rehearsal Dinner',
        description: 'Private family dinner.',
        startTime: new Date('2026-09-18T23:00:00.000Z'),
        endTime: new Date('2026-09-19T02:00:00.000Z'),
        locationName: 'Bistro Salon',
        location: '55 State St',
        category: 'dinner',
        isPrivate: true,
      },
    });

    await prisma.subEventAccess.create({
      data: {
        id: 'access-1',
        subEventId: 'subevent-1',
        invitationCodeId: 'guest-001',
      },
    });

    await prisma.subEventRsvp.create({
      data: {
        id: 'rsvp-1',
        subEventId: 'subevent-1',
        invitationCodeId: 'guest-001',
        status: 'attending',
        plusOneCount: 1,
        dietaryNotes: 'Gluten-free',
      },
    });

    await prisma.broadcastMessage.create({
      data: {
        id: 'bcast-1',
        channel: 'EMAIL',
        subject: 'Weekend Arrival Details',
        body: 'Shuttle boarding begins at 3:30 PM.',
        targetFilters: { tags: ['family'] },
        status: 'SENT',
        totalRecipients: 1,
        sentCount: 1,
        sentAt: new Date('2026-09-10T15:00:00.000Z'),
      },
    });

    await prisma.broadcastRecipient.create({
      data: {
        id: 'recip-1',
        broadcastId: 'bcast-1',
        invitationCodeId: 'guest-001',
        guestName: 'Guest 1',
        destination: 'guest1@example.com',
        status: 'SENT',
        sentAt: new Date('2026-09-10T15:00:01.000Z'),
      },
    });

    await prisma.snapshotVersion.create({
      data: {
        id: 'snap-1',
        entityType: 'AppConfig',
        entityId: 'global',
        data: {
          id: 'global',
          partner1Name: 'Alex',
          smtpPass: 'should-be-redacted-in-snapshot',
          multisiteEnabled: true,
        },
        author: 'Admin',
      },
    });

    // 1. Export full v2.0 backup
    const exportRes = await exportBackup(
      new NextRequest('http://localhost/api/admin/maintenance/export'),
    );
    expect(exportRes.status).toBe(200);
    const exportedJson = await readStreamResponseJson(exportRes);

    expect(exportedJson.version).toBe('2.0');
    expect(exportedJson.schemaVersion).toBe('2.0');
    expect(exportedJson.invitationCode).toHaveLength(105);
    expect(exportedJson.seatingTable).toHaveLength(1);
    expect(exportedJson.subEvent).toHaveLength(1);
    expect(exportedJson.subEventAccess).toHaveLength(1);
    expect(exportedJson.subEventRsvp).toHaveLength(1);
    expect(exportedJson.broadcastMessage).toHaveLength(1);
    expect(exportedJson.broadcastRecipient).toHaveLength(1);
    expect(exportedJson.snapshotVersion).toHaveLength(1);

    // Zero virtual DTO keys and zero raw provider secrets in exported payload
    const exportedCfg = exportedJson.appConfig[0];
    expect(exportedCfg.multisiteEnabled).toBeUndefined();
    expect(exportedCfg.typographyScale).toBeUndefined();
    expect(exportedCfg.modules).toEqual({
      ...DEFAULT_MODULE_CONFIG,
      weather: false,
      gallery: false,
    });
    expect(exportedCfg.smtpPass).toBeUndefined();
    expect(exportedCfg.resendApiKey).toBeUndefined();
    expect(exportedCfg.sendgridApiKey).toBeUndefined();
    expect(exportedCfg.twilioAuthToken).toBeUndefined();
    expect(exportedCfg.smtpHost).toBe('smtp.example.com');
    expect(exportedCfg.twilioAccountSid).toBe('AC1234567890ABCDEF');
    expect(exportedCfg.layoutContainerMaxWidth).toBe('72rem');
    expect(exportedCfg.brandLogoUrl).toBe('/images/logo.svg');
    expect(exportedJson.snapshotVersion[0].data.smtpPass).toBeUndefined();
    expect(
      exportedJson.snapshotVersion[0].data.multisiteEnabled,
    ).toBeUndefined();

    // 2. Wipe database completely and perform clean restore into empty DB
    await wipeAllTables();

    const cleanImportRes = await importBackup(
      new NextRequest('http://localhost/api/admin/maintenance/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(exportedJson),
      }),
    );
    expect(cleanImportRes.status).toBe(200);

    expect(await prisma.invitationCode.count()).toBe(105);
    expect(await prisma.seatingTable.count()).toBe(1);
    expect(await prisma.subEvent.count()).toBe(1);
    expect(await prisma.subEventAccess.count()).toBe(1);
    expect(await prisma.subEventRsvp.count()).toBe(1);
    expect(await prisma.broadcastMessage.count()).toBe(1);
    expect(await prisma.broadcastRecipient.count()).toBe(1);

    const restoredContrib = await prisma.contributor.findUniqueOrThrow({
      where: { id: 'contrib-guest-1' },
    });
    expect(restoredContrib.invitationCodeId).toBe('guest-001');
    expect(restoredContrib.thankYouNote).toBe(
      'Thank you so much for celebrating with us!',
    );
    expect(restoredContrib.coverFee).toBe(true);

    // 3. Seed live provider secrets and verify re-import preserves them when backup omits secrets
    await prisma.appConfig.update({
      where: { id: 'global' },
      data: {
        smtpPass: 'preserved-live-smtp-pass',
        resendApiKey: 'preserved-live-resend-key',
        sendgridApiKey: 'preserved-live-sendgrid-key',
        twilioAuthToken: 'preserved-live-twilio-token',
      },
    });

    const preserveImportRes = await importBackup(
      new NextRequest('http://localhost/api/admin/maintenance/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(exportedJson),
      }),
    );
    expect(preserveImportRes.status).toBe(200);

    const restoredCfg = await prisma.appConfig.findUniqueOrThrow({
      where: { id: 'global' },
    });
    expect(restoredCfg.smtpPass).toBe('preserved-live-smtp-pass');
    expect(restoredCfg.resendApiKey).toBe('preserved-live-resend-key');
    expect(restoredCfg.sendgridApiKey).toBe('preserved-live-sendgrid-key');
    expect(restoredCfg.twilioAuthToken).toBe('preserved-live-twilio-token');
    expect(restoredCfg.smtpHost).toBe('smtp.example.com');
    expect(restoredCfg.layoutContainerMaxWidth).toBe('72rem');
    expect(restoredCfg.modules).toEqual({
      ...DEFAULT_MODULE_CONFIG,
      weather: false,
      gallery: false,
    });

    // Wait briefly for background Admin/BulkImport snapshots to settle before cleanup
    await new Promise((resolve) => setTimeout(resolve, 60));
  });

  it('imports legacy 1.0 backup into PostgreSQL by stripping virtual fields and clearing orphaned invitationCodeId links', async () => {
    const legacyV1Backup = {
      version: '1.0',
      schemaVersion: '1.0',
      exportedAt: '2026-05-01T12:00:00.000Z',
      appConfig: [
        {
          id: 'global',
          partner1Name: 'Casey',
          partner2Name: 'Riley',
          multisiteEnabled: false,
          typographyScale: { display: '3rem' },
          spacingScale: { container: '64rem' },
          borderTreatment: { radius: '1rem' },
          brandDimensions: { logoWidth: '120px' },
          fontHeading: 'Playfair Display',
          fontBody: 'Inter',
          fontMono: 'JetBrains Mono',
          modules: { rsvp: true, registry: true },
          createdAt: '2026-05-01T12:00:00.000Z',
          updatedAt: '2026-05-01T12:00:00.000Z',
        },
      ],
      media: [
        {
          id: 'm-legacy',
          url: '/images/gift.jpg',
          createdAt: '2026-05-01T12:00:00.000Z',
          updatedAt: '2026-05-01T12:00:00.000Z',
        },
      ],
      registryItem: [
        {
          id: 'ri-legacy',
          name: 'Espresso Machine',
          description: 'Morning coffee',
          category: 'Kitchen',
          price: 450,
          imageId: 'm-legacy',
          quantity: 1,
          createdAt: '2026-05-01T12:00:00.000Z',
          updatedAt: '2026-05-01T12:00:00.000Z',
        },
      ],
      contributor: [
        {
          id: 'c-legacy',
          name: 'Avery Kim',
          amount: 100,
          registryItemId: 'ri-legacy',
          invitationCodeId: 'deleted-or-unexported-v1-guest',
          createdAt: '2026-05-01T12:00:00.000Z',
          updatedAt: '2026-05-01T12:00:00.000Z',
        },
      ],
    };

    const res = await importBackup(
      new NextRequest('http://localhost/api/admin/maintenance/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(legacyV1Backup),
      }),
    );
    expect(res.status).toBe(200);

    const contrib = await prisma.contributor.findUniqueOrThrow({
      where: { id: 'c-legacy' },
    });
    expect(contrib.invitationCodeId).toBeNull();
    expect(contrib.registryItemId).toBe('ri-legacy');

    await new Promise((resolve) => setTimeout(resolve, 60));
  });

  it('restores historical snapshots in PostgreSQL across AppConfig, Attraction, Contributor, InvitationCode, SeatingTable, and SubEvent without dropping fields', async () => {
    await prisma.appConfig.create({
      data: {
        id: 'global',
        partner1Name: 'Edited Name',
        rsvpGracePeriodHours: 48,
        shippingRecipientName: 'Live Recipient',
        defaultPaymentHandle: '@live-handle',
        smtpHost: 'smtp.live.example.com',
        smtpPass: 'keep-this-smtp-secret',
        twilioAuthToken: 'keep-this-twilio-secret',
      },
    });

    const appSnap = await prisma.snapshotVersion.create({
      data: {
        entityType: 'AppConfig',
        entityId: 'global',
        data: {
          partner1Name: 'Original Name',
          partner2Name: 'Taylor',
          brandMonogram: 'O&T',
          brandLogoUrl: '/images/original-logo.svg',
          layoutContainerMaxWidth: '68rem',
        },
      },
    });

    const restoreAppRes = await restoreVersion(
      new NextRequest(
        `http://localhost/api/admin/versions/${appSnap.id}/restore`,
        { method: 'POST' },
      ),
      { params: Promise.resolve({ id: appSnap.id }) },
    );
    expect(restoreAppRes.status).toBe(200);

    const rolledBackConfig = await prisma.appConfig.findUniqueOrThrow({
      where: { id: 'global' },
    });
    expect(rolledBackConfig.partner1Name).toBe('Original Name');
    expect(rolledBackConfig.brandMonogram).toBe('O&T');
    expect(rolledBackConfig.brandLogoUrl).toBe('/images/original-logo.svg');
    expect(rolledBackConfig.layoutContainerMaxWidth).toBe('68rem');
    expect(rolledBackConfig.rsvpGracePeriodHours).toBe(48);
    expect(rolledBackConfig.shippingRecipientName).toBe('Live Recipient');
    expect(rolledBackConfig.defaultPaymentHandle).toBe('@live-handle');
    expect(rolledBackConfig.smtpHost).toBe('smtp.live.example.com');
    expect(rolledBackConfig.smtpPass).toBe('keep-this-smtp-secret');
    expect(rolledBackConfig.twilioAuthToken).toBe('keep-this-twilio-secret');

    const fullAppSnap = await prisma.snapshotVersion.create({
      data: {
        entityType: 'AppConfig',
        entityId: 'global',
        data: {
          partner1Name: 'Restored Partner 1',
          partner2Name: 'Restored Partner 2',
          rsvpOpen: false,
          rsvpDeadlineDate: '2026-10-01',
          rsvpGracePeriodHours: 24,
          rsvpClosedMessage: '<b>Window closed</b>',
          shippingRecipientName: 'Restored Couple',
          shippingAddressLine1: '742 Evergreen Terrace',
          shippingAddressLine2: 'Unit 2',
          shippingCity: 'Springfield',
          shippingState: 'IL',
          shippingZip: '62704',
          shippingCountry: 'USA',
          shippingPhone: '217-555-0100',
          shippingDeliveryNotes: 'Ring bell',
          defaultPaymentHandleType: 'Venmo',
          defaultPaymentHandle: '@restored-couple',
        },
      },
    });
    const fullRestoreRes = await restoreVersion(
      new NextRequest(
        `http://localhost/api/admin/versions/${fullAppSnap.id}/restore`,
        {
          method: 'POST',
        },
      ),
      { params: Promise.resolve({ id: fullAppSnap.id }) },
    );
    expect(fullRestoreRes.status).toBe(200);

    const fullyRestoredConfig = await prisma.appConfig.findUniqueOrThrow({
      where: { id: 'global' },
    });
    expect(fullyRestoredConfig.rsvpOpen).toBe(false);
    expect(fullyRestoredConfig.rsvpDeadlineDate).toBe('2026-10-01');
    expect(fullyRestoredConfig.rsvpGracePeriodHours).toBe(24);
    expect(fullyRestoredConfig.rsvpClosedMessage).toBe('Window closed');
    expect(fullyRestoredConfig.shippingRecipientName).toBe('Restored Couple');
    expect(fullyRestoredConfig.shippingAddressLine1).toBe(
      '742 Evergreen Terrace',
    );
    expect(fullyRestoredConfig.shippingAddressLine2).toBe('Unit 2');
    expect(fullyRestoredConfig.shippingCity).toBe('Springfield');
    expect(fullyRestoredConfig.shippingState).toBe('IL');
    expect(fullyRestoredConfig.shippingZip).toBe('62704');
    expect(fullyRestoredConfig.shippingCountry).toBe('USA');
    expect(fullyRestoredConfig.shippingPhone).toBe('217-555-0100');
    expect(fullyRestoredConfig.shippingDeliveryNotes).toBe('Ring bell');
    expect(fullyRestoredConfig.defaultPaymentHandleType).toBe('Venmo');
    expect(fullyRestoredConfig.defaultPaymentHandle).toBe('@restored-couple');
    expect(fullyRestoredConfig.smtpPass).toBe('keep-this-smtp-secret');
    expect(fullyRestoredConfig.twilioAuthToken).toBe('keep-this-twilio-secret');

    await prisma.media.create({
      data: { id: 'media-contrib-rollback', url: '/images/gift.jpg' },
    });
    await prisma.registryItem.create({
      data: {
        id: 'reg-contrib-rollback',
        name: 'Stand Mixer',
        description: 'Kitchen mixer',
        category: 'Kitchen',
        price: 350,
        imageId: 'media-contrib-rollback',
        quantity: 1,
      },
    });
    const contribSnap = await prisma.snapshotVersion.create({
      data: {
        entityType: 'Contributor',
        entityId: 'contrib-tracking-rollback',
        data: {
          name: 'Casey Rivera',
          email: 'casey@example.com',
          amount: 350,
          refundedAmount: 50,
          status: 'RESERVED',
          date: '2026-07-01T10:00:00.000Z',
          thankYouStatus: 'Sent',
          confirmationEmailSentAt: '2026-07-01T10:01:00.000Z',
          alertEmailSentAt: '2026-07-01T10:01:05.000Z',
          reminderEmailSentAt: '2026-07-02T10:00:00.000Z',
          retailerOrderNumber: 'AMZ-112-999',
          carrier: 'FedEx',
          trackingNumber: '777123456789',
          registryItemId: 'reg-contrib-rollback',
        },
      },
    });
    const contribRestoreRes = await restoreVersion(
      new NextRequest(
        `http://localhost/api/admin/versions/${contribSnap.id}/restore`,
        {
          method: 'POST',
        },
      ),
      { params: Promise.resolve({ id: contribSnap.id }) },
    );
    expect(contribRestoreRes.status).toBe(200);
    const restoredContrib = await prisma.contributor.findUniqueOrThrow({
      where: { id: 'contrib-tracking-rollback' },
    });
    expect(restoredContrib.refundedAmount).toBe(50);
    expect(restoredContrib.status).toBe('RESERVED');
    expect(restoredContrib.confirmationEmailSentAt?.toISOString()).toBe(
      '2026-07-01T10:01:00.000Z',
    );
    expect(restoredContrib.alertEmailSentAt?.toISOString()).toBe(
      '2026-07-01T10:01:05.000Z',
    );
    expect(restoredContrib.reminderEmailSentAt?.toISOString()).toBe(
      '2026-07-02T10:00:00.000Z',
    );
    expect(restoredContrib.retailerOrderNumber).toBe('AMZ-112-999');
    expect(restoredContrib.carrier).toBe('FedEx');
    expect(restoredContrib.trackingNumber).toBe('777123456789');

    const tableSnap = await prisma.snapshotVersion.create({
      data: {
        entityType: 'SeatingTable',
        entityId: 'st-rollback',
        data: {
          name: 'Sweetheart Table',
          shape: 'round',
          capacity: 2,
          x: 40,
          y: 80,
        },
      },
    });
    const tableRes = await restoreVersion(
      new NextRequest(
        `http://localhost/api/admin/versions/${tableSnap.id}/restore`,
        { method: 'POST' },
      ),
      { params: Promise.resolve({ id: tableSnap.id }) },
    );
    expect(tableRes.status).toBe(200);

    const inviteSnap = await prisma.snapshotVersion.create({
      data: {
        entityType: 'InvitationCode',
        entityId: 'inv-rollback',
        data: {
          code: 'ROLLBACK1',
          guestName: 'Robin Patel',
          dietaryNotes: 'Vegan',
          tableId: 'st-rollback',
          seatNumber: 1,
        },
      },
    });
    const inviteRes = await restoreVersion(
      new NextRequest(
        `http://localhost/api/admin/versions/${inviteSnap.id}/restore`,
        { method: 'POST' },
      ),
      { params: Promise.resolve({ id: inviteSnap.id }) },
    );
    expect(inviteRes.status).toBe(200);
    const restoredInvite = await prisma.invitationCode.findUniqueOrThrow({
      where: { id: 'inv-rollback' },
    });
    expect(restoredInvite.dietaryNotes).toBe('Vegan');
    expect(restoredInvite.tableId).toBe('st-rollback');
    expect(restoredInvite.seatNumber).toBe(1);
  });

  it('exports and imports a v2.0 backup where all 10 SQL-nullable outbound messaging columns are null', async () => {
    await prisma.appConfig.create({
      data: {
        id: 'global',
        partner1Name: 'Null',
        partner2Name: 'Delivery',
        baseUrl: 'https://wedding.example.com',
        smtpHost: null,
        smtpPort: null,
        smtpUser: null,
        smtpFrom: null,
        smtpSecure: null,
        resendFrom: null,
        sendgridFrom: null,
        smsProvider: null,
        twilioAccountSid: null,
        twilioFromNumber: null,
        smtpPass: 'preserved-smtp-secret',
      },
    });

    const exportRes = await exportBackup(
      new NextRequest('http://localhost/api/admin/maintenance/export', {
        method: 'GET',
      }),
      {},
    );
    expect(exportRes.status).toBe(200);
    const exportedJson = await readStreamResponseJson(exportRes);
    expect(exportedJson.appConfig[0].smtpHost).toBeNull();
    expect(exportedJson.appConfig[0].smtpPort).toBeNull();
    expect(exportedJson.appConfig[0].smtpSecure).toBeNull();
    expect(exportedJson.appConfig[0].twilioAccountSid).toBeNull();

    const importRes = await importBackup(
      new NextRequest('http://localhost/api/admin/maintenance/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(exportedJson),
      }),
      {},
    );
    expect(importRes.status).toBe(200);

    const importedConfig = await prisma.appConfig.findUniqueOrThrow({
      where: { id: 'global' },
    });
    expect(importedConfig.smtpHost).toBeNull();
    expect(importedConfig.smtpPort).toBeNull();
    expect(importedConfig.smtpUser).toBeNull();
    expect(importedConfig.smtpFrom).toBeNull();
    expect(importedConfig.smtpSecure).toBeNull();
    expect(importedConfig.resendFrom).toBeNull();
    expect(importedConfig.sendgridFrom).toBeNull();
    expect(importedConfig.smsProvider).toBeNull();
    expect(importedConfig.twilioAccountSid).toBeNull();
    expect(importedConfig.twilioFromNumber).toBeNull();
    expect(importedConfig.smtpPass).toBe('preserved-smtp-secret');

    await new Promise((resolve) => setTimeout(resolve, 60));
  });
});
