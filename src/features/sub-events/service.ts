import { prisma } from '@/lib/prisma';
import { getAppConfig } from '@/lib/config';
import { ApiError } from '@/utils/ApiError';
import {
  evaluateRsvpCutoff,
  type RsvpCutoffConfigInput,
  type RsvpCutoffEvaluation,
} from '@/utils/rsvpDeadline';
import { isPrivateContentNode } from '@/features/content';
import {
  SubEventRsvpSubmissionItem,
  BatchUpdateSubEventAccessDTO,
  MealOptionDTO,
  CustomRsvpQuestionDTO,
  normalizeMealOptions,
  normalizeCustomQuestions,
  normalizeMealSelections,
  normalizeCustomAnswers,
  normalizePlusOneNames,
} from './schemas';

export interface HouseholdMemberEventRsvp {
  invitationCodeId: string;
  guestName: string;
  plusOneAllocations: number;
  savedPlusOneNames: string[];
  userRsvp: {
    status: 'attending' | 'declined' | 'pending';
    plusOneCount: number;
    dietaryNotes: string;
    mealSelections?: string[];
    customAnswers?: Record<string, string>;
    plusOneNames?: string[];
  } | null;
}

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
  isReadOnly?: boolean;
  attireRules?: string | null;
  mealOptions?: MealOptionDTO[];
  customQuestions?: CustomRsvpQuestionDTO[];
  userRsvp?: {
    status: 'attending' | 'declined' | 'pending';
    plusOneCount: number;
    dietaryNotes: string;
    mealSelections?: string[];
    customAnswers?: Record<string, string>;
    plusOneNames?: string[];
  } | null;
  householdRsvps?: HouseholdMemberEventRsvp[];
}

interface HouseholdMemberRow {
  id: string;
  guestName?: string | null;
  householdName?: string | null;
  plusOneAllocations?: number | null;
  plusOneFirstName?: string | null;
  plusOneLastName?: string | null;
  extraFields?: unknown;
  isSample?: boolean;
}

function extractSavedPlusOneNamesFromInvite(invite: {
  plusOneFirstName?: string | null;
  plusOneLastName?: string | null;
  extraFields?: unknown;
}): string[] {
  const extra = parseExtraFieldsObject(invite.extraFields);
  const extraNames = normalizePlusOneNames(extra.plusOneNames).filter(Boolean);
  if (extraNames.length > 0) {
    return extraNames;
  }

  const combined = [invite.plusOneFirstName, invite.plusOneLastName]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .map((part) => part.trim())
    .join(' ');

  return combined ? [combined] : [];
}

function formatDbRsvpRecord(rsvp: any): HouseholdMemberEventRsvp['userRsvp'] {
  if (!rsvp) return null;
  return {
    status: rsvp.status as 'attending' | 'declined' | 'pending',
    plusOneCount: rsvp.plusOneCount ?? 0,
    dietaryNotes: rsvp.dietaryNotes || '',
    ...(rsvp.mealSelections !== undefined
      ? { mealSelections: normalizeMealSelections(rsvp.mealSelections) }
      : {}),
    ...(rsvp.customAnswers !== undefined
      ? { customAnswers: normalizeCustomAnswers(rsvp.customAnswers) }
      : {}),
    ...(rsvp.plusOneNames !== undefined
      ? { plusOneNames: normalizePlusOneNames(rsvp.plusOneNames) }
      : {}),
  };
}

