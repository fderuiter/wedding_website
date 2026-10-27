import { prisma } from '@/lib/prisma';
import { ApiError } from '@/utils/ApiError';
import { SubEventRsvpSubmissionItem, BatchUpdateSubEventAccessDTO } from './schemas';

export interface ScheduleEventWithRsvp {
  id: string;
  title: string;
  description?: string | null;
  startTime?: string | Date | null;
  endTime?: string | Date | null;
  locationName?: string | null;
  location?: string | null;
  category?: string | null;
  isPrivate: boolean;
  userRsvp?: {
    status: 'attending' | 'declined' | 'pending';
    plusOneCount: number;
    dietaryNotes: string;
  } | null;
}

export interface AccessMatrixQueryParams {
  page?: number;
  limit?: number;
  search?: string;
  partyTag?: string;
  partyGroup?: string;
  householdName?: string;
}

export class SubEventService {
  constructor(private client: any = prisma) {}

  /**
   * Retrieves the schedule accessible to a visitor based on their invitation code session.
   * Unauthenticated visitors receive only public sub-events.
   * Authenticated guests receive public sub-events plus private sub-events assigned to their invitation code.
   */
  async getScheduleForGuest(code?: string | null): Promise<ScheduleEventWithRsvp[]> {
    let invitationCodeId: string | null = null;

    if (code && typeof code === 'string' && code.trim()) {
      const invite = await this.client.invitationCode.findUnique({
        where: { code: code.trim().toUpperCase() },
        select: { id: true },
      });
      if (invite) {
        invitationCodeId = invite.id;
      }
    }

    // Query SubEvent table
    let subEvents: any[] = [];
    if (invitationCodeId) {
      subEvents = await this.client.subEvent.findMany({
        where: {
          OR: [
            { isPrivate: false },
            {
              accesses: {
                some: {
                  invitationCodeId: invitationCodeId,
                },
              },
            },
          ],
        },
        include: {
          rsvps: {
            where: {
              invitationCodeId: invitationCodeId,
            },
          },
        },
        orderBy: {
          startTime: 'asc',
        },
      });
    } else {
      subEvents = await this.client.subEvent.findMany({
        where: {
          isPrivate: false,
        },
        orderBy: {
          startTime: 'asc',
        },
      });
    }

    // If no records exist in SubEvent table yet, fallback to ContentNode schedule items
    if (subEvents.length === 0) {
      const nodes = await this.client.contentNode.findMany({
        where: {
          OR: [
            { type: 'Schedule' },
            { type: 'Logistics' },
            { tags: { has: 'Schedule' } },
            { tags: { has: 'schedule' } },
          ],
        },
      });

      return nodes
        .filter((n: any) => {
          const isPriv = Boolean(n.data?.isPrivate);
          if (!isPriv) return true;
          // If private, only include if guest has explicit access (or fallback to public)
          return false;
        })
        .map((n: any) => ({
          id: n.id,
          title: n.data?.title || 'Scheduled Event',
          description: n.data?.description || '',
          startTime: n.data?.startTime || null,
          endTime: n.data?.endTime || null,
          locationName: n.data?.locationName || n.data?.location || '',
          location: n.data?.location || '',
          category: n.data?.category || '',
          isPrivate: Boolean(n.data?.isPrivate),
          userRsvp: null,
        }));
    }

    return subEvents.map((evt: any) => {
      const rsvp = evt.rsvps && evt.rsvps.length > 0 ? evt.rsvps[0] : null;
      return {
        id: evt.id,
        title: evt.title,
        description: evt.description || '',
        startTime: evt.startTime ? evt.startTime.toISOString() : null,
        endTime: evt.endTime ? evt.endTime.toISOString() : null,
        locationName: evt.locationName || '',
        location: evt.location || '',
        category: evt.category || '',
        isPrivate: evt.isPrivate,
        userRsvp: rsvp
          ? {
            status: rsvp.status as 'attending' | 'declined' | 'pending',
            plusOneCount: rsvp.plusOneCount ?? 0,
            dietaryNotes: rsvp.dietaryNotes || '',
          }
          : null,
      };
    });
  }

