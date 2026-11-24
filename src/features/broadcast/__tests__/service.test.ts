import { prisma } from '@/lib/prisma';
import { getAppConfig } from '@/lib/config';
import { BroadcastService } from '../service';
import { MultiChannelMessagingProvider } from '../providers';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    invitationCode: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    broadcastMessage: {
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    broadcastRecipient: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn().mockResolvedValue({
    weddingDate: new Date('2026-10-25'),
    venueName: 'Grand Hall',
    emailProvider: 'none',
    broadcastBatchSize: 50,
    broadcastBatchDelayMs: 0,
  }),
}));

describe('BroadcastService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('resolveTargetGuests', () => {
    it('queries invitation codes with selectedIds filter', async () => {
      (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue([
        { id: '1', guestName: 'Alice' },
      ]);

      const res = await BroadcastService.resolveTargetGuests({ selectedIds: ['1'] });
      expect(prisma.invitationCode.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['1'] } },
      });
      expect(res).toHaveLength(1);
    });

    it('queries invitation codes with partyTags filter', async () => {
      (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue([
        { id: '2', guestName: 'Bob', partyTags: ['VIP'] },
      ]);

      await BroadcastService.resolveTargetGuests({ partyTags: ['VIP'] });
      expect(prisma.invitationCode.findMany).toHaveBeenCalledWith({
        where: { partyTags: { hasSome: ['VIP'] } },
      });
    });

    it('excludes isSample: true records in live server mode while preserving them when STATIC_EXPORT=true', async () => {
      const mixedSampleAndLive = [
        { id: 'live-1', guestName: 'Real Guest', email: 'real@example.com', isSample: false },
        { id: 'sample-1', guestName: 'Sample Guest', email: 'sample@example.com', isSample: true },
      ];
      (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue(mixedSampleAndLive);

      const originalStaticExport = process.env.STATIC_EXPORT;
      try {
        delete process.env.STATIC_EXPORT;
        const unfilteredLive = await BroadcastService.resolveTargetGuests();
        expect(unfilteredLive.map((g) => g.id)).toEqual(['live-1']);

        const filteredLive = await BroadcastService.resolveTargetGuests({
          selectedIds: ['live-1', 'sample-1'],
        });
        expect(filteredLive.map((g) => g.id)).toEqual(['live-1']);

        process.env.STATIC_EXPORT = 'true';
        const showcaseUnfiltered = await BroadcastService.resolveTargetGuests();
        expect(showcaseUnfiltered.map((g) => g.id)).toEqual(['live-1', 'sample-1']);

        const showcaseFiltered = await BroadcastService.resolveTargetGuests({
          selectedIds: ['live-1', 'sample-1'],
        });
        expect(showcaseFiltered.map((g) => g.id)).toEqual(['live-1', 'sample-1']);
      } finally {
        if (originalStaticExport === undefined) {
          delete process.env.STATIC_EXPORT;
        } else {
          process.env.STATIC_EXPORT = originalStaticExport;
        }
      }
    });

    describe('attendance status filtering via domain utility', () => {
      const mockGuestList = [
        // Attending guests
        { id: 'g1', guestName: 'Alice Attending', used: true, extraFields: null },
        { id: 'g2', guestName: 'Bob Confirmed', used: false, extraFields: { attendanceStatus: 'attending' } },
        { id: 'g3', guestName: 'Charlie Yes', used: true, extraFields: { rsvpStatus: 'yes' } },
        // Declined guests
        { id: 'g4', guestName: 'David Declined', used: false, extraFields: { attendanceStatus: 'declined' } },
        { id: 'g5', guestName: 'Eve No', used: false, extraFields: { rsvp: 'no' } },
        { id: 'g6', guestName: 'Frank Rejected', used: true, extraFields: { attendanceStatus: false } },
        // Pending guests
        { id: 'g7', guestName: 'Grace Pending Unused', used: false, extraFields: null },
        { id: 'g8', guestName: 'Heidi Explicit Pending', used: false, extraFields: { status: 'pending' } },
      ];

      beforeEach(() => {
        (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue(mockGuestList);
      });

      it('excludes declined and attending guests when filtering by pending status', async () => {
        const res = await BroadcastService.resolveTargetGuests({ attendanceStatus: 'pending' });

        expect(prisma.invitationCode.findMany).toHaveBeenCalledWith({ where: {} });
        const ids = res.map((g) => g.id);
        expect(ids).toEqual(['g7', 'g8']);
        expect(res.every((g) => ['Grace Pending Unused', 'Heidi Explicit Pending'].includes(g.guestName))).toBe(true);
        // Explicitly verify zero declined guests are returned
        expect(res.some((g) => ['David Declined', 'Eve No', 'Frank Rejected'].includes(g.guestName))).toBe(false);
      });

      it('excludes pending and attending guests when filtering by declined status', async () => {
        const res = await BroadcastService.resolveTargetGuests({ attendanceStatus: 'declined' });

        const ids = res.map((g) => g.id);
        expect(ids).toEqual(['g4', 'g5', 'g6']);
        expect(res.every((g) => ['David Declined', 'Eve No', 'Frank Rejected'].includes(g.guestName))).toBe(true);
        // Explicitly verify zero pending guests are returned
        expect(res.some((g) => ['Grace Pending Unused', 'Heidi Explicit Pending'].includes(g.guestName))).toBe(false);
      });

      it('returns attending guests when filtering by attending status', async () => {
        const res = await BroadcastService.resolveTargetGuests({ attendanceStatus: 'attending' });

        const ids = res.map((g) => g.id);
        expect(ids).toEqual(['g1', 'g2', 'g3']);
        expect(res.every((g) => ['Alice Attending', 'Bob Confirmed', 'Charlie Yes'].includes(g.guestName))).toBe(true);
        expect(res.some((g) => ['David Declined', 'Grace Pending Unused'].includes(g.guestName))).toBe(false);
      });

      it('returns all guests without attendance filtering when attendanceStatus is all', async () => {
        const res = await BroadcastService.resolveTargetGuests({ attendanceStatus: 'all' });
        expect(res).toHaveLength(mockGuestList.length);
      });

      it('returns all guests when filters is undefined', async () => {
        const res = await BroadcastService.resolveTargetGuests();
        expect(res).toHaveLength(mockGuestList.length);
      });

      it('filters attendance within selectedIds when both are supplied', async () => {
        (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue([
          { id: 'g4', guestName: 'David Declined', used: false, extraFields: { attendanceStatus: 'declined' } },
          { id: 'g7', guestName: 'Grace Pending Unused', used: false, extraFields: null },
        ]);

        const res = await BroadcastService.resolveTargetGuests({
          selectedIds: ['g4', 'g7'],
          attendanceStatus: 'pending',
        });

        expect(prisma.invitationCode.findMany).toHaveBeenCalledWith({
          where: { id: { in: ['g4', 'g7'] } },
        });
        expect(res).toHaveLength(1);
        expect(res[0].id).toBe('g7');
      });

      it('partitions 200 wedding guests in under 10 milliseconds', async () => {
        const largeGuestList = Array.from({ length: 200 }, (_, i) => {
          if (i % 3 === 0) {
            return { id: `id-${i}`, guestName: `Guest ${i}`, used: true, extraFields: null };
          }
          if (i % 3 === 1) {
            return { id: `id-${i}`, guestName: `Guest ${i}`, used: false, extraFields: { attendanceStatus: 'declined' } };
          }
          return { id: `id-${i}`, guestName: `Guest ${i}`, used: false, extraFields: null };
        });

        (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue(largeGuestList);

        const start = performance.now();
        const pending = await BroadcastService.resolveTargetGuests({ attendanceStatus: 'pending' });
        const declined = await BroadcastService.resolveTargetGuests({ attendanceStatus: 'declined' });
        const attending = await BroadcastService.resolveTargetGuests({ attendanceStatus: 'attending' });
        const elapsed = performance.now() - start;

        expect(pending.length + declined.length + attending.length).toBe(200);
        expect(elapsed).toBeLessThan(10);
      });
    });

    describe('public address-collection isolation', () => {
      const mixedGuestList = [
        { id: 'invited-1', guestName: 'Invited Alice', partyTags: ['VIP'] },
        { id: 'invited-2', guestName: 'Invited Bob', partyTags: [] },
        { id: 'public-1', guestName: 'Public Respondent', partyTags: ['address-collection'] },
        { id: 'public-2', guestName: 'Tagged Public Respondent', partyTags: ['VIP', 'address-collection'] },
      ];

      beforeEach(() => {
        (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue(mixedGuestList);
      });

      it('excludes address-collection records by default when filters are omitted or empty', async () => {
        const resNoFilters = await BroadcastService.resolveTargetGuests();
        expect(resNoFilters.map((g) => g.id)).toEqual(['invited-1', 'invited-2']);

        const resEmptyFilters = await BroadcastService.resolveTargetGuests({});
        expect(resEmptyFilters.map((g) => g.id)).toEqual(['invited-1', 'invited-2']);
      });

      it('excludes address-collection records when filtering by other partyTags or searchQuery', async () => {
        (prisma.invitationCode.findMany as jest.Mock).mockResolvedValueOnce([
          mixedGuestList[0],
          mixedGuestList[3],
        ]);
        const resVip = await BroadcastService.resolveTargetGuests({ partyTags: ['VIP'] });
        expect(resVip.map((g) => g.id)).toEqual(['invited-1']);

        (prisma.invitationCode.findMany as jest.Mock).mockResolvedValueOnce([
          mixedGuestList[2],
          mixedGuestList[3],
        ]);
        const resSearch = await BroadcastService.resolveTargetGuests({ searchQuery: 'Respondent' });
        expect(resSearch).toEqual([]);
      });

      it('includes address-collection records when targetFilters.partyTags includes address-collection', async () => {
        (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue([
          mixedGuestList[2],
          mixedGuestList[3],
        ]);

        const res = await BroadcastService.resolveTargetGuests({
          partyTags: ['address-collection'],
        });
        expect(res.map((g) => g.id)).toEqual(['public-1', 'public-2']);
      });

      it('includes address-collection records when targetFilters.selectedIds explicitly names them', async () => {
        (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue([
          mixedGuestList[0],
          mixedGuestList[2],
        ]);

        const res = await BroadcastService.resolveTargetGuests({
          selectedIds: ['invited-1', 'public-1'],
        });
        expect(res.map((g) => g.id)).toEqual(['invited-1', 'public-1']);
      });
    });

    describe('all seven guest list filters parity', () => {
      const comprehensiveGuests = [
        {
          id: 'match-1',
          guestName: 'Elena Gilbert',
          code: 'ELENA1',
          email: 'elena@example.com',
          used: false,
          addressLine1: '',
          city: '',
          state: '',
          zipCode: '',
          dietaryNotes: 'Gluten-free',
          partyGroup: 'Bride',
          partyTags: ['Bridal Party', 'Out of Town'],
          plusOneFirstName: 'Stefan',
          plusOneLastName: 'Salvatore',
          extraFields: { attendanceStatus: 'pending', phone: '+15552223333' },
        },
        {
          id: 'nonmatch-redeemed',
          guestName: 'Elena Redeemed',
          code: 'ELENA2',
          email: 'elena2@example.com',
          used: true,
          addressLine1: '',
          city: '',
          state: '',
          zipCode: '',
          dietaryNotes: 'Gluten-free',
          partyGroup: 'Bride',
          partyTags: ['Bridal Party'],
          plusOneFirstName: 'Stefan',
          extraFields: { attendanceStatus: 'pending' },
        },
        {
          id: 'nonmatch-complete-addr',
          guestName: 'Elena CompleteAddr',
          code: 'ELENA3',
          email: 'elena3@example.com',
          used: false,
          addressLine1: '100 Oak Rd',
          city: 'Mystic Falls',
          state: 'VA',
          zipCode: '22901',
          dietaryNotes: 'Gluten-free',
          partyGroup: 'Bride',
          partyTags: ['Bridal Party'],
          plusOneFirstName: 'Stefan',
          extraFields: { attendanceStatus: 'pending' },
        },
        {
          id: 'nonmatch-dietary',
          guestName: 'Elena Vegan',
          code: 'ELENA4',
          email: 'elena4@example.com',
          used: false,
          addressLine1: '',
          city: '',
          state: '',
          zipCode: '',
          dietaryNotes: 'Vegan',
          partyGroup: 'Bride',
          partyTags: ['Bridal Party'],
          plusOneFirstName: 'Stefan',
          extraFields: { attendanceStatus: 'pending' },
        },
        {
          id: 'nonmatch-group',
          guestName: 'Elena GroomSide',
          code: 'ELENA5',
          email: 'elena5@example.com',
          used: false,
          addressLine1: '',
          city: '',
          state: '',
          zipCode: '',
          dietaryNotes: 'Gluten-free',
          partyGroup: 'Groom',
          partyTags: ['Bridal Party'],
          plusOneFirstName: 'Stefan',
          extraFields: { attendanceStatus: 'pending' },
        },
        {
          id: 'public-addr-col',
          guestName: 'Elena Public',
          code: 'ELENA6',
          email: 'elena6@example.com',
          used: false,
          addressLine1: '',
          city: '',
          state: '',
          zipCode: '',
          dietaryNotes: 'Gluten-free',
          partyGroup: 'Bride',
          partyTags: ['Bridal Party', 'address-collection'],
          plusOneFirstName: 'Stefan',
          extraFields: { attendanceStatus: 'pending' },
        },
      ];

      it('evaluates status, addressStatus, attendanceStatus, dietaryCategory, partyGroup, partyTags, and searchQuery simultaneously', async () => {
        (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue(comprehensiveGuests);

        const res = await BroadcastService.resolveTargetGuests({
          searchQuery: 'Stefan',
          status: 'unused',
          addressStatus: 'missing',
          attendanceStatus: 'pending',
          dietaryCategory: 'gluten-free',
          partyGroup: 'Bride',
          partyTags: ['Bridal Party'],
        });

        expect(prisma.invitationCode.findMany).toHaveBeenCalledWith({
          where: {
            partyTags: { hasSome: ['Bridal Party'] },
            used: false,
            partyGroup: 'Bride',
          },
        });
        expect(res.map((g) => g.id)).toEqual(['match-1']);
      });
    });
  });

  describe('renderPreview', () => {
    it('renders preview with sample guest details', async () => {
      (prisma.invitationCode.findUnique as jest.Mock).mockResolvedValue({
        id: '1',
        guestName: 'Charlie',
        code: 'CHARLIE2026',
        householdName: 'Charlie Family',
        email: 'charlie@example.com',
      });

      const preview = await BroadcastService.renderPreview({
        channel: 'EMAIL',
        subject: 'Hello {{guestName}}',
        body: 'Welcome to {{venueName}}, {{guestName}}! Your code is {{code}}.',
        sampleGuestId: '1',
      });

      expect(preview.subject).toBe('Hello Charlie');
      expect(preview.body).toBe('Welcome to Grand Hall, Charlie! Your code is CHARLIE2026.');
      expect(preview.destination).toBe('charlie@example.com');
    });

    it('displays sample recipient data matching the selected attendance status filter', async () => {
      (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue([
        // g1 is declined, g2 is pending
        { id: 'g1', guestName: 'Declined Guest', code: 'DEC1', email: 'dec@example.com', used: false, extraFields: { attendanceStatus: 'declined' } },
        { id: 'g2', guestName: 'Pending Guest', code: 'PEN1', email: 'pen@example.com', used: false, extraFields: null },
      ]);

      const preview = await BroadcastService.renderPreview({
        channel: 'EMAIL',
        subject: 'Reminder for {{guestName}}',
        body: 'Please RSVP {{guestName}} using {{code}}!',
        targetFilters: { attendanceStatus: 'pending' },
      });

      expect(preview.sampleGuestName).toBe('Pending Guest');
      expect(preview.subject).toBe('Reminder for Pending Guest');
      expect(preview.body).toContain('Pending Guest using PEN1');
      expect(preview.destination).toBe('pen@example.com');
    });

    it('returns unescaped preview body strings for both EMAIL and SMS while sanitizing CR/LF/<> in EMAIL subjects', async () => {
      (prisma.invitationCode.findUnique as jest.Mock).mockResolvedValue({
        id: 'canary-1',
        guestName: 'Sean O\'Connor\r\nInjected',
        code: 'CANARY1',
        householdName: '<i data-canary="household-html-marker">O\'Connor & Family</i>',
        email: 'oconnor@example.com',
        extraFields: { phone: '+15550001111' },
      });

      const emailPreview = await BroadcastService.renderPreview({
        channel: 'EMAIL',
        subject: 'Event update for {{guestName}} ({{householdName}})',
        body: 'Dear {{guestName}} ({{householdName}}), we can\'t wait & hope to see you!',
        sampleGuestId: 'canary-1',
      });

      expect(emailPreview.body).toBe(
        'Dear Sean O\'Connor\r\nInjected (<i data-canary="household-html-marker">O\'Connor & Family</i>), we can\'t wait & hope to see you!'
      );
      expect(emailPreview.body).not.toContain('&#39;');
      expect(emailPreview.body).not.toContain('&amp;');
      expect(emailPreview.subject).toBe(
        'Event update for Sean O\'ConnorInjected (i data-canary="household-html-marker"O\'Connor & Family/i)'
      );
      expect(emailPreview.subject).not.toMatch(/[\r\n<>]/);

      const smsPreview = await BroadcastService.renderPreview({
        channel: 'SMS',
        body: 'Hi {{householdName}}!',
        sampleGuestId: 'canary-1',
      });
      expect(smsPreview.body).toBe('Hi <i data-canary="household-html-marker">O\'Connor & Family</i>!');
    });

    it('includes matchedCount and missingContactCount when targetFilters are provided', async () => {
      (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue([
        { id: 'g1', guestName: 'Alice', code: 'A1', email: 'alice@example.com', used: false, extraFields: { phone: '+15551112222' } },
        { id: 'g2', guestName: 'Bob', code: 'B1', email: null, used: false, extraFields: {} },
      ]);

      const smsPreview = await BroadcastService.renderPreview({
        channel: 'SMS',
        body: 'Reminder for {{guestName}}',
        targetFilters: { status: 'unused' },
      });

      expect(smsPreview.matchedCount).toBe(2);
      expect(smsPreview.missingContactCount).toBe(1);
    });
  });

  describe('sendBroadcast', () => {
    it('creates message, creates recipients, dispatches, and returns updated broadcast', async () => {
      const mockGuests = [
        { id: 'g1', guestName: 'David', code: 'D123', email: 'david@example.com', householdName: 'David HH' },
      ];
      (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue(mockGuests);
      (prisma.broadcastMessage.create as jest.Mock).mockResolvedValue({
        id: 'bm1',
        status: 'SENDING',
      });
      (prisma.broadcastRecipient.create as jest.Mock).mockResolvedValue({
        id: 'br1',
        broadcastId: 'bm1',
        destination: 'david@example.com',
        status: 'PENDING',
      });
      (prisma.broadcastMessage.update as jest.Mock).mockResolvedValue({
        id: 'bm1',
        status: 'SENT',
        sentCount: 1,
        failedCount: 0,
      });

      const result = await BroadcastService.sendBroadcast({
        channel: 'EMAIL',
        subject: 'Subject for {{guestName}}',
        body: 'Body for {{guestName}}',
        targetFilters: { selectedIds: ['g1'] },
      });

      expect(prisma.broadcastMessage.create).toHaveBeenCalled();
      expect(prisma.broadcastRecipient.create).toHaveBeenCalled();
      expect(result.status).toBe('SENT');
      expect(result.sentCount).toBe(1);
    });

    it('escapes HTML placeholders and sanitizes subjects during EMAIL dispatch while keeping SMS plain text', async () => {
      const mockGuests = [
        {
          id: 'g-html',
          guestName: '<b data-canary="guest-html-marker">O\'Connor</b>',
          code: 'OC2026',
          email: 'oconnor@example.com',
          householdName: "O'Connor & Family",
          extraFields: { phone: '+15551112222' },
        },
      ];
      (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue(mockGuests);
      (prisma.broadcastMessage.create as jest.Mock).mockResolvedValue({
        id: 'bm-escape',
        status: 'SENDING',
      });
      (prisma.broadcastRecipient.create as jest.Mock).mockResolvedValue({
        id: 'br-escape',
        broadcastId: 'bm-escape',
        destination: 'oconnor@example.com',
        status: 'PENDING',
      });
      (prisma.broadcastMessage.update as jest.Mock).mockResolvedValue({
        id: 'bm-escape',
        status: 'SENT',
        sentCount: 1,
        failedCount: 0,
      });

      const sendEmailSpy = jest
        .spyOn(MultiChannelMessagingProvider.prototype, 'sendEmail')
        .mockResolvedValue({ success: true });
      const sendSmsSpy = jest
        .spyOn(MultiChannelMessagingProvider.prototype, 'sendSms')
        .mockResolvedValue({ success: true });

      await BroadcastService.sendBroadcast({
        channel: 'EMAIL',
        subject: 'Update for {{guestName}} ({{householdName}})\r\nBcc: bad@example.invalid',
        body: '<p>Hello {{guestName}} of {{householdName}}</p>',
        targetFilters: { selectedIds: ['g-html'] },
      });

      expect(sendEmailSpy).toHaveBeenCalledWith({
        to: 'oconnor@example.com',
        subject: 'Update for b data-canary="guest-html-marker"O\'Connor/b (O\'Connor & Family)Bcc: bad@example.invalid',
        body: '<p>Hello &lt;b data-canary=&quot;guest-html-marker&quot;&gt;O&#39;Connor&lt;/b&gt; of O&#39;Connor &amp; Family</p>',
      });

      await BroadcastService.sendBroadcast({
        channel: 'SMS',
        body: 'Hello {{householdName}}!',
        targetFilters: { selectedIds: ['g-html'] },
      });

      expect(sendSmsSpy).toHaveBeenCalledWith({
        to: '+15551112222',
        body: "Hello O'Connor & Family!",
      });

      sendEmailSpy.mockRestore();
      sendSmsSpy.mockRestore();
    });

    describe('transactional bulk recipient insertion and chunking', () => {
      beforeEach(() => {
        (prisma as any).$transaction = jest.fn(async (cb: any) => cb(prisma));
        (prisma.broadcastRecipient as any).createMany = jest.fn().mockResolvedValue({ count: 0 });
      });

      afterEach(() => {
        delete (prisma as any).$transaction;
        delete (prisma.broadcastRecipient as any).createMany;
      });

      it('persists 150 recipient records in a single database round trip using createMany in a transaction', async () => {
        const guests = Array.from({ length: 150 }, (_, i) => ({
          id: `guest-${i}`,
          guestName: `Guest ${i}`,
          code: `CODE${i}`,
          email: `guest${i}@example.com`,
          householdName: `Household ${i}`,
        }));

        (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue(guests);
        (prisma.broadcastMessage.create as jest.Mock).mockResolvedValue({
          id: 'bm-bulk-150',
          status: 'SENDING',
        });
        (prisma.broadcastMessage.update as jest.Mock).mockResolvedValue({
          id: 'bm-bulk-150',
          status: 'SENT',
          sentCount: 150,
          failedCount: 0,
        });

        const start = Date.now();
        await BroadcastService.sendBroadcast({
          channel: 'EMAIL',
          subject: 'Big announcement',
          body: 'Hello everyone!',
        });
        const duration = Date.now() - start;

        // Metric 2: Recipient record insertion completes quickly
        expect(duration).toBeLessThan(1000);

        // Criterion 1: persists 150 recipient records in a single database round trip (1 createMany call)
        expect((prisma as any).$transaction).toHaveBeenCalledTimes(1);
        expect((prisma.broadcastRecipient as any).createMany).toHaveBeenCalledTimes(1);

        const createManyArg = (prisma.broadcastRecipient as any).createMany.mock.calls[0][0];
        expect(createManyArg.data).toHaveLength(150);
        expect(createManyArg.data[0]).toEqual(
          expect.objectContaining({
            broadcastId: 'bm-bulk-150',
            invitationCodeId: 'guest-0',
            guestName: 'Guest 0',
            destination: 'guest0@example.com',
            status: 'PENDING',
            error: null,
          })
        );
        expect(createManyArg.data[0].id).toBeDefined();
        expect(typeof createManyArg.data[0].id).toBe('string');

        // All IDs must be unique
        const ids = new Set(createManyArg.data.map((r: any) => r.id));
        expect(ids.size).toBe(150);
      });

      it('executes at most two database queries to persist up to 200 recipient records', async () => {
        const guests = Array.from({ length: 200 }, (_, i) => ({
          id: `guest-200-${i}`,
          guestName: `Guest ${i}`,
          code: `CODE${i}`,
          email: `guest${i}@example.com`,
        }));

        (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue(guests);
        (prisma.broadcastMessage.create as jest.Mock).mockResolvedValue({
          id: 'bm-bulk-200',
          status: 'SENDING',
        });
        (prisma.broadcastMessage.update as jest.Mock).mockResolvedValue({
          id: 'bm-bulk-200',
          status: 'SENT',
          sentCount: 200,
          failedCount: 0,
        });

        await BroadcastService.sendBroadcast({
          channel: 'EMAIL',
          subject: '200 Guests',
          body: 'Hello!',
        });

        // Metric 1: At most two queries for up to 200 recipients (here 1 query with chunk size 250)
        expect((prisma.broadcastRecipient as any).createMany.mock.calls.length).toBeLessThanOrEqual(2);
      });

      it('chunks large recipient lists into fixed blocks under 500 records to respect parameter limits', async () => {
        const guests = Array.from({ length: 600 }, (_, i) => ({
          id: `guest-600-${i}`,
          guestName: `Guest ${i}`,
          code: `CODE${i}`,
          email: `guest${i}@example.com`,
        }));

        (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue(guests);
        (prisma.broadcastMessage.create as jest.Mock).mockResolvedValue({
          id: 'bm-bulk-600',
          status: 'SENDING',
        });
        (prisma.broadcastMessage.update as jest.Mock).mockResolvedValue({
          id: 'bm-bulk-600',
          status: 'SENT',
          sentCount: 600,
          failedCount: 0,
        });

        await BroadcastService.sendBroadcast({
          channel: 'EMAIL',
          subject: '600 Guests',
          body: 'Hello!',
        });

        expect((prisma as any).$transaction).toHaveBeenCalledTimes(1);
        // With chunk size 250, 600 records requires 3 chunks (250, 250, 100)
        expect((prisma.broadcastRecipient as any).createMany).toHaveBeenCalledTimes(3);

        const chunk1 = (prisma.broadcastRecipient as any).createMany.mock.calls[0][0].data;
        const chunk2 = (prisma.broadcastRecipient as any).createMany.mock.calls[1][0].data;
        const chunk3 = (prisma.broadcastRecipient as any).createMany.mock.calls[2][0].data;

        expect(chunk1.length).toBe(250);
        expect(chunk2.length).toBe(250);
        expect(chunk3.length).toBe(100);

        // Constraint: each chunk must be under 500 records
        expect(chunk1.length).toBeLessThan(500);
        expect(chunk2.length).toBeLessThan(500);
        expect(chunk3.length).toBeLessThan(500);
      });

      it('preserves individual recipient tracking identifiers for all downstream dispatches', async () => {
        const guests = [
          { id: 'g1', guestName: 'Alice', code: 'A1', email: 'alice@example.com' },
          { id: 'g2', guestName: 'Bob', code: 'B2', email: 'bob@example.com' },
        ];

        (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue(guests);
        (prisma.broadcastMessage.create as jest.Mock).mockResolvedValue({
          id: 'bm-tracking',
          status: 'SENDING',
        });
        (prisma.broadcastMessage.update as jest.Mock).mockResolvedValue({
          id: 'bm-tracking',
          status: 'SENT',
          sentCount: 2,
          failedCount: 0,
        });

        await BroadcastService.sendBroadcast({
          channel: 'EMAIL',
          subject: 'Tracking Test',
          body: 'Hello!',
        });

        const createdRecipients = (prisma.broadcastRecipient as any).createMany.mock.calls[0][0].data;
        expect(createdRecipients).toHaveLength(2);
        const [r1, r2] = createdRecipients;

        // Verify downstream updates used the exact assigned recipient IDs
        expect(prisma.broadcastRecipient.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: r1.id },
            data: expect.objectContaining({ status: 'SENT' }),
          })
        );
        expect(prisma.broadcastRecipient.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: r2.id },
            data: expect.objectContaining({ status: 'SENT' }),
          })
        );
      });

      it('marks dispatches with invalid contact details as FAILED without interrupting the bulk insert', async () => {
        const guests = [
          { id: 'g-valid', guestName: 'Valid Guest', code: 'V1', email: 'valid@example.com' },
          { id: 'g-invalid-1', guestName: 'No Email Guest', code: 'INV1', email: '' },
          { id: 'g-invalid-2', guestName: 'Undefined Email Guest', code: 'INV2', email: undefined },
        ];

        (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue(guests);
        (prisma.broadcastMessage.create as jest.Mock).mockResolvedValue({
          id: 'bm-invalid',
          status: 'SENDING',
        });
        (prisma.broadcastMessage.update as jest.Mock).mockResolvedValue({
          id: 'bm-invalid',
          status: 'PARTIALLY_SENT',
          sentCount: 1,
          failedCount: 2,
        });

        await BroadcastService.sendBroadcast({
          channel: 'EMAIL',
          subject: 'Invalid Contact Test',
          body: 'Hello!',
        });

        // 1 single bulk insert with all 3 recipients
        expect((prisma.broadcastRecipient as any).createMany).toHaveBeenCalledTimes(1);
        const insertedData = (prisma.broadcastRecipient as any).createMany.mock.calls[0][0].data;
        expect(insertedData).toHaveLength(3);

        const validItem = insertedData.find((r: any) => r.guestName === 'Valid Guest');
        expect(validItem.status).toBe('PENDING');
        expect(validItem.error).toBeNull();
        expect(validItem.destination).toBe('valid@example.com');

        const invalidItem1 = insertedData.find((r: any) => r.guestName === 'No Email Guest');
        expect(invalidItem1.status).toBe('FAILED');
        expect(invalidItem1.error).toBe('Missing email address');
        expect(invalidItem1.destination).toBe('Missing Contact Info');

        const invalidItem2 = insertedData.find((r: any) => r.guestName === 'Undefined Email Guest');
        expect(invalidItem2.status).toBe('FAILED');
        expect(invalidItem2.error).toBe('Missing email address');
        expect(invalidItem2.destination).toBe('Missing Contact Info');

        // Only valid recipient dispatched
        expect(prisma.broadcastRecipient.update).toHaveBeenCalledTimes(1);
        expect(prisma.broadcastRecipient.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: validItem.id },
            data: expect.objectContaining({ status: 'SENT' }),
          })
        );
      });

      it('aborts and propagates error if transactional bulk insert fails', async () => {
        const guests = [{ id: 'g1', guestName: 'Alice', code: 'A1', email: 'alice@example.com' }];

        (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue(guests);
        (prisma.broadcastMessage.create as jest.Mock).mockResolvedValue({
          id: 'bm-fail',
          status: 'SENDING',
        });
        (prisma as any).$transaction = jest.fn().mockRejectedValue(new Error('Transaction deadlock'));

        await expect(
          BroadcastService.sendBroadcast({
            channel: 'EMAIL',
            subject: 'Fail Test',
            body: 'Hello!',
          })
        ).rejects.toThrow('Transaction deadlock');
      });

      it('dispatches SMS broadcast to guests using phone numbers stored in extraFields', async () => {
        const guests = [
          {
            id: 'g-sms-1',
            guestName: 'Phone Guest',
            code: 'SMS1',
            extraFields: { phone: '+15551234567', mobile: '+15551234567' },
          },
          {
            id: 'g-sms-2',
            guestName: 'Serialized Phone Guest',
            code: 'SMS2',
            extraFields: JSON.stringify({ phone: '+15559876543', mobile: '+15559876543' }),
          },
          {
            id: 'g-sms-3',
            guestName: 'Missing Phone Guest',
            code: 'SMS3',
            extraFields: null,
          },
        ];

        (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue(guests);
        (prisma.broadcastMessage.create as jest.Mock).mockResolvedValue({
          id: 'bm-sms-test',
          status: 'SENDING',
        });
        (prisma.broadcastMessage.update as jest.Mock).mockResolvedValue({
          id: 'bm-sms-test',
          status: 'PARTIALLY_SENT',
          sentCount: 2,
          failedCount: 1,
        });

        await BroadcastService.sendBroadcast({
          channel: 'SMS',
          body: 'Wedding update for {{guestName}}!',
        });

        expect((prisma.broadcastRecipient as any).createMany).toHaveBeenCalledTimes(1);
        const insertedData = (prisma.broadcastRecipient as any).createMany.mock.calls[0][0].data;
        expect(insertedData).toHaveLength(3);

        const guest1 = insertedData.find((r: any) => r.guestName === 'Phone Guest');
        expect(guest1.status).toBe('PENDING');
        expect(guest1.error).toBeNull();
        expect(guest1.destination).toBe('+15551234567');

        const guest2 = insertedData.find((r: any) => r.guestName === 'Serialized Phone Guest');
        expect(guest2.status).toBe('PENDING');
        expect(guest2.error).toBeNull();
        expect(guest2.destination).toBe('+15559876543');

        const guest3 = insertedData.find((r: any) => r.guestName === 'Missing Phone Guest');
        expect(guest3.status).toBe('FAILED');
        expect(guest3.error).toBe('Missing phone number');
        expect(guest3.destination).toBe('Missing Contact Info');

        // Verify valid recipients were updated to SENT
        expect(prisma.broadcastRecipient.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: guest1.id },
            data: expect.objectContaining({ status: 'SENT' }),
          })
        );
        expect(prisma.broadcastRecipient.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: guest2.id },
            data: expect.objectContaining({ status: 'SENT' }),
          })
        );
      });
    });
  });

  describe('sendTestBroadcast', () => {
    it('dispatches test email with [TEST] prefix and sample placeholders without touching guest records or DB tables', async () => {
      (getAppConfig as jest.Mock).mockResolvedValueOnce({
        contactEmail: 'host@example.com',
        weddingDate: new Date('2026-10-25'),
        venueName: 'Grand Hall',
        emailProvider: 'none',
      });

      const res = await BroadcastService.sendTestBroadcast({
        channel: 'EMAIL',
        subject: 'Reminder for {{guestName}}',
        body: 'Welcome to {{venueName}}, {{guestName}}! Your code is {{code}}.',
      });

      expect(res.success).toBe(true);
      expect(res.destination).toBe('host@example.com');
      expect(res.subject).toBe('[TEST] Reminder for Jane Doe');
      expect(res.body).toContain('Welcome to Grand Hall, Jane Doe! Your code is SAMPLE2026.');

      // Guardrail: must NEVER read guest records or insert broadcast records
      expect(prisma.invitationCode.findMany).not.toHaveBeenCalled();
      expect(prisma.invitationCode.findUnique).not.toHaveBeenCalled();
      expect(prisma.broadcastMessage.create).not.toHaveBeenCalled();
      expect(prisma.broadcastRecipient.create).not.toHaveBeenCalled();
    });

    it('does not duplicate [TEST] prefix if subject already has it', async () => {
      (getAppConfig as jest.Mock).mockResolvedValueOnce({
        contactEmail: 'host@example.com',
        emailProvider: 'none',
      });

      const res = await BroadcastService.sendTestBroadcast({
        channel: 'EMAIL',
        subject: '[TEST] Already prefixed subject',
        body: 'Test body',
      });

      expect(res.subject).toBe('[TEST] Already prefixed subject');
    });

    it('supports custom override destination for test dispatch', async () => {
      const res = await BroadcastService.sendTestBroadcast({
        channel: 'EMAIL',
        subject: 'Custom test',
        body: 'Testing override',
        destination: 'assistant@example.com',
      });

      expect(res.destination).toBe('assistant@example.com');
      expect(prisma.invitationCode.findMany).not.toHaveBeenCalled();
    });

    it('supports SMS test dispatch to E.164 phone number', async () => {
      const res = await BroadcastService.sendTestBroadcast({
        channel: 'SMS',
        body: 'Hello {{guestName}}, wedding test SMS!',
        destination: '+15551234567',
      });

      expect(res.success).toBe(true);
      expect(res.destination).toBe('+15551234567');
      expect(res.body).toContain('Hello Jane Doe, wedding test SMS!');
      expect(res.subject).toBeUndefined();
    });

    it('rejects invalid email destination', async () => {
      await expect(
        BroadcastService.sendTestBroadcast({
          channel: 'EMAIL',
          subject: 'Test',
          body: 'Test',
          destination: 'not-an-email',
        })
      ).rejects.toThrow('Invalid email address format for test destination.');
    });

    it('rejects non-E.164 phone destination', async () => {
      await expect(
        BroadcastService.sendTestBroadcast({
          channel: 'SMS',
          body: 'Test',
          destination: '555-1234',
        })
      ).rejects.toThrow('Invalid phone number format. Must be in E.164 format');
    });

    it('throws error when provider dispatch fails', async () => {
      const spy = jest.spyOn(MultiChannelMessagingProvider.prototype, 'sendEmail').mockResolvedValueOnce({
        success: false,
        error: 'Resend API Key is missing in settings',
      });

      await expect(
        BroadcastService.sendTestBroadcast({
          channel: 'EMAIL',
          subject: 'Fail test',
          body: 'Fail body',
          destination: 'host@example.com',
        })
      ).rejects.toThrow('Resend API Key is missing in settings');

      spy.mockRestore();
    });

    it('escapes HTML placeholders in EMAIL test broadcasts and strips CR/LF/<> from test subjects', async () => {
      (getAppConfig as jest.Mock).mockResolvedValueOnce({
        contactEmail: 'host@example.com',
        weddingDate: new Date('2026-10-25'),
        venueName: '<script>alert("xss")</script> & O\'Connor Hall',
        emailProvider: 'smtp',
      });

      const sendEmailSpy = jest
        .spyOn(MultiChannelMessagingProvider.prototype, 'sendEmail')
        .mockResolvedValueOnce({ success: true });

      const res = await BroadcastService.sendTestBroadcast({
        channel: 'EMAIL',
        subject: 'Venue: {{venueName}}\r\nInjected',
        body: '<p>Welcome to {{venueName}}</p>',
      });

      expect(res.body).toBe(
        '<p>Welcome to &lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; O&#39;Connor Hall</p>'
      );
      expect(res.subject).toBe('[TEST] Venue: scriptalert("xss")/script & O\'Connor HallInjected');
      expect(sendEmailSpy).toHaveBeenCalledWith({
        to: 'host@example.com',
        subject: '[TEST] Venue: scriptalert("xss")/script & O\'Connor HallInjected',
        body: '<p>Welcome to &lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; O&#39;Connor Hall</p>',
      });

      sendEmailSpy.mockRestore();
    });
  });

  describe('retryFailedRecipients', () => {
    it('returns broadcast immediately without dispatch or recounting when failed recipients list is empty', async () => {
      const broadcast = {
        id: 'b-empty',
        channel: 'EMAIL',
        body: 'Hello',
        recipients: [
          { id: 'r1', status: 'SENT', destination: 'r1@example.com' },
        ],
      };
      (prisma.broadcastMessage.findUnique as jest.Mock).mockResolvedValue(broadcast);

      const res = await BroadcastService.retryFailedRecipients('b-empty');
      expect(res).toBe(broadcast);
      expect(prisma.broadcastRecipient.updateMany).not.toHaveBeenCalled();
      expect(prisma.broadcastRecipient.update).not.toHaveBeenCalled();
      expect(prisma.broadcastRecipient.count).not.toHaveBeenCalled();
      expect(prisma.broadcastMessage.update).not.toHaveBeenCalled();
    });

    it('throws error when broadcast is not found', async () => {
      (prisma.broadcastMessage.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        BroadcastService.retryFailedRecipients('nonexistent-id')
      ).rejects.toThrow('Broadcast message not found.');
    });

    it('dispatches failed recipients in bounded concurrent batches according to broadcastBatchSize', async () => {
      (getAppConfig as jest.Mock).mockResolvedValueOnce({
        weddingDate: new Date('2026-10-25'),
        venueName: 'Grand Hall',
        emailProvider: 'smtp',
        broadcastBatchSize: 2,
        broadcastBatchDelayMs: 0,
      });

      const recipients = Array.from({ length: 5 }, (_, i) => ({
        id: `r-${i}`,
        guestName: `Guest ${i}`,
        destination: `guest${i}@example.com`,
        status: 'FAILED',
        invitationCode: null,
      }));

      (prisma.broadcastMessage.findUnique as jest.Mock).mockResolvedValue({
        id: 'b-batch',
        channel: 'EMAIL',
        body: 'Hello {{guestName}}',
        recipients,
      });

      const sendEmailSpy = jest.spyOn(MultiChannelMessagingProvider.prototype, 'sendEmail').mockResolvedValue({ success: true });

      (prisma.broadcastRecipient.updateMany as jest.Mock).mockResolvedValue({ count: 2 });
      (prisma.broadcastRecipient.count as jest.Mock)
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(0);
      (prisma.broadcastMessage.update as jest.Mock).mockResolvedValue({
        id: 'b-batch',
        status: 'SENT',
        sentCount: 5,
        failedCount: 0,
        recipients,
      });

      const res = await BroadcastService.retryFailedRecipients('b-batch');

      expect(sendEmailSpy).toHaveBeenCalledTimes(5);
      expect(prisma.broadcastRecipient.updateMany).toHaveBeenCalledTimes(3);
      expect(prisma.broadcastRecipient.updateMany).toHaveBeenNthCalledWith(1, {
        where: { id: { in: ['r-0', 'r-1'] } },
        data: {
          status: 'SENT',
          error: null,
          sentAt: expect.any(Date),
        },
      });
      expect(prisma.broadcastRecipient.updateMany).toHaveBeenNthCalledWith(2, {
        where: { id: { in: ['r-2', 'r-3'] } },
        data: {
          status: 'SENT',
          error: null,
          sentAt: expect.any(Date),
        },
      });
      expect(prisma.broadcastRecipient.updateMany).toHaveBeenNthCalledWith(3, {
        where: { id: { in: ['r-4'] } },
        data: {
          status: 'SENT',
          error: null,
          sentAt: expect.any(Date),
        },
      });

      expect(res.status).toBe('SENT');
      sendEmailSpy.mockRestore();
    });

    it('applies configured rate limit delay between successive batches', async () => {
      (getAppConfig as jest.Mock).mockResolvedValueOnce({
        weddingDate: new Date('2026-10-25'),
        venueName: 'Grand Hall',
        emailProvider: 'smtp',
        broadcastBatchSize: 2,
        broadcastBatchDelayMs: 20,
      });

      const recipients = [
        { id: 'r-0', guestName: 'G0', destination: 'g0@example.com', status: 'FAILED' },
        { id: 'r-1', guestName: 'G1', destination: 'g1@example.com', status: 'FAILED' },
        { id: 'r-2', guestName: 'G2', destination: 'g2@example.com', status: 'FAILED' },
      ];

      (prisma.broadcastMessage.findUnique as jest.Mock).mockResolvedValue({
        id: 'b-delay',
        channel: 'EMAIL',
        body: 'Hello {{guestName}}',
        recipients,
      });

      const sendEmailSpy = jest.spyOn(MultiChannelMessagingProvider.prototype, 'sendEmail').mockResolvedValue({ success: true });
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

      (prisma.broadcastRecipient.updateMany as jest.Mock).mockResolvedValue({ count: 2 });
      (prisma.broadcastRecipient.count as jest.Mock).mockResolvedValue(0);
      (prisma.broadcastMessage.update as jest.Mock).mockResolvedValue({ id: 'b-delay' });

      await BroadcastService.retryFailedRecipients('b-delay');

      expect(sendEmailSpy).toHaveBeenCalledTimes(3);
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 20);

      setTimeoutSpy.mockRestore();
      sendEmailSpy.mockRestore();
    });

    it('persists successful dispatches via updateMany and writes failed errors concurrently', async () => {
      (getAppConfig as jest.Mock).mockResolvedValueOnce({
        weddingDate: new Date('2026-10-25'),
        venueName: 'Grand Hall',
        emailProvider: 'smtp',
        broadcastBatchSize: 10,
        broadcastBatchDelayMs: 0,
      });

      const recipients = [
        { id: 'r-ok-1', guestName: 'Alice', destination: 'alice@example.com', status: 'FAILED' },
        { id: 'r-fail-1', guestName: 'Bob', destination: 'bob@example.com', status: 'FAILED' },
        { id: 'r-ok-2', guestName: 'Carol', destination: 'carol@example.com', status: 'FAILED' },
      ];

      (prisma.broadcastMessage.findUnique as jest.Mock).mockResolvedValue({
        id: 'b-mixed',
        channel: 'EMAIL',
        body: 'Hello {{guestName}}',
        recipients,
      });

      const sendEmailSpy = jest.spyOn(MultiChannelMessagingProvider.prototype, 'sendEmail').mockImplementation(async (opts: { to?: string }) => {
        if (opts.to === 'bob@example.com') {
          return { success: false, error: 'Mailbox full' };
        }
        return { success: true };
      });

      (prisma.broadcastRecipient.updateMany as jest.Mock).mockResolvedValue({ count: 2 });
      (prisma.broadcastRecipient.update as jest.Mock).mockResolvedValue({ id: 'r-fail-1' });
      (prisma.broadcastRecipient.count as jest.Mock)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(1);
      (prisma.broadcastMessage.update as jest.Mock).mockResolvedValue({
        id: 'b-mixed',
        status: 'PARTIALLY_SENT',
        sentCount: 2,
        failedCount: 1,
      });

      const res = await BroadcastService.retryFailedRecipients('b-mixed');

      expect(prisma.broadcastRecipient.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['r-ok-1', 'r-ok-2'] } },
        data: {
          status: 'SENT',
          error: null,
          sentAt: expect.any(Date),
        },
      });

      expect(prisma.broadcastRecipient.update).toHaveBeenCalledWith({
        where: { id: 'r-fail-1' },
        data: {
          status: 'FAILED',
          error: 'Mailbox full',
        },
      });

      expect(prisma.broadcastRecipient.findMany).not.toHaveBeenCalled();
      expect(prisma.broadcastRecipient.count).toHaveBeenCalledWith({
        where: { broadcastId: 'b-mixed', status: { in: ['SENT', 'VIEWED'] } },
      });
      expect(prisma.broadcastRecipient.count).toHaveBeenCalledWith({
        where: { broadcastId: 'b-mixed', status: 'FAILED' },
      });

      expect(prisma.broadcastMessage.update).toHaveBeenCalledWith({
        where: { id: 'b-mixed' },
        data: {
          status: 'PARTIALLY_SENT',
          sentCount: 2,
          failedCount: 1,
        },
        include: {
          recipients: true,
        },
      });

      expect(res.status).toBe('PARTIALLY_SENT');
      sendEmailSpy.mockRestore();
    });

    it('sets status to FAILED when all retried dispatches fail', async () => {
      (getAppConfig as jest.Mock).mockResolvedValueOnce({
        weddingDate: new Date('2026-10-25'),
        venueName: 'Grand Hall',
        emailProvider: 'smtp',
        broadcastBatchSize: 10,
        broadcastBatchDelayMs: 0,
      });

      const recipients = [
        { id: 'r-fail-1', guestName: 'Alice', destination: 'alice@example.com', status: 'FAILED' },
        { id: 'r-fail-2', guestName: 'Bob', destination: 'bob@example.com', status: 'FAILED' },
      ];

      (prisma.broadcastMessage.findUnique as jest.Mock).mockResolvedValue({
        id: 'b-all-fail',
        channel: 'EMAIL',
        body: 'Hello {{guestName}}',
        recipients,
      });

      const sendEmailSpy = jest.spyOn(MultiChannelMessagingProvider.prototype, 'sendEmail').mockResolvedValue({
        success: false,
        error: 'SMTP timeout',
      });

      (prisma.broadcastRecipient.update as jest.Mock).mockResolvedValue({ id: 'r-fail-1' });
      (prisma.broadcastRecipient.count as jest.Mock)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(2);
      (prisma.broadcastMessage.update as jest.Mock).mockResolvedValue({
        id: 'b-all-fail',
        status: 'FAILED',
        sentCount: 0,
        failedCount: 2,
      });

      const res = await BroadcastService.retryFailedRecipients('b-all-fail');

      expect(prisma.broadcastRecipient.updateMany).not.toHaveBeenCalled();
      expect(prisma.broadcastRecipient.update).toHaveBeenCalledTimes(2);
      expect(prisma.broadcastMessage.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'FAILED', sentCount: 0, failedCount: 2 }),
        })
      );
      expect(res.status).toBe('FAILED');
      sendEmailSpy.mockRestore();
    });

    it('filters retries by recipientIds when specified', async () => {
      (getAppConfig as jest.Mock).mockResolvedValueOnce({
        weddingDate: new Date('2026-10-25'),
        venueName: 'Grand Hall',
        emailProvider: 'smtp',
        broadcastBatchSize: 10,
        broadcastBatchDelayMs: 0,
      });

      const recipients = [
        { id: 'r-1', guestName: 'Alice', destination: 'alice@example.com', status: 'FAILED' },
        { id: 'r-2', guestName: 'Bob', destination: 'bob@example.com', status: 'FAILED' },
      ];

      (prisma.broadcastMessage.findUnique as jest.Mock).mockResolvedValue({
        id: 'b-filtered',
        channel: 'EMAIL',
        body: 'Hello {{guestName}}',
        recipients,
      });

      const sendEmailSpy = jest.spyOn(MultiChannelMessagingProvider.prototype, 'sendEmail').mockResolvedValue({ success: true });

      (prisma.broadcastRecipient.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.broadcastRecipient.count as jest.Mock)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1);
      (prisma.broadcastMessage.update as jest.Mock).mockResolvedValue({
        id: 'b-filtered',
        status: 'PARTIALLY_SENT',
        sentCount: 1,
        failedCount: 1,
      });

      await BroadcastService.retryFailedRecipients('b-filtered', ['r-1']);

      expect(sendEmailSpy).toHaveBeenCalledTimes(1);
      expect(prisma.broadcastRecipient.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['r-1'] } },
        data: expect.objectContaining({ status: 'SENT' }),
      });

      sendEmailSpy.mockRestore();
    });

    it('dispatches SMS channel retries via sendSms', async () => {
      (getAppConfig as jest.Mock).mockResolvedValueOnce({
        weddingDate: new Date('2026-10-25'),
        venueName: 'Grand Hall',
        smsProvider: 'twilio',
        broadcastBatchSize: 10,
        broadcastBatchDelayMs: 0,
      });

      const recipients = [
        { id: 'r-sms-1', guestName: 'Alice', destination: '+15551234567', status: 'FAILED' },
      ];

      (prisma.broadcastMessage.findUnique as jest.Mock).mockResolvedValue({
        id: 'b-sms',
        channel: 'SMS',
        body: 'SMS Alert for {{guestName}}',
        recipients,
      });

      const sendSmsSpy = jest.spyOn(MultiChannelMessagingProvider.prototype, 'sendSms').mockResolvedValue({ success: true });

      (prisma.broadcastRecipient.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.broadcastRecipient.count as jest.Mock)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0);
      (prisma.broadcastMessage.update as jest.Mock).mockResolvedValue({
        id: 'b-sms',
        status: 'SENT',
        sentCount: 1,
        failedCount: 0,
      });

      await BroadcastService.retryFailedRecipients('b-sms');

      expect(sendSmsSpy).toHaveBeenCalledWith({
        to: '+15551234567',
        body: 'SMS Alert for Alice',
      });

      sendSmsSpy.mockRestore();
    });

    it('escapes HTML placeholders and strips CR/LF/<> from subjects when retrying EMAIL recipients', async () => {
      (getAppConfig as jest.Mock).mockResolvedValueOnce({
        weddingDate: new Date('2026-10-25'),
        venueName: 'Grand Hall',
        emailProvider: 'smtp',
        broadcastBatchSize: 10,
        broadcastBatchDelayMs: 0,
      });

      const recipients = [
        {
          id: 'r-email-escape',
          guestName: '<b data-canary="guest-html-marker">CanaryGuest</b>',
          destination: 'canary@example.com',
          status: 'FAILED',
          invitationCode: {
            code: 'C1',
            householdName: '<i data-canary="household-html-marker">O\'Connor & Family</i>',
          },
        },
      ];

      (prisma.broadcastMessage.findUnique as jest.Mock).mockResolvedValue({
        id: 'b-retry-escape',
        channel: 'EMAIL',
        subject: 'Retry for {{guestName}}\r\nHeader: injected',
        body: '<p>Dear {{guestName}} ({{householdName}})</p>',
        recipients,
      });

      const sendEmailSpy = jest
        .spyOn(MultiChannelMessagingProvider.prototype, 'sendEmail')
        .mockResolvedValue({ success: true });

      (prisma.broadcastRecipient.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.broadcastRecipient.count as jest.Mock)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0);
      (prisma.broadcastMessage.update as jest.Mock).mockResolvedValue({
        id: 'b-retry-escape',
        status: 'SENT',
        sentCount: 1,
        failedCount: 0,
      });

      await BroadcastService.retryFailedRecipients('b-retry-escape');

      expect(sendEmailSpy).toHaveBeenCalledWith({
        to: 'canary@example.com',
        subject: 'Retry for b data-canary="guest-html-marker"CanaryGuest/bHeader: injected',
        body: '<p>Dear &lt;b data-canary=&quot;guest-html-marker&quot;&gt;CanaryGuest&lt;/b&gt; (&lt;i data-canary=&quot;household-html-marker&quot;&gt;O&#39;Connor &amp; Family&lt;/i&gt;)</p>',
      });

      sendEmailSpy.mockRestore();
    });

    it('resolves {{rsvpUrl}} across retryFailedRecipients and falls back to requestOrigin with baseUrlWarning when AppConfig.baseUrl is empty', async () => {
      (getAppConfig as jest.Mock).mockResolvedValueOnce({
        baseUrl: '',
        weddingDate: new Date('2026-10-25'),
        venueName: 'Grand Hall',
        emailProvider: 'smtp',
        broadcastBatchSize: 10,
        broadcastBatchDelayMs: 0,
      });

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const recipients = [
        {
          id: 'r-rsvp-retry',
          guestName: 'Jordan Lee',
          destination: 'jordan@example.com',
          status: 'FAILED',
          invitationCode: {
            code: 'JORDAN 2026',
            householdName: 'Lee Household',
          },
        },
      ];

      (prisma.broadcastMessage.findUnique as jest.Mock).mockResolvedValue({
        id: 'b-retry-url',
        channel: 'EMAIL',
        subject: 'RSVP for {{guestName}}',
        body: 'Hi {{guestName}}, RSVP here: {{rsvpUrl}}',
        recipients,
      });

      const sendEmailSpy = jest
        .spyOn(MultiChannelMessagingProvider.prototype, 'sendEmail')
        .mockResolvedValue({ success: true });

      (prisma.broadcastRecipient.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.broadcastRecipient.count as jest.Mock)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0);
      (prisma.broadcastMessage.update as jest.Mock).mockResolvedValue({
        id: 'b-retry-url',
        status: 'SENT',
        sentCount: 1,
        failedCount: 0,
      });

      const result = await BroadcastService.retryFailedRecipients(
        'b-retry-url',
        undefined,
        'https://wedding.host.example'
      );

      expect(sendEmailSpy).toHaveBeenCalledWith({
        to: 'jordan@example.com',
        subject: 'RSVP for Jordan Lee',
        body: 'Hi Jordan Lee, RSVP here: https://wedding.host.example/guest?code=JORDAN%202026',
      });
      expect((result as any).baseUrlWarning).toContain('https://wedding.host.example');
      expect(warnSpy).toHaveBeenCalled();

      sendEmailSpy.mockRestore();
      warnSpy.mockRestore();
    });
  });

  describe('sub-event pending invitees, dashboard filter parity, and {{rsvpUrl}} across all context builders', () => {
    it('matches unresponded invitees (missing SubEventRsvp rows or pending status) for private and public sub-events', async () => {
      const subEventFindUnique = jest.fn();
      (prisma as any).subEvent = { findUnique: subEventFindUnique };

      const guests = [
        {
          id: 'g-no-row',
          guestName: 'Unresponded Invitee',
          code: 'NORESPONSE',
          subEventAccesses: [{ subEventId: 'rehearsal-private' }],
          subEventRsvps: [],
        },
        {
          id: 'g-pending-row',
          guestName: 'Explicit Pending Invitee',
          code: 'PENDINGROW',
          subEventAccesses: [{ subEventId: 'rehearsal-private' }],
          subEventRsvps: [{ subEventId: 'rehearsal-private', status: 'pending' }],
        },
        {
          id: 'g-attending-row',
          guestName: 'Attending Invitee',
          code: 'ATTENDING1',
          subEventAccesses: [{ subEventId: 'rehearsal-private' }],
          subEventRsvps: [{ subEventId: 'rehearsal-private', status: 'attending' }],
        },
        {
          id: 'g-uninvited',
          guestName: 'Ceremony Only Guest',
          code: 'CEREMONY1',
          subEventAccesses: [],
          subEventRsvps: [],
        },
      ];

      // 1. Private sub-event with pending status
      subEventFindUnique.mockResolvedValueOnce({ id: 'rehearsal-private', isPrivate: true });
      (prisma.invitationCode.findMany as jest.Mock).mockResolvedValueOnce(guests);

      const privatePending = await BroadcastService.resolveTargetGuests({
        subEventId: 'rehearsal-private',
        subEventRsvpStatus: 'pending',
      });

      expect(prisma.invitationCode.findMany).toHaveBeenCalledWith({
        where: {
          AND: [
            { subEventAccesses: { some: { subEventId: 'rehearsal-private' } } },
            {
              OR: [
                { subEventRsvps: { none: { subEventId: 'rehearsal-private' } } },
                {
                  subEventRsvps: {
                    some: { subEventId: 'rehearsal-private', status: 'pending' },
                  },
                },
              ],
            },
          ],
        },
      });
      expect(privatePending.map((g) => g.id)).toEqual(['g-no-row', 'g-pending-row']);

      // 2. Public sub-event with pending status (all invited guests have access without SubEventAccess rows)
      subEventFindUnique.mockResolvedValueOnce({ id: 'welcome-public', isPrivate: false });
      (prisma.invitationCode.findMany as jest.Mock).mockResolvedValueOnce([
        {
          id: 'pub-no-row',
          guestName: 'Public Unresponded',
          code: 'PUB1',
          subEventAccesses: [],
          subEventRsvps: [],
        },
        {
          id: 'pub-declined',
          guestName: 'Public Declined',
          code: 'PUB2',
          subEventAccesses: [],
          subEventRsvps: [{ subEventId: 'welcome-public', status: 'declined' }],
        },
      ]);

      const publicPending = await BroadcastService.resolveTargetGuests({
        subEventId: 'welcome-public',
        subEventRsvpStatus: 'pending',
      });

      expect(prisma.invitationCode.findMany).toHaveBeenLastCalledWith({
        where: {
          AND: [
            {
              OR: [
                { subEventRsvps: { none: { subEventId: 'welcome-public' } } },
                {
                  subEventRsvps: {
                    some: { subEventId: 'welcome-public', status: 'pending' },
                  },
                },
              ],
            },
          ],
        },
      });
      expect(publicPending.map((g) => g.id)).toEqual(['pub-no-row']);

      delete (prisma as any).subEvent;
    });

    it('filters by partyGroup, status, addressFilter, dietaryFilter, and multi-field searchQuery matching dashboard table', async () => {
      const records = [
        {
          id: 'c1',
          guestName: 'Maya Lin',
          code: 'MAYA26',
          email: 'maya@example.com',
          plusOneFirstName: 'Alex',
          plusOneLastName: 'Rivera',
          partyGroup: 'Bride Side',
          partyTags: ['bridal-party'],
          dietaryNotes: 'Gluten-free',
          addressLine1: '100 Market St',
          city: 'San Francisco',
          state: 'CA',
          zipCode: '94105',
          used: false,
        },
        {
          id: 'c2',
          guestName: 'Noah Patel',
          code: 'NOAH26',
          email: 'noah@example.com',
          partyGroup: 'Bride Side',
          partyTags: ['college'],
          dietaryNotes: 'Gluten-free',
          addressLine1: '',
          city: '',
          state: '',
          zipCode: '',
          used: false,
        },
        {
          id: 'c3',
          guestName: 'Liam Chen',
          code: 'LIAM26',
          email: 'liam@example.com',
          partyGroup: 'Groom Side',
          partyTags: ['bridal-party'],
          dietaryNotes: 'Vegan',
          addressLine1: '',
          city: '',
          state: '',
          zipCode: '',
          used: true,
        },
      ];

      (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue(records);

      const missingAddressMatches = await BroadcastService.resolveTargetGuests({
        partyGroup: 'Bride Side',
        status: 'unused',
        addressFilter: 'missing',
        dietaryFilter: 'gluten-free',
      });
      expect(missingAddressMatches.map((r) => r.id)).toEqual(['c2']);

      const multiFieldPlusOneMatches = await BroadcastService.resolveTargetGuests({
        searchQuery: 'rivera',
        addressFilter: 'complete',
      });
      expect(multiFieldPlusOneMatches.map((r) => r.id)).toEqual(['c1']);
    });

    it('renders {{rsvpUrl}} across renderPreview, sendTestBroadcast, and sendBroadcast using AppConfig.baseUrl or requestOrigin fallback', async () => {
      // 1. Configured AppConfig.baseUrl in renderPreview
      (getAppConfig as jest.Mock).mockResolvedValueOnce({
        baseUrl: 'https://celebrate.example.com/',
        weddingDate: new Date('2026-10-25'),
        venueName: 'Grand Hall',
        emailProvider: 'smtp',
      });
      (prisma.invitationCode.findMany as jest.Mock).mockResolvedValueOnce([
        {
          id: 'g-url-1',
          guestName: 'Clara Oswald',
          code: 'CLARA+1',
          email: 'clara@example.com',
        },
      ]);

      const preview = await BroadcastService.renderPreview({
        channel: 'EMAIL',
        subject: 'RSVP for {{guestName}}',
        body: 'Link: {{rsvpUrl}}',
        targetFilters: { searchQuery: 'Clara' },
      });

      expect(preview.body).toBe('Link: https://celebrate.example.com/guest?code=CLARA%2B1');
      expect(preview.recipientCount).toBe(1);
      expect(preview.baseUrlWarning).toBeUndefined();

      // 2. Empty AppConfig.baseUrl in sendTestBroadcast -> falls back to requestOrigin with warning
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      (getAppConfig as jest.Mock).mockResolvedValueOnce({
        baseUrl: '   ',
        contactEmail: 'host@example.com',
        weddingDate: new Date('2026-10-25'),
        venueName: 'Grand Hall',
        emailProvider: 'smtp',
      });
      const sendEmailSpy = jest
        .spyOn(MultiChannelMessagingProvider.prototype, 'sendEmail')
        .mockResolvedValue({ success: true });

      const testRes = await BroadcastService.sendTestBroadcast({
        channel: 'EMAIL',
        subject: 'Test for {{guestName}}',
        body: 'Tap {{rsvpUrl}}',
        requestOrigin: 'https://selfhosted.wedding.local',
      });

      expect(testRes.body).toBe('Tap https://selfhosted.wedding.local/guest?code=SAMPLE2026');
      expect(testRes.baseUrlWarning).toContain('https://selfhosted.wedding.local');

      // 3. Dispatch via sendBroadcast resolves personalized {{rsvpUrl}} per recipient
      (getAppConfig as jest.Mock).mockResolvedValueOnce({
        baseUrl: 'https://celebrate.example.com',
        weddingDate: new Date('2026-10-25'),
        venueName: 'Grand Hall',
        emailProvider: 'smtp',
        broadcastBatchSize: 10,
        broadcastBatchDelayMs: 0,
      });
      (prisma.invitationCode.findMany as jest.Mock).mockResolvedValueOnce([
        {
          id: 'g-disp-1',
          guestName: 'Rory Williams',
          code: 'RORY2026',
          email: 'rory@example.com',
        },
      ]);
      (prisma.broadcastMessage.create as jest.Mock).mockResolvedValueOnce({
        id: 'bm-url-1',
        status: 'SENDING',
      });
      (prisma.broadcastRecipient.create as jest.Mock).mockResolvedValueOnce({
        id: 'br-url-1',
      });
      (prisma.broadcastRecipient.update as jest.Mock).mockResolvedValueOnce({});
      (prisma.broadcastMessage.update as jest.Mock).mockResolvedValueOnce({
        id: 'bm-url-1',
        status: 'SENT',
        sentCount: 1,
        failedCount: 0,
      });

      await BroadcastService.sendBroadcast({
        channel: 'EMAIL',
        subject: 'Reminder for {{guestName}}',
        body: 'Confirm at {{rsvpUrl}}',
      });

      expect(sendEmailSpy).toHaveBeenLastCalledWith({
        to: 'rory@example.com',
        subject: 'Reminder for Rory Williams',
        body: 'Confirm at https://celebrate.example.com/guest?code=RORY2026',
      });

      sendEmailSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it('renders themed htmlBody in EMAIL renderPreview for stationery cards and strips [CARD:...] directive on SMS', async () => {
      (getAppConfig as jest.Mock).mockResolvedValueOnce({
        partner1Name: 'Sarah',
        partner2Name: 'Dan',
        weddingDate: new Date('2026-10-25T16:00:00Z'),
        venueName: 'Grand Hall',
        venueCity: 'Austin',
        venueState: 'TX',
        colorPrimary: '#2C3E50',
        colorSecondary: '#B8860B',
        baseUrl: 'https://celebrate.example.com',
        emailProvider: 'none',
      });
      (prisma.invitationCode.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'card-guest-1',
        guestName: 'Alice Smith',
        code: 'ALICE2026',
        householdName: 'Smith Family',
        email: 'alice@example.com',
      });

      const emailCardPreview = await BroadcastService.renderPreview({
        channel: 'EMAIL',
        subject: 'You Are Invited: {{coupleNames}}',
        body: '[CARD:formal-invitation]\nDear {{guestName}},\n\nRSVP: {{rsvpUrl}}',
        sampleGuestId: 'card-guest-1',
      });

      expect(emailCardPreview.subject).toBe('You Are Invited: Sarah & Dan');
      expect(emailCardPreview.htmlBody).toBeDefined();
      expect(emailCardPreview.htmlBody).toContain('Sarah &amp; Dan');
      expect(emailCardPreview.htmlBody).toContain('https://calendar.google.com/calendar/render');
      expect(emailCardPreview.htmlBody).toContain('https://celebrate.example.com/guest?code=ALICE2026');

      (prisma.invitationCode.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'card-guest-1',
        guestName: 'Alice Smith',
        code: 'ALICE2026',
        extraFields: { phone: '+15551112222' },
      });

      const smsPreview = await BroadcastService.renderPreview({
        channel: 'SMS',
        body: '[CARD:save-the-date]\nSave the Date, {{guestName}}! {{rsvpUrl}}',
        sampleGuestId: 'card-guest-1',
      });
      expect(smsPreview.body).not.toContain('[CARD:save-the-date]');
      expect(smsPreview.htmlBody).toBeUndefined();
    });

    it('marks recipients FAILED when emailProvider is smtp with blank smtpHost and counts VIEWED recipients in sentCount during per-recipient resend', async () => {
      (getAppConfig as jest.Mock).mockResolvedValueOnce({
        weddingDate: new Date('2026-10-25'),
        venueName: 'Grand Hall',
        emailProvider: 'smtp',
        smtpHost: '   ',
        broadcastBatchSize: 10,
        broadcastBatchDelayMs: 0,
      });
      (prisma.invitationCode.findMany as jest.Mock).mockResolvedValueOnce([
        { id: 'g-smtp-missing', guestName: 'Unconfigured Guest', code: 'U1', email: 'u@example.com' },
      ]);
      (prisma.broadcastMessage.create as jest.Mock).mockResolvedValueOnce({
        id: 'bm-smtp-fail',
        status: 'SENDING',
      });
      (prisma.broadcastRecipient.create as jest.Mock).mockResolvedValueOnce({
        id: 'br-smtp-fail',
      });
      (prisma.broadcastRecipient.update as jest.Mock).mockResolvedValueOnce({});
      (prisma.broadcastMessage.update as jest.Mock).mockResolvedValueOnce({
        id: 'bm-smtp-fail',
        status: 'FAILED',
        sentCount: 0,
        failedCount: 1,
      });

      await BroadcastService.sendBroadcast({
        channel: 'EMAIL',
        subject: 'Hello',
        body: 'Test',
      });

      expect(prisma.broadcastRecipient.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: expect.any(String) },
          data: expect.objectContaining({
            status: 'FAILED',
            error: expect.stringMatching(/SMTP Host is missing/i),
          }),
        })
      );

      // Per-recipient resend preserves VIEWED rows inside sentCount query
      (prisma.broadcastMessage.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'bm-resend-single',
        channel: 'EMAIL',
        subject: 'Formal Invite',
        body: 'Welcome {{guestName}}',
        recipients: [
          {
            id: 'rec-target',
            guestName: 'Resend Target',
            destination: 'target@example.com',
            status: 'SENT',
            invitationCode: { code: 'TARGET26', householdName: 'Target HH' },
          },
        ],
      });
      (prisma.broadcastRecipient.updateMany as jest.Mock).mockResolvedValueOnce({ count: 1 });
      (prisma.broadcastRecipient.count as jest.Mock)
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(0);
      (prisma.broadcastMessage.update as jest.Mock).mockResolvedValueOnce({
        id: 'bm-resend-single',
        status: 'SENT',
        sentCount: 3,
        failedCount: 0,
      });

      await BroadcastService.retryFailedRecipients('bm-resend-single', ['rec-target']);

      expect(prisma.broadcastRecipient.count).toHaveBeenCalledWith({
        where: { broadcastId: 'bm-resend-single', status: { in: ['SENT', 'VIEWED'] } },
      });
    });
  });

  describe('getBroadcastHistory, countBroadcastHistory, and getBroadcastById', () => {
    it('queries BroadcastMessage summary rows without recipients join and defaults to limit=50, page=1', async () => {
      const mockRows = [
        {
          id: 'bc-1',
          channel: 'EMAIL',
          subject: 'Welcome Update',
          body: 'See you soon!',
          status: 'SENT',
          totalRecipients: 400,
          sentCount: 398,
          failedCount: 2,
          createdAt: new Date('2026-06-01T12:00:00Z'),
        },
      ];
      (prisma.broadcastMessage.findMany as jest.Mock).mockResolvedValueOnce(mockRows);

      const history = await BroadcastService.getBroadcastHistory();

      expect(prisma.broadcastMessage.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.broadcastMessage.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
      expect(prisma.broadcastRecipient.findMany).not.toHaveBeenCalled();
      expect(history).toEqual(mockRows);
      expect(history[0].recipients).toBeUndefined();
    });

    it('caps getBroadcastHistory limit at 100 and computes page offset accurately', async () => {
      (prisma.broadcastMessage.findMany as jest.Mock).mockResolvedValueOnce([]);

      await BroadcastService.getBroadcastHistory({ page: 2, limit: 250 });

      expect(prisma.broadcastMessage.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
        take: 100,
        skip: 100,
      });
    });

    it('counts total BroadcastMessage rows via countBroadcastHistory', async () => {
      (prisma.broadcastMessage.count as jest.Mock).mockResolvedValueOnce(42);

      const total = await BroadcastService.countBroadcastHistory();

      expect(prisma.broadcastMessage.count).toHaveBeenCalledTimes(1);
      expect(total).toBe(42);
    });

    it('fetches full broadcast details and ordered recipients via getBroadcastById', async () => {
      const detailRecord = {
        id: 'bc-detail-1',
        channel: 'EMAIL',
        subject: 'Shuttle Departure',
        body: 'Full body text',
        status: 'PARTIALLY_SENT',
        totalRecipients: 2,
        sentCount: 1,
        failedCount: 1,
        createdAt: new Date('2026-06-01T12:00:00Z'),
        recipients: [
          {
            id: 'r-fail',
            guestName: 'Aaron',
            destination: 'aaron@example.com',
            status: 'FAILED',
            error: 'Mailbox unavailable',
          },
          {
            id: 'r-sent',
            guestName: 'Zoe',
            destination: 'zoe@example.com',
            status: 'SENT',
            error: null,
          },
        ],
      };
      (prisma.broadcastMessage.findUnique as jest.Mock).mockResolvedValueOnce(detailRecord);

      const result = await BroadcastService.getBroadcastById('bc-detail-1');

      expect(prisma.broadcastMessage.findUnique).toHaveBeenCalledWith({
        where: { id: 'bc-detail-1' },
        include: {
          recipients: {
            orderBy: [
              { status: 'asc' },
              { guestName: 'asc' },
              { createdAt: 'asc' },
            ],
          },
        },
      });
      expect(result).toEqual(detailRecord);
    });

    it('keeps serialized summary payload for 25 broadcasts of 400 guests well under 90 KB', async () => {
      const summaryRows = Array.from({ length: 25 }, (_, i) => ({
        id: `bc-bench-${i}`,
        channel: i % 2 === 0 ? 'EMAIL' : 'SMS',
        subject: `Wedding Announcement #${i + 1}: Shuttle & Welcome Reception Details`,
        body: 'Dear {{guestName}}, our shuttle leaves the Grand Hotel lobby promptly at 4:15 PM. Please confirm your seat at {{rsvpUrl}}.',
        targetFilters: { attendanceStatus: 'attending', partyTags: ['Out of Town'] },
        status: 'PARTIALLY_SENT',
        totalRecipients: 400,
        sentCount: 396,
        failedCount: 4,
        scheduledFor: null,
        sentAt: '2026-06-01T18:00:00.000Z',
        createdAt: '2026-06-01T17:59:00.000Z',
        updatedAt: '2026-06-01T18:00:00.000Z',
      }));

      (prisma.broadcastMessage.findMany as jest.Mock).mockResolvedValueOnce(summaryRows);

      const history = await BroadcastService.getBroadcastHistory({ page: 1, limit: 50 });
      const payloadBytes = Buffer.byteLength(
        JSON.stringify({ success: true, data: history }),
        'utf8'
      );

      expect(payloadBytes).toBeLessThan(90 * 1024);
    });

    it('attaches aggregated viewedCount via broadcastRecipient.groupBy when VIEWED recipients exist without joining recipient rows', async () => {
      const mockRows = [
        {
          id: 'bc-viewed-1',
          channel: 'EMAIL',
          subject: 'Formal Invitation',
          body: 'You are invited!',
          status: 'SENT',
          totalRecipients: 10,
          sentCount: 10,
          failedCount: 0,
          createdAt: new Date('2026-06-01T12:00:00Z'),
        },
        {
          id: 'bc-viewed-2',
          channel: 'EMAIL',
          subject: 'Shuttle Update',
          body: 'Bus leaves at 4 PM',
          status: 'SENT',
          totalRecipients: 5,
          sentCount: 5,
          failedCount: 0,
          createdAt: new Date('2026-06-01T11:00:00Z'),
        },
      ];
      (prisma.broadcastMessage.findMany as jest.Mock).mockResolvedValueOnce(mockRows);
      const groupByMock = jest
        .fn()
        .mockResolvedValueOnce([{ broadcastId: 'bc-viewed-1', _count: { _all: 4 } }]);
      (prisma.broadcastRecipient as unknown as { groupBy?: jest.Mock }).groupBy = groupByMock;

      try {
        const history = await BroadcastService.getBroadcastHistory();

        expect(groupByMock).toHaveBeenCalledWith({
          by: ['broadcastId'],
          where: {
            broadcastId: { in: ['bc-viewed-1', 'bc-viewed-2'] },
            status: 'VIEWED',
          },
          _count: { _all: true },
        });
        expect(prisma.broadcastRecipient.findMany).not.toHaveBeenCalled();
        expect(history).toEqual([
          { ...mockRows[0], viewedCount: 4 },
          mockRows[1],
        ]);
      } finally {
        delete (prisma.broadcastRecipient as unknown as { groupBy?: jest.Mock }).groupBy;
      }
    });
  });
});