function parseExtraFieldsObject(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function splitFullName(fullName: string): { firstName: string | null; lastName: string | null } {
  const trimmed = fullName.trim();
  if (!trimmed) {
    return { firstName: null, lastName: null };
  }
  const parts = trimmed.split(/\s+/);
  const firstName = parts[0] || null;
  const lastName = parts.length > 1 ? parts.slice(1).join(' ') : null;
  return { firstName, lastName };
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
   * Loads RSVP cutoff configuration from AppConfig (using getAppConfig for the primary
   * Prisma client or querying an injected test client when available).
   */
  private async loadRsvpConfig(): Promise<RsvpCutoffConfigInput | null> {
    if (this.client === prisma) {
      return getAppConfig();
    }
    if (typeof this.client?.appConfig?.findUnique === 'function') {
      return this.client.appConfig.findUnique({ where: { id: 'global' } });
    }
    return null;
  }

  /**
   * Evaluates whether online RSVPs are currently open using the server clock and
   * the venue IANA timezone configured in AppConfig.
   */
  async getRsvpStatus(now: Date = new Date()): Promise<RsvpCutoffEvaluation> {
    const config = await this.loadRsvpConfig();
    return evaluateRsvpCutoff(config, now);
  }

  /**
   * Throws HTTP 403 with the configured closing message when online RSVPs are closed
   * manually or past the midnight cutoff + silent grace window.
   */
  async assertRsvpsOpen(now: Date = new Date()): Promise<RsvpCutoffEvaluation> {
    const status = await this.getRsvpStatus(now);
    if (!status.isOpen) {
      throw new ApiError(403, status.closedMessage);
    }
    return status;
  }

  /**
   * Retrieves the plus-one allowance assigned to an invitation code, or null if not found.
   */
  async getPlusOneAllowanceForGuest(code?: string | null): Promise<number | null> {
    if (!code || typeof code !== 'string' || !code.trim()) {
      return null;
    }

    const invite = await this.client.invitationCode.findUnique({
      where: { code: code.trim().toUpperCase(), isSample: false },
      select: { plusOneAllocations: true },
    });

    if (!invite || invite.isSample) {
      return null;
    }

    return Math.max(0, invite.plusOneAllocations ?? 0);
  }

  /**
   * Retrieves saved plus-one names from an authenticated guest's InvitationCode record.
   */
  async getSavedPlusOneNamesForGuest(code?: string | null): Promise<string[]> {
    if (!code || typeof code !== 'string' || !code.trim()) {
      return [];
    }

    const invite = await this.client.invitationCode.findUnique({
      where: { code: code.trim().toUpperCase(), isSample: false },
      select: {
        plusOneFirstName: true,
        plusOneLastName: true,
        extraFields: true,
      },
    });

    if (!invite || invite.isSample) {
      return [];
    }

    return extractSavedPlusOneNamesFromInvite(invite);
  }

  /**
   * Resolves all non-sample InvitationCode members belonging to the same household as `primaryId`
   * (ordered with the session's primary guest first). Returns null if `findMany` is unavailable.
   */
  private async resolveHouseholdMembers(primaryId: string): Promise<HouseholdMemberRow[] | null> {
    if (typeof this.client.invitationCode?.findMany !== 'function') {
      return null;
    }

    const primaryRows = await this.client.invitationCode.findMany({
      where: { id: primaryId, isSample: false },
      select: {
        id: true,
        guestName: true,
        householdName: true,
        plusOneAllocations: true,
        plusOneFirstName: true,
        plusOneLastName: true,
        extraFields: true,
      },
    });

    if (!Array.isArray(primaryRows) || primaryRows.length === 0) {
      return null;
    }

    const primary = primaryRows[0] as HouseholdMemberRow;
    if (!primary || primary.isSample) {
      return null;
    }

    const cleanHouseholdName =
      typeof primary.householdName === 'string' ? primary.householdName.trim() : '';
    if (!cleanHouseholdName) {
      return [primary];
    }

    const siblings = await this.client.invitationCode.findMany({
      where: {
        householdName: { equals: cleanHouseholdName, mode: 'insensitive' },
        isSample: false,
      },
      select: {
        id: true,
        guestName: true,
        householdName: true,
        plusOneAllocations: true,
        plusOneFirstName: true,
        plusOneLastName: true,
        extraFields: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    if (!Array.isArray(siblings) || siblings.length === 0) {
      return [primary];
    }

    const orderedSiblings = siblings.filter(
      (s: HouseholdMemberRow) => s && !s.isSample && s.id !== primaryId
    );
    return [primary, ...orderedSiblings];
  }

  /**
   * Retrieves household metadata (householdName and invited member summaries) for an active guest code.
   */
  async getHouseholdSummaryForGuest(code?: string | null): Promise<{
    householdName: string | null;
    members: Array<{
      invitationCodeId: string;
      guestName: string;
      plusOneAllocations: number;
    }>;
  } | null> {
    if (!code || typeof code !== 'string' || !code.trim()) {
      return null;
    }

    const invite = await this.client.invitationCode.findUnique({
      where: { code: code.trim().toUpperCase(), isSample: false },
      select: { id: true },
    });

    if (!invite || invite.isSample) {
      return null;
    }

    const members = await this.resolveHouseholdMembers(invite.id);
    if (!members || members.length === 0) {
      return null;
    }

    return {
      householdName:
        typeof members[0].householdName === 'string' && members[0].householdName.trim()
          ? members[0].householdName.trim()
          : null,
      members: members.map((m) => ({
        invitationCodeId: m.id,
        guestName: m.guestName || 'Guest',
        plusOneAllocations: Math.max(0, m.plusOneAllocations ?? 0),
      })),
    };
  }

  /**
   * Retrieves a single sub-event by ID for a visitor or authenticated guest.
   * Public sub-events are accessible to everyone.
   * Private sub-events require an authenticated guest invitation code session with granted access.
   * Throws ApiError 404 if the sub-event is not found.
   * Throws ApiError 403 if the visitor is unauthenticated or lacks access to the private sub-event.
   */
  async getSubEventByIdForGuest(id: string, code?: string | null): Promise<ScheduleEventWithRsvp> {
    if (!id || typeof id !== 'string' || !id.trim()) {
      throw new ApiError(404, 'Sub-event ID is required.');
    }

    let invitationCodeId: string | null = null;
    if (code && typeof code === 'string' && code.trim()) {
      const invite = await this.client.invitationCode.findUnique({
        where: { code: code.trim().toUpperCase(), isSample: false },
        select: { id: true },
      });
      if (invite && !invite.isSample) {
        invitationCodeId = invite.id;
      }
    }

    // Try finding in SubEvent table
    const subEvent = await this.client.subEvent.findUnique({
      where: { id: id.trim() },
      include: {
        accesses: invitationCodeId
          ? {
            where: {
              invitationCodeId: invitationCodeId,
            },
          }
          : true,
        rsvps: invitationCodeId
          ? {
            where: {
              invitationCodeId: invitationCodeId,
            },
          }
          : false,
      },
    });

    if (!subEvent) {
      // Fallback: check ContentNode
      let node: any = null;
      if (this.client.contentNode?.findUnique) {
        node = await this.client.contentNode.findUnique({
          where: { id: id.trim() },
        });
      }
      if (!node && this.client.contentNode?.findFirst) {
        node = await this.client.contentNode.findFirst({
          where: { id: id.trim() },
        });
      }

      if (node && (node.type === 'Schedule' || node.type === 'Logistics' || node.tags?.includes('Schedule') || node.tags?.includes('schedule'))) {
        if (isPrivateContentNode(node)) {
          throw new ApiError(403, `Forbidden: You do not have access to private event "${node.data?.title || 'Scheduled Event'}".`);
        }
        return {
          id: node.id,
          title: node.data?.title || node.data?.ceremonyTitle || node.data?.receptionTitle || 'Scheduled Event',
          description: node.data?.description || node.data?.receptionDetails || '',
          startTime: node.data?.startTime || null,
          endTime: node.data?.endTime || null,
          locationName: node.data?.locationName || node.data?.location || '',
          location: node.data?.location || '',
          category: node.data?.category || '',
          isPrivate: false,
          isReadOnly: true,
          attireRules: node.data?.attireRules || node.data?.attire || node.data?.receptionAttire || null,
          userRsvp: null,
        };
      }

      throw new ApiError(404, `Sub-event with ID ${id} not found.`);
    }

    // Access control for private events
    if (subEvent.isPrivate) {
      if (!invitationCodeId || !subEvent.accesses || subEvent.accesses.length === 0) {
        throw new ApiError(403, `Forbidden: You do not have access to private event "${subEvent.title}".`);
      }
    }

    const rsvp = subEvent.rsvps && subEvent.rsvps.length > 0 ? subEvent.rsvps[0] : null;

    return {
      id: subEvent.id,
      title: subEvent.title,
      description: subEvent.description || '',
      startTime: subEvent.startTime instanceof Date ? subEvent.startTime.toISOString() : (subEvent.startTime || null),
      endTime: subEvent.endTime instanceof Date ? subEvent.endTime.toISOString() : (subEvent.endTime || null),
      locationName: subEvent.locationName || '',
      location: subEvent.location || '',
      category: subEvent.category || '',
      isPrivate: subEvent.isPrivate,
      isReadOnly: false,
      attireRules: (subEvent as any).attireRules || (subEvent as any).attire || null,
      mealOptions: normalizeMealOptions(subEvent.mealOptions),
      customQuestions: normalizeCustomQuestions(subEvent.customQuestions),
      userRsvp: rsvp
        ? {
          status: rsvp.status as 'attending' | 'declined' | 'pending',
          plusOneCount: rsvp.plusOneCount ?? 0,
          dietaryNotes: rsvp.dietaryNotes || '',
          ...(rsvp.mealSelections !== undefined
            ? { mealSelections: normalizeMealSelections(rsvp.mealSelections) }
            : {}),
          ...(rsvp.customAnswers !== undefined
            ? { customAnswers: normalizeCustomAnswers(rsvp.customAnswers) }
            : {}),
          ...(rsvp.plusOneNames !== undefined
            ? { plusOneNames: normalizePlusOneNames(rsvp.plusOneNames) }
            : {}),
        }
        : null,
    };
  }

  /**
   * Retrieves the schedule accessible to a visitor based on their invitation code session.
   * Unauthenticated visitors receive only public sub-events.
   * Authenticated guests receive public sub-events plus private sub-events assigned to their invitation code.
   */
  async getScheduleForGuest(code?: string | null): Promise<ScheduleEventWithRsvp[]> {
    let invitationCodeId: string | null = null;

    if (code && typeof code === 'string' && code.trim()) {
      const invite = await this.client.invitationCode.findUnique({
        where: { code: code.trim().toUpperCase(), isSample: false },
        select: { id: true },
      });
      if (invite && !invite.isSample) {
        invitationCodeId = invite.id;
      }
    }

    const householdMembers = invitationCodeId
      ? await this.resolveHouseholdMembers(invitationCodeId)
      : null;
    const isMultiMemberHousehold = Boolean(householdMembers && householdMembers.length > 1);

    // Query SubEvent table
    let subEvents: any[] = [];
    if (invitationCodeId && isMultiMemberHousehold && householdMembers) {
      const memberIds = householdMembers.map((m) => m.id);
      subEvents = await this.client.subEvent.findMany({
        where: {
          OR: [
            { isPrivate: false },
            {
              accesses: {
                some: {
                  invitationCodeId: { in: memberIds },
                },
              },
            },
          ],
        },
        include: {
          accesses: {
            where: {
              invitationCodeId: { in: memberIds },
            },
          },
          rsvps: {
            where: {
              invitationCodeId: { in: memberIds },
            },
          },
        },
        orderBy: {
          startTime: 'asc',
        },
      });
    } else if (invitationCodeId) {
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
          if (isPrivateContentNode(n)) return false;
          return (
            n.type === 'Schedule' ||
            n.tags?.includes('Schedule') ||
            n.tags?.includes('schedule') ||
            Boolean(n.data?.startTime)
          );
        })
        .map((n: any) => ({
          id: n.id,
          title: n.data?.title || n.data?.ceremonyTitle || n.data?.receptionTitle || 'Scheduled Event',
          description: n.data?.description || n.data?.receptionDetails || '',
          startTime: n.data?.startTime || null,
          endTime: n.data?.endTime || null,
          locationName: n.data?.locationName || n.data?.location || '',
          location: n.data?.location || '',
          category: n.data?.category || '',
          isPrivate: false,
          isReadOnly: true,
          attireRules: n.data?.attireRules || n.data?.attire || n.data?.receptionAttire || null,
          userRsvp: null,
        }));
    }

    return subEvents.map((evt: any) => {
      if (isMultiMemberHousehold && householdMembers) {
        const accessedMemberIds = new Set<string>(
          Array.isArray(evt.accesses)
            ? evt.accesses
              .map((acc: any) => acc?.invitationCodeId)
              .filter((id: unknown): id is string => typeof id === 'string')
            : []
        );
        const eligibleMembers = evt.isPrivate
          ? householdMembers.filter((m) => accessedMemberIds.has(m.id))
          : householdMembers;

        const rsvpByMemberId = new Map<string, any>();
        if (Array.isArray(evt.rsvps)) {
          for (const r of evt.rsvps) {
            if (r && typeof r.invitationCodeId === 'string') {
              rsvpByMemberId.set(r.invitationCodeId, r);
            }
          }
        }

        const householdRsvps: HouseholdMemberEventRsvp[] = eligibleMembers.map((member) => ({
          invitationCodeId: member.id,
          guestName: member.guestName || 'Guest',
          plusOneAllocations: Math.max(0, member.plusOneAllocations ?? 0),
          savedPlusOneNames: extractSavedPlusOneNamesFromInvite(member),
          userRsvp: formatDbRsvpRecord(rsvpByMemberId.get(member.id) || null),
        }));

        const primaryRsvp =
          (invitationCodeId ? rsvpByMemberId.get(invitationCodeId) : null) ??
          (eligibleMembers[0] ? rsvpByMemberId.get(eligibleMembers[0].id) : null) ??
          null;

        return {
          id: evt.id,
          title: evt.title,
          description: evt.description || '',
          startTime: evt.startTime instanceof Date ? evt.startTime.toISOString() : (evt.startTime || null),
          endTime: evt.endTime instanceof Date ? evt.endTime.toISOString() : (evt.endTime || null),
          locationName: evt.locationName || '',
          location: evt.location || '',
          category: evt.category || '',
          isPrivate: evt.isPrivate,
          isReadOnly: false,
          attireRules: (evt as any).attireRules || (evt as any).attire || null,
          mealOptions: normalizeMealOptions(evt.mealOptions),
          customQuestions: normalizeCustomQuestions(evt.customQuestions),
          userRsvp: formatDbRsvpRecord(primaryRsvp),
          householdRsvps,
        };
      }

      const rsvp = evt.rsvps && evt.rsvps.length > 0 ? evt.rsvps[0] : null;
      return {
        id: evt.id,
        title: evt.title,
        description: evt.description || '',
        startTime: evt.startTime instanceof Date ? evt.startTime.toISOString() : (evt.startTime || null),
        endTime: evt.endTime instanceof Date ? evt.endTime.toISOString() : (evt.endTime || null),
        locationName: evt.locationName || '',
        location: evt.location || '',
        category: evt.category || '',
        isPrivate: evt.isPrivate,
        isReadOnly: false,
        attireRules: (evt as any).attireRules || (evt as any).attire || null,
        mealOptions: normalizeMealOptions(evt.mealOptions),
        customQuestions: normalizeCustomQuestions(evt.customQuestions),
        userRsvp: formatDbRsvpRecord(rsvp),
      };
    });
  }

  /**
   * Submits RSVP decision(s) for sub-events on behalf of an authenticated guest.
   */
  async submitSubEventRsvps(
    code: string,
    submissions: SubEventRsvpSubmissionItem[],
    now: Date = new Date()
  ) {
    if (!code || typeof code !== 'string') {
      throw new ApiError(401, 'Invitation code is required.');
    }

    const invite = await this.client.invitationCode.findUnique({
      where: { code: code.trim().toUpperCase(), isSample: false },
      select: { id: true, guestName: true, plusOneAllocations: true },
    });

    if (!invite || invite.isSample) {
      throw new ApiError(401, 'Invalid invitation session.');
    }

    await this.assertRsvpsOpen(now);

    if (!submissions || submissions.length === 0) {
      return [];
    }

    const householdMembers = await this.resolveHouseholdMembers(invite.id);
    const allowedMembers = new Map<
      string,
      { id: string; guestName: string; plusOneAllocations: number }
    >();
    allowedMembers.set(invite.id, {
      id: invite.id,
      guestName: invite.guestName || 'Primary Guest',
      plusOneAllocations: Math.max(0, invite.plusOneAllocations ?? 0),
    });
    if (householdMembers) {
      for (const m of householdMembers) {
        allowedMembers.set(m.id, {
          id: m.id,
          guestName: m.guestName || 'Guest',
          plusOneAllocations: Math.max(0, m.plusOneAllocations ?? 0),
        });
      }
    }

    // Validate household ownership & deduplicate (subEventId, targetMemberId) pairs (last write wins)
    const dedupedByKey = new Map<
      string,
      { sub: SubEventRsvpSubmissionItem; targetMemberId: string }
    >();
    for (const sub of submissions) {
      const targetMemberId = sub.invitationCodeId?.trim() || invite.id;
      if (!allowedMembers.has(targetMemberId)) {
        throw new ApiError(
          403,
          'Forbidden: You can only submit RSVPs for members of your own household.'
        );
      }
      dedupedByKey.set(`${sub.subEventId}::${targetMemberId}`, { sub, targetMemberId });
    }

    const effectiveInputs = Array.from(dedupedByKey.values());
    const distinctMemberIds = Array.from(
      new Set(effectiveInputs.map((entry) => entry.targetMemberId))
    );
    const isSinglePrimaryTarget =
      distinctMemberIds.length === 1 && distinctMemberIds[0] === invite.id;

    // Collect all unique identifiers from the submissions array before query execution
    const subEventIds = Array.from(new Set(effectiveInputs.map((entry) => entry.sub.subEventId)));

    // Bulk fetch all referenced records with access relations in one query
    const subEvents = await this.client.subEvent.findMany({
      where: {
        id: { in: subEventIds },
      },
      include: {
        accesses: {
          where: {
            invitationCodeId: isSinglePrimaryTarget ? invite.id : { in: distinctMemberIds },
          },
        },
      },
    });

    const subEventMap = new Map<string, any>(subEvents.map((se: any) => [se.id, se]));

    // Check if any missing IDs correspond to read-only fallback ContentNode items
    const missingIds = subEventIds.filter((id) => !subEventMap.has(id));
    let fallbackNodeIds = new Set<string>();
    if (missingIds.length > 0 && this.client.contentNode?.findMany) {
      const fallbackNodes = await this.client.contentNode.findMany({
        where: {
          id: { in: missingIds },
          OR: [
            { type: 'Schedule' },
            { type: 'Logistics' },
            { tags: { has: 'Schedule' } },
            { tags: { has: 'schedule' } },
          ],
        },
        select: { id: true },
      });
      if (Array.isArray(fallbackNodes)) {
        fallbackNodeIds = new Set(fallbackNodes.map((n: any) => n.id));
      }
    }

    interface NormalizedRsvpWrite {
      subEventId: string;
      invitationCodeId: string;
      status: 'attending' | 'declined' | 'pending';
      plusOneCount: number;
      dietaryNotes: string;
      mealSelections: string[];
      customAnswers: Record<string, string>;
      plusOneNames: string[];
      hadExplicitPlusOneNames: boolean;
    }

    const normalizedSubmissions: NormalizedRsvpWrite[] = [];

    // Validate event existence, read-only status, private permissions, plus-one limits, meal options, and custom questions
    for (const { sub, targetMemberId } of effectiveInputs) {
      if (fallbackNodeIds.has(sub.subEventId)) {
        throw new ApiError(400, 'RSVPs cannot be submitted for read-only schedule items.');
      }

      const subEvent = subEventMap.get(sub.subEventId);

      if (!subEvent) {
        throw new ApiError(404, `Sub-event with ID ${sub.subEventId} not found.`);
      }

      const targetMember = allowedMembers.get(targetMemberId)!;
      const maxPlusOnes = targetMember.plusOneAllocations;

      // Check per-member access permission for private sub-events
      if (subEvent.isPrivate) {
        const accesses = Array.isArray(subEvent.accesses) ? subEvent.accesses : [];
        const memberHasAccess = accesses.some((acc: any) =>
          acc && typeof acc.invitationCodeId === 'string'
            ? acc.invitationCodeId === targetMemberId
            : isSinglePrimaryTarget
        );
        if (!memberHasAccess) {
          throw new ApiError(
            403,
            isSinglePrimaryTarget
              ? `Forbidden: You do not have access to private event "${subEvent.title}".`
              : `Forbidden: ${targetMember.guestName} does not have access to private event "${subEvent.title}".`
          );
        }
      }

      const requestedPlusOnes = sub.status === 'declined' ? 0 : (sub.plusOneCount ?? 0);
      if (requestedPlusOnes > maxPlusOnes) {
        if (maxPlusOnes === 0) {
          throw new ApiError(400, 'Plus-one guests are not allocated for your invitation.');
        }
        throw new ApiError(
          400,
          `Plus-one count (${requestedPlusOnes}) exceeds your allocated limit of ${maxPlusOnes}.`
        );
      }

      const activeMeals = normalizeMealOptions(subEvent.mealOptions);
      const activeQuestions = normalizeCustomQuestions(subEvent.customQuestions);

      if (sub.status === 'declined') {
        normalizedSubmissions.push({
          subEventId: sub.subEventId,
          invitationCodeId: targetMemberId,
          status: 'declined',
          plusOneCount: 0,
          dietaryNotes: sub.dietaryNotes || '',
          mealSelections: [],
          customAnswers: {},
          plusOneNames: [],
          hadExplicitPlusOneNames: true,
        });
        continue;
      }

      const normalizedPlusOneNames =
        requestedPlusOnes === 0
          ? []
          : normalizePlusOneNames(sub.plusOneNames).slice(0, requestedPlusOnes);

      const rawMeals = normalizeMealSelections(sub.mealSelections);
      let normalizedMeals: string[] = [];

      if (activeMeals.length === 0) {
        if (rawMeals.some(Boolean)) {
          throw new ApiError(
            400,
            `Event "${subEvent.title}" does not accept meal selections.`
          );
        }
      } else {
        const validMealIds = new Set(activeMeals.map((opt) => opt.id));
        for (const selectedId of rawMeals) {
          if (selectedId && !validMealIds.has(selectedId)) {
            throw new ApiError(
              400,
              `Invalid meal option "${selectedId}" for event "${subEvent.title}".`
            );
          }
        }

        const expectedPartySize = 1 + requestedPlusOnes;
        if (sub.status === 'attending') {
          const partyMeals = rawMeals.slice(0, expectedPartySize);
          if (partyMeals.length < expectedPartySize || partyMeals.some((id) => !id)) {
            throw new ApiError(
              400,
              `Please select a meal option for all ${expectedPartySize} attending guest${expectedPartySize === 1 ? '' : 's'} for "${subEvent.title}".`
            );
          }
          normalizedMeals = partyMeals;
        } else {
          normalizedMeals = rawMeals.slice(0, expectedPartySize);
        }
      }

      const rawAnswers =
        sub.customAnswers && typeof sub.customAnswers === 'object' ? sub.customAnswers : {};
      const questionMap = new Map(activeQuestions.map((q) => [q.id, q]));
      const cleanedAnswers: Record<string, string> = {};

      for (const [qId, rawVal] of Object.entries(rawAnswers)) {
        const question = questionMap.get(qId);
        if (!question) {
          throw new ApiError(
            400,
            `Invalid custom question "${qId}" for event "${subEvent.title}".`
          );
        }
        const trimmedVal = typeof rawVal === 'string' ? rawVal.trim() : '';
        if (trimmedVal) {
          if (question.type === 'choice' && !question.options.includes(trimmedVal)) {
            throw new ApiError(
              400,
              `Invalid choice "${trimmedVal}" for question "${question.prompt}" in "${subEvent.title}".`
            );
          }
          cleanedAnswers[qId] = trimmedVal;
        }
      }

      if (sub.status === 'attending') {
        for (const question of activeQuestions) {
          if (question.required && !cleanedAnswers[question.id]) {
            throw new ApiError(
              400,
              `Please answer required question "${question.prompt}" for "${subEvent.title}".`
            );
          }
        }
      }

      normalizedSubmissions.push({
        subEventId: sub.subEventId,
        invitationCodeId: targetMemberId,
        status: sub.status,
        plusOneCount: requestedPlusOnes,
        dietaryNotes: sub.dietaryNotes || '',
        mealSelections: normalizedMeals,
        customAnswers: cleanedAnswers,
        plusOneNames: normalizedPlusOneNames,
        hadExplicitPlusOneNames: sub.plusOneNames !== undefined,
      });
    }

    // Execute all upsert operations and InvitationCode sync within a single Prisma transaction
    const results = await this.client.$transaction(async (tx: any) => {
      const upserted = await Promise.all(
        normalizedSubmissions.map((item) =>
          tx.subEventRsvp.upsert({
            where: {
              subEventId_invitationCodeId: {
                subEventId: item.subEventId,
                invitationCodeId: item.invitationCodeId,
              },
            },
            create: {
              subEventId: item.subEventId,
              invitationCodeId: item.invitationCodeId,
              status: item.status,
              plusOneCount: item.plusOneCount,
              dietaryNotes: item.dietaryNotes,
              mealSelections: item.mealSelections,
              customAnswers: item.customAnswers,
              plusOneNames: item.plusOneNames,
            },
            update: {
              status: item.status,
              plusOneCount: item.plusOneCount,
              dietaryNotes: item.dietaryNotes,
              mealSelections: item.mealSelections,
              customAnswers: item.customAnswers,
              plusOneNames: item.plusOneNames,
            },
          })
        )
      );

      if (typeof tx.invitationCode?.update === 'function') {
        const submissionsByMember = new Map<string, NormalizedRsvpWrite[]>();
        for (const item of normalizedSubmissions) {
          const list = submissionsByMember.get(item.invitationCodeId) || [];
          list.push(item);
          submissionsByMember.set(item.invitationCodeId, list);
        }

        for (const [memberId, memberSubmissions] of submissionsByMember.entries()) {
          const memberProfile = allowedMembers.get(memberId) || {
            id: memberId,
            guestName: invite.guestName || 'Primary Guest',
            plusOneAllocations: 0,
          };

          const existingInvite =
            typeof tx.invitationCode?.findUnique === 'function'
              ? await tx.invitationCode.findUnique({
                where: { id: memberId },
                select: {
                  used: true,
                  usedAt: true,
                  plusOneFirstName: true,
                  plusOneLastName: true,
                  dietaryNotes: true,
                  extraFields: true,
                },
              })
              : null;

          const dbRsvps =
            typeof tx.subEventRsvp?.findMany === 'function'
              ? await tx.subEventRsvp.findMany({
                where: { invitationCodeId: memberId },
                include: { subEvent: true },
                orderBy: { createdAt: 'asc' },
              })
              : [];

          const mergedByEvent = new Map<string, any>();
          if (Array.isArray(dbRsvps)) {
            for (const row of dbRsvps) {
              if (row && row.subEventId) {
                mergedByEvent.set(row.subEventId, row);
              }
            }
          }
          for (const item of memberSubmissions) {
            const prevRow = mergedByEvent.get(item.subEventId);
            mergedByEvent.set(item.subEventId, {
              ...(prevRow || {}),
              subEventId: item.subEventId,
              status: item.status,
              plusOneCount: item.plusOneCount,
              dietaryNotes: item.dietaryNotes,
              mealSelections: item.mealSelections,
              customAnswers: item.customAnswers,
              plusOneNames: item.plusOneNames,
              subEvent: prevRow?.subEvent ?? subEventMap.get(item.subEventId),
            });
          }

          const effectiveRsvps = Array.from(mergedByEvent.values());
          const hasAttending = effectiveRsvps.some((r) => r.status === 'attending');
          const hasDeclined = effectiveRsvps.some((r) => r.status === 'declined');
          const attendanceStatus: 'attending' | 'declined' | 'pending' = hasAttending
            ? 'attending'
            : hasDeclined
              ? 'declined'
              : 'pending';
          const hasResponded = hasAttending || hasDeclined;

          const nextUsed = hasResponded ? true : Boolean(existingInvite?.used);
          const nextUsedAt = hasResponded
            ? (existingInvite?.usedAt ?? now)
            : (existingInvite?.usedAt ?? null);

          const maxAttendingPlusOnes = effectiveRsvps.reduce(
            (max, r) => (r.status === 'attending' ? Math.max(max, r.plusOneCount ?? 0) : max),
            0
          );

          const collectedPlusOneNames: string[] = [];
          for (const r of effectiveRsvps) {
            if (r.status !== 'attending' || (r.plusOneCount ?? 0) <= 0) continue;
            const names = normalizePlusOneNames(r.plusOneNames).slice(0, r.plusOneCount);
            for (const name of names) {
              if (name && !collectedPlusOneNames.includes(name)) {
                collectedPlusOneNames.push(name);
              }
            }
          }

          let nextFirstName: string | null = existingInvite?.plusOneFirstName ?? null;
          let nextLastName: string | null = existingInvite?.plusOneLastName ?? null;
          let syncedPlusOneNames: string[] = collectedPlusOneNames;

          if (maxAttendingPlusOnes === 0) {
            nextFirstName = null;
            nextLastName = null;
            syncedPlusOneNames = [];
          } else if (collectedPlusOneNames.length > 0) {
            const split = splitFullName(collectedPlusOneNames[0]);
            nextFirstName = split.firstName;
            nextLastName = split.lastName;
          } else if (memberSubmissions.some((s) => s.hadExplicitPlusOneNames)) {
            nextFirstName = null;
            nextLastName = null;
            syncedPlusOneNames = [];
          } else {
            const fallbackExistingName = [nextFirstName, nextLastName]
              .filter(Boolean)
              .join(' ')
              .trim();
            if (fallbackExistingName) {
              syncedPlusOneNames = [fallbackExistingName];
            }
          }

          const activeNotesList: string[] = [];
          const seenNotesLower = new Set<string>();
          const noteCandidates = effectiveRsvps.filter((r) => r.status !== 'declined');
          const notesSource = noteCandidates.length > 0 ? noteCandidates : effectiveRsvps;
          for (const r of notesSource) {
            const note = typeof r.dietaryNotes === 'string' ? r.dietaryNotes.trim() : '';
            if (note && !seenNotesLower.has(note.toLowerCase())) {
              seenNotesLower.add(note.toLowerCase());
              activeNotesList.push(note);
            }
          }
          const nextDietaryNotes = activeNotesList.length > 0 ? activeNotesList.join('; ') : null;

          const dietaryTagSet = new Set<string>();
          const structuredMeals: Array<{
            subEventId: string;
            subEventTitle: string;
            selections: Array<{
              attendee: string;
              optionId: string;
              label: string;
              dietaryTags: string[];
            }>;
          }> = [];
          const structuredAnswers: Array<{
            subEventId: string;
            subEventTitle: string;
            answers: Array<{
              questionId: string;
              prompt: string;
              answer: string;
            }>;
          }> = [];

          for (const r of effectiveRsvps) {
            if (r.status !== 'attending') continue;
            const evtObj = r.subEvent ?? subEventMap.get(r.subEventId);
            const evtTitle = evtObj?.title || 'Event';
            const evtMealOpts = normalizeMealOptions(evtObj?.mealOptions);
            const evtQuestions = normalizeCustomQuestions(evtObj?.customQuestions);
            const rMeals = normalizeMealSelections(r.mealSelections);
            const rNames = normalizePlusOneNames(r.plusOneNames);
            const rAnswers = normalizeCustomAnswers(r.customAnswers);

            if (evtMealOpts.length > 0 && rMeals.some(Boolean)) {
              const optMap = new Map(evtMealOpts.map((o) => [o.id, o]));
              const resolvedSelections: Array<{
                attendee: string;
                optionId: string;
                label: string;
                dietaryTags: string[];
              }> = [];

              rMeals.forEach((optId, idx) => {
                if (!optId) return;
                const opt = optMap.get(optId);
                const label = opt?.label || optId;
                const tags = opt?.dietaryTags ?? [];
                tags.forEach((tag) => dietaryTagSet.add(tag));
                const attendee =
                  idx === 0
                    ? memberProfile.guestName || 'Primary Guest'
                    : rNames[idx - 1] || syncedPlusOneNames[idx - 1] || `Plus-One #${idx}`;
                resolvedSelections.push({
                  attendee,
                  optionId: optId,
                  label,
                  dietaryTags: tags,
                });
              });

              if (resolvedSelections.length > 0) {
                structuredMeals.push({
                  subEventId: r.subEventId,
                  subEventTitle: evtTitle,
                  selections: resolvedSelections,
                });
              }
            }

            if (evtQuestions.length > 0 && Object.keys(rAnswers).length > 0) {
              const qMap = new Map(evtQuestions.map((q) => [q.id, q]));
              const resolvedAnswers: Array<{
                questionId: string;
                prompt: string;
                answer: string;
              }> = [];

              for (const [qId, ans] of Object.entries(rAnswers)) {
                if (!ans) continue;
                const q = qMap.get(qId);
                resolvedAnswers.push({
                  questionId: qId,
                  prompt: q?.prompt || qId,
                  answer: ans,
                });
              }

              if (resolvedAnswers.length > 0) {
                structuredAnswers.push({
                  subEventId: r.subEventId,
                  subEventTitle: evtTitle,
                  answers: resolvedAnswers,
                });
              }
            }
          }

          const mealSummary = structuredMeals
            .map((entry) => {
              const inner = entry.selections
                .map((sel) =>
                  sel.dietaryTags.length > 0
                    ? `${sel.attendee}: ${sel.label} (${sel.dietaryTags.join(', ')})`
                    : `${sel.attendee}: ${sel.label}`
                )
                .join('; ');
              return structuredMeals.length > 1 ? `${entry.subEventTitle} — ${inner}` : inner;
            })
            .join(' | ');

          const customAnswersSummary = structuredAnswers
            .map((entry) => {
              const inner = entry.answers
                .map((ans) => `${ans.prompt}: ${ans.answer}`)
                .join('; ');
              return structuredAnswers.length > 1 ? `${entry.subEventTitle} — ${inner}` : inner;
            })
            .join(' | ');

          const existingExtra = parseExtraFieldsObject(existingInvite?.extraFields);

          await tx.invitationCode.update({
            where: { id: memberId },
            data: {
              used: nextUsed,
              usedAt: nextUsedAt,
              plusOneFirstName: nextFirstName,
              plusOneLastName: nextLastName,
              dietaryNotes: nextDietaryNotes,
              extraFields: {
                ...existingExtra,
                attendanceStatus,
                plusOneCount: maxAttendingPlusOnes,
                plusOneNames: syncedPlusOneNames,
                dietaryTags: Array.from(dietaryTagSet),
                mealSelections: structuredMeals,
                mealSummary,
                customAnswers: structuredAnswers,
                customAnswersSummary,
              },
            },
          });
        }
      }

      return upserted;
    });

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
        description: e.description || '',
        startTime: e.startTime instanceof Date ? e.startTime.toISOString() : (e.startTime || null),
        endTime: e.endTime instanceof Date ? e.endTime.toISOString() : (e.endTime || null),
        locationName: e.locationName || '',
        location: e.location || '',
        category: e.category || '',
        isPrivate: e.isPrivate,
        ...(e.mealOptions !== undefined ? { mealOptions: normalizeMealOptions(e.mealOptions) } : {}),
        ...(e.customQuestions !== undefined
          ? { customQuestions: normalizeCustomQuestions(e.customQuestions) }
          : {}),
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