  /**
   * Submits RSVP decision(s) for sub-events on behalf of an authenticated guest.
   */
  async submitSubEventRsvps(
    code: string,
    submissions: SubEventRsvpSubmissionItem[]
  ) {
    if (!code || typeof code !== 'string') {
      throw new ApiError(401, 'Invitation code is required.');
    }

    const invite = await this.client.invitationCode.findUnique({
      where: { code: code.trim().toUpperCase() },
      select: { id: true, guestName: true },
    });

    if (!invite) {
      throw new ApiError(401, 'Invalid invitation session.');
    }

    const results = [];

    for (const sub of submissions) {
      const subEvent = await this.client.subEvent.findUnique({
        where: { id: sub.subEventId },
        include: {
          accesses: {
            where: {
              invitationCodeId: invite.id,
            },
          },
        },
      });

      if (!subEvent) {
        throw new ApiError(404, `Sub-event with ID ${sub.subEventId} not found.`);
      }

      // Check access permission for private sub-events
      if (subEvent.isPrivate && subEvent.accesses.length === 0) {
        throw new ApiError(403, `Forbidden: You do not have access to private event "${subEvent.title}".`);
      }

      // Upsert RSVP
      const rsvp = await this.client.subEventRsvp.upsert({
        where: {
          subEventId_invitationCodeId: {
            subEventId: sub.subEventId,
            invitationCodeId: invite.id,
          },
        },
        create: {
          subEventId: sub.subEventId,
          invitationCodeId: invite.id,
          status: sub.status,
          plusOneCount: sub.plusOneCount ?? 0,
          dietaryNotes: sub.dietaryNotes || '',
        },
        update: {
          status: sub.status,
          plusOneCount: sub.plusOneCount ?? 0,
          dietaryNotes: sub.dietaryNotes || '',
        },
      });

      results.push(rsvp);
    }

    return results;
  }

  /**
   * Updates assigned private sub-events for a given invitation code.
   */
  async updateInvitationSubEventAccess(invitationCodeId: string, allowedSubEventIds: string[]) {
    // Verify invitation code exists
    const invite = await this.client.invitationCode.findUnique({
      where: { id: invitationCodeId },
    });
    if (!invite) {
      throw new ApiError(404, 'Invitation code not found.');
    }

    // Delete existing access records and insert new ones
    await this.client.$transaction(async (tx: any) => {
      await tx.subEventAccess.deleteMany({
        where: { invitationCodeId },
      });

      if (allowedSubEventIds.length > 0) {
        await tx.subEventAccess.createMany({
          data: allowedSubEventIds.map((subEventId) => ({
            subEventId,
            invitationCodeId,
          })),
        });
      }
    });

    return { success: true, invitationCodeId, allowedSubEventIds };
  }

  /**
   * Executes batch update for sub-event access based on target selectors and specified action.
   */
  async batchUpdateSubEventAccess(dto: BatchUpdateSubEventAccessDTO) {
    const conditions: any[] = [];

    if (dto.invitationCodeIds && dto.invitationCodeIds.length > 0) {
      conditions.push({ id: { in: dto.invitationCodeIds } });
    }

    if (dto.partyTags && dto.partyTags.length > 0) {
      conditions.push({ partyTags: { hasSome: dto.partyTags } });
    }

    if (dto.partyGroups && dto.partyGroups.length > 0) {
      conditions.push({ partyGroup: { in: dto.partyGroups } });
    }

    if (dto.householdName) {
      let names: string[] = [];
      if (Array.isArray(dto.householdName)) {
        names = dto.householdName.filter((n) => typeof n === 'string' && n.trim().length > 0);
      } else if (typeof dto.householdName === 'string' && dto.householdName.trim()) {
        names = [dto.householdName.trim()];
      }
      if (names.length > 0) {
        conditions.push({ householdName: { in: names } });
      }
    }

    if (dto.search && typeof dto.search === 'string' && dto.search.trim()) {
      const q = dto.search.trim();
      conditions.push({
        OR: [
          { guestName: { contains: q, mode: 'insensitive' } },
          { code: { contains: q, mode: 'insensitive' } },
          { householdName: { contains: q, mode: 'insensitive' } },
        ],
      });
    }

    let targetCodes: { id: string }[] = [];
    if (conditions.length > 0) {
      targetCodes = await this.client.invitationCode.findMany({
        where: { OR: conditions },
        select: { id: true },
      });
    } else if (!dto.invitationCodeIds) {
      targetCodes = await this.client.invitationCode.findMany({
        select: { id: true },
      });
    }

    const targetIds = Array.from(new Set(targetCodes.map((c: any) => c.id)));

    if (targetIds.length === 0 || dto.subEventIds.length === 0) {
      return {
        success: true,
        count: 0,
        updatedCount: 0,
        targetCodeCount: 0,
        subEventIds: dto.subEventIds,
        action: dto.action,
      };
    }

    const { subEventIds, action } = dto;

    const result = await this.client.$transaction(async (tx: any) => {
      let count = 0;

      if (action === 'grant') {
        const pairs = subEventIds.flatMap((subEventId) =>
          targetIds.map((invitationCodeId) => ({ subEventId, invitationCodeId }))
        );
        const res = await tx.subEventAccess.createMany({
          data: pairs,
          skipDuplicates: true,
        });
        count = res.count;
      } else if (action === 'revoke') {
        const res = await tx.subEventAccess.deleteMany({
          where: {
            invitationCodeId: { in: targetIds },
            subEventId: { in: subEventIds },
          },
        });
        count = res.count;
      } else if (action === 'set') {
        await tx.subEventAccess.deleteMany({
          where: {
            invitationCodeId: { in: targetIds },
            subEventId: { in: subEventIds },
          },
        });
        const pairs = subEventIds.flatMap((subEventId) =>
          targetIds.map((invitationCodeId) => ({ subEventId, invitationCodeId }))
        );
        const res = await tx.subEventAccess.createMany({
          data: pairs,
          skipDuplicates: true,
        });
        count = res.count;
      }

      return { count };
    });

    return {
      success: true,
      count: result.count,
      updatedCount: result.count,
      targetCodeCount: targetIds.length,
      subEventIds,
      action,
    };
  }

