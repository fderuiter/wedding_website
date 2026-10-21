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

    let targetCodes: { id: string }[] = [];
    if (conditions.length > 0) {
      targetCodes = await this.client.invitationCode.findMany({
        where: { OR: conditions },
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
  async getAccessMatrix() {
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

    const invitationCodes = await this.client.invitationCode.findMany({
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

    return {
      subEvents: subEvents.map((e: any) => ({
        id: e.id,
        title: e.title,
        isPrivate: e.isPrivate,
        allowedInvitationCodeIds: e.accesses.map((a: any) => a.invitationCodeId),
      })),
      invitationCodes: invitationCodes.map((c: any) => ({
        id: c.id,
        code: c.code,
        guestName: c.guestName,
        householdName: c.householdName || null,
        partyGroup: c.partyGroup || null,
        partyTags: c.partyTags || [],
        allowedSubEventIds: c.subEventAccesses.map((a: any) => a.subEventId),
      })),
    };
  }
}

export const subEventService = new SubEventService();