  /**
   * Retrieves the access matrix mapping between sub-events and invitation codes.
   */
  async getAccessMatrix(params?: AccessMatrixQueryParams) {
    const page = Math.max(1, params?.page ?? 1);
    const rawLimit = params?.limit ?? 25;
    const limit = Math.min(100, Math.max(1, rawLimit));
    const skip = (page - 1) * limit;

    const where: any = {};

    if (params?.search && params.search.trim()) {
      const q = params.search.trim();
      where.OR = [
        { guestName: { contains: q, mode: 'insensitive' } },
        { code: { contains: q, mode: 'insensitive' } },
        { householdName: { contains: q, mode: 'insensitive' } },
      ];
    }

    if (params?.partyTag && params.partyTag !== 'all' && params.partyTag.trim()) {
      where.partyTags = { has: params.partyTag.trim() };
    }

    if (params?.partyGroup && params.partyGroup !== 'all' && params.partyGroup.trim()) {
      where.partyGroup = params.partyGroup.trim();
    }

    if (params?.householdName && params.householdName !== 'all' && params.householdName.trim()) {
      where.householdName = params.householdName.trim();
    }

    const subEvents = await this.client.subEvent.findMany({
      include: {
        accesses: {
          select: {
            invitationCodeId: true,
          },
        },
      },
      orderBy: {
        startTime: 'asc',
      },
    });

    const total = this.client.invitationCode.count
      ? await this.client.invitationCode.count({ where })
      : (await this.client.invitationCode.findMany({ where })).length;

    const invitationCodes = await this.client.invitationCode.findMany({
      where,
      skip,
      take: limit,
      select: {
        id: true,
        code: true,
        guestName: true,
        householdName: true,
        partyGroup: true,
        partyTags: true,
        subEventAccesses: {
          select: {
            subEventId: true,
          },
        },
      },
      orderBy: {
        guestName: 'asc',
      },
    });

    let partyGroups: string[] = [];
    if (this.client.invitationCode.findMany) {
      const groupsRaw = await this.client.invitationCode.findMany({
        where: { partyGroup: { not: null } },
        select: { partyGroup: true },
        distinct: ['partyGroup'],
      });
      partyGroups = Array.from<string>(
        new Set(groupsRaw.map((g: any) => g.partyGroup).filter(Boolean))
      ).sort();
    }

    let householdNames: string[] = [];
    if (this.client.invitationCode.findMany) {
      const householdsRaw = await this.client.invitationCode.findMany({
        where: { householdName: { not: null } },
        select: { householdName: true },
        distinct: ['householdName'],
      });
      householdNames = Array.from<string>(
        new Set(householdsRaw.map((h: any) => h.householdName).filter(Boolean))
      ).sort();
    }

    let partyTags: string[] = [];
    if (this.client.invitationCode.findMany) {
      const tagsRaw = await this.client.invitationCode.findMany({
        select: { partyTags: true },
      });
      const tagSet = new Set<string>();
      tagsRaw.forEach((t: any) => {
        (t.partyTags || []).forEach((tag: string) => {
          if (tag && tag.trim()) tagSet.add(tag.trim());
        });
      });
      partyTags = Array.from(tagSet).sort();
    }

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      subEvents: (subEvents || []).map((e: any) => ({
        id: e.id,
        title: e.title,
        isPrivate: e.isPrivate,
        allowedInvitationCodeIds: e.accesses ? e.accesses.map((a: any) => a.invitationCodeId) : [],
      })),
      invitationCodes: (invitationCodes || []).map((c: any) => ({
        id: c.id,
        code: c.code,
        guestName: c.guestName,
        householdName: c.householdName || null,
        partyGroup: c.partyGroup || null,
        partyTags: c.partyTags || [],
        allowedSubEventIds: c.subEventAccesses ? c.subEventAccesses.map((a: any) => a.subEventId) : [],
      })),
      pagination: {
        total,
        page,
        limit,
        totalPages,
      },
      filterOptions: {
        partyTags,
        partyGroups,
        householdNames,
      },
    };
  }
}

export const subEventService = new SubEventService();
