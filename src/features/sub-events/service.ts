import { prisma } from '@/lib/prisma';
import { getAppConfig } from '@/lib/config';
import { createAuditSnapshot, createBatchAuditSnapshots } from '@/lib/audit';
import { ApiError } from '@/utils/ApiError';
import {
  evaluateRsvpCutoff,
  type RsvpCutoffConfigInput,
  type RsvpCutoffEvaluation,
} from '@/utils/rsvpDeadline';
import { isPrivateContentNode } from '@/features/content';
import { getAttendanceStatus, extractDietaryTags } from '@/features/registry';
import {
  SubEventRsvpSubmissionItem,
  BatchUpdateSubEventAccessDTO,
  AdminSingleGuestRsvpOverrideDTO,
  AdminBatchAttendanceOverrideDTO,
  MealOptionDTO,
  CustomRsvpQuestionDTO,
  RsvpSummaryResponse,
  SubEventRsvpSummaryItem,
  RsvpDietaryBreakdown,
  RsvpMealOptionCount,
  GlobalRsvpMealTotal,
  RsvpQuestionBreakdown,
  AdminInvitationRsvpsDetail,
  normalizeMealOptions,
  normalizeCustomQuestions,
  normalizeMealSelections,
  normalizeCustomAnswers,
  normalizePlusOneNames,
} from './schemas';

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

function createEmptyDietaryBreakdown(): RsvpDietaryBreakdown {
  return {
    totalWithRestrictions: 0,
    glutenFree: 0,
    vegetarian: 0,
    vegan: 0,
    dairyFree: 0,
    nutFree: 0,
    halal: 0,
    kosher: 0,
    other: 0,
    kids: 0,
  };
}

function evaluateDietaryEntry(
  notes: string | null | undefined,
  rawTags: string[],
  partyTags?: string[]
): {
  hasRestriction: boolean;
  glutenFree: boolean;
  vegetarian: boolean;
  vegan: boolean;
  dairyFree: boolean;
  nutFree: boolean;
  halal: boolean;
  kosher: boolean;
  other: boolean;
  hasKidsSignal: boolean;
} {
  const trimmedNotes = typeof notes === 'string' ? notes.trim() : '';
  const lower = trimmedNotes.toLowerCase();
  const normalizedTags = Array.from(
    new Set(rawTags.map((t) => t.trim().toLowerCase()).filter(Boolean))
  );
  const normalizedPartyTags = Array.from(
    new Set((partyTags || []).map((t) => t.trim().toLowerCase()).filter(Boolean))
  );

  const hasKidsSignal =
    normalizedTags.includes('kids') ||
    normalizedPartyTags.includes('kids') ||
    /\b(kid|kids|child|children)\b/i.test(lower);

  const restrictionTags = normalizedTags.filter((tag) => tag !== 'kids');
  const notesWithoutKidsOnly = lower
    .replace(/\b(kid|kids|child|children)(\s+(meal|meals|menu|option|options))?\b/gi, '')
    .replace(/[,;|]+/g, ' ')
    .trim();
  const hasRestrictionNotes = Boolean(notesWithoutKidsOnly);

  const glutenFree =
    restrictionTags.includes('gluten-free') ||
    restrictionTags.includes('gf') ||
    (hasRestrictionNotes && /\b(gf|gluten[- ]free|gluten)\b/i.test(lower));
  const vegan =
    restrictionTags.includes('vegan') ||
    (hasRestrictionNotes && /\b(vegan)\b/i.test(lower));
  const vegetarian =
    !vegan &&
    (restrictionTags.includes('vegetarian') ||
      (hasRestrictionNotes && /\b(vegetarian|veg)\b/i.test(lower)));
  const dairyFree =
    restrictionTags.includes('dairy-free') ||
    restrictionTags.includes('df') ||
    (hasRestrictionNotes && /\b(df|dairy[- ]free|dairy|lactose)\b/i.test(lower));
  const nutFree =
    restrictionTags.includes('nut-free') ||
    (hasRestrictionNotes && /\b(nut[- ]free|nut|nuts|peanut|allergy|allergies)\b/i.test(lower));
  const halal =
    restrictionTags.includes('halal') ||
    (hasRestrictionNotes && /\b(halal)\b/i.test(lower));
  const kosher =
    restrictionTags.includes('kosher') ||
    (hasRestrictionNotes && /\b(kosher)\b/i.test(lower));

  const standardRestrictionTags = new Set([
    'gluten-free',
    'gf',
    'vegetarian',
    'vegan',
    'dairy-free',
    'df',
    'nut-free',
  ]);
  const tagOther = restrictionTags.some((tag) => !standardRestrictionTags.has(tag));
  const notesOther =
    hasRestrictionNotes && !glutenFree && !vegan && !vegetarian && !dairyFree && !nutFree;
  const other = tagOther || notesOther;
  const hasRestriction = hasRestrictionNotes || restrictionTags.length > 0;

  return {
    hasRestriction,
    glutenFree,
    vegetarian,
    vegan,
    dairyFree,
    nutFree,
    halal,
    kosher,
    other,
    hasKidsSignal,
  };
}

const SYNCED_RSVP_EXTRA_KEYS = [
  'attendanceStatus',
  'rsvpStatus',
  'attendance',
  'rsvp',
  'attending',
  'status',
  'plusOneCount',
  'plusOneNames',
  'dietaryTags',
  'mealSelections',
  'mealSummary',
  'customAnswers',
  'customAnswersSummary',
  'eventRsvps',
] as const;

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

    const maxPlusOnes = Math.max(0, invite.plusOneAllocations ?? 0);

    // Collect all unique identifiers from the submissions array before query execution
    const subEventIds = Array.from(new Set(submissions.map((s) => s.subEventId)));

    // Bulk fetch all referenced records with access relations in one query
    const subEvents = await this.client.subEvent.findMany({
      where: {
        id: { in: subEventIds },
      },
      include: {
        accesses: {
          where: {
            invitationCodeId: invite.id,
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
    for (const sub of submissions) {
      if (fallbackNodeIds.has(sub.subEventId)) {
        throw new ApiError(400, 'RSVPs cannot be submitted for read-only schedule items.');
      }

      const subEvent = subEventMap.get(sub.subEventId);

      if (!subEvent) {
        throw new ApiError(404, `Sub-event with ID ${sub.subEventId} not found.`);
      }

      // Check access permission for private sub-events
      if (subEvent.isPrivate && (!subEvent.accesses || subEvent.accesses.length === 0)) {
        throw new ApiError(403, `Forbidden: You do not have access to private event "${subEvent.title}".`);
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
                invitationCodeId: invite.id,
              },
            },
            create: {
              subEventId: item.subEventId,
              invitationCodeId: invite.id,
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
        const existingInvite =
          typeof tx.invitationCode?.findUnique === 'function'
            ? await tx.invitationCode.findUnique({
              where: { id: invite.id },
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
              where: { invitationCodeId: invite.id },
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
        for (const item of normalizedSubmissions) {
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
        } else if (normalizedSubmissions.some((s) => s.hadExplicitPlusOneNames)) {
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
                  ? invite.guestName || 'Primary Guest'
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
          where: { id: invite.id },
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

  /**
   * Aggregates global and per-sub-event RSVP headcounts, meal option counts,
   * dietary & kids totals (skipping declined rows), and custom question breakdowns.
   */
  async getRsvpSummary(): Promise<RsvpSummaryResponse> {
    const [invitations, subEvents] = await Promise.all([
      this.client.invitationCode.findMany({
        select: {
          id: true,
          guestName: true,
          used: true,
          plusOneAllocations: true,
          plusOneFirstName: true,
          plusOneLastName: true,
          dietaryNotes: true,
          partyTags: true,
          extraFields: true,
        },
      }),
      this.client.subEvent.findMany({
        orderBy: [{ startTime: 'asc' }, { createdAt: 'asc' }],
        include: {
          accesses: {
            select: { invitationCodeId: true },
          },
          rsvps: {
            select: {
              id: true,
              invitationCodeId: true,
              status: true,
              plusOneCount: true,
              plusOneNames: true,
              mealSelections: true,
              dietaryNotes: true,
              customAnswers: true,
            },
          },
        },
      }),
    ]);

    const inviteList: any[] = Array.isArray(invitations) ? invitations : [];
    const subEventList: any[] = Array.isArray(subEvents) ? subEvents : [];
    const inviteById = new Map<string, any>(inviteList.map((inv) => [inv.id, inv]));
    const allInviteIds = new Set<string>(inviteList.map((inv) => inv.id));

    const rsvpsByInviteId = new Map<string, any[]>();
    for (const se of subEventList) {
      for (const rsvp of se.rsvps || []) {
        if (!allInviteIds.has(rsvp.invitationCodeId)) continue;
        const list = rsvpsByInviteId.get(rsvp.invitationCodeId) || [];
        list.push({ ...rsvp, subEvent: se });
        rsvpsByInviteId.set(rsvp.invitationCodeId, list);
      }
    }

    let attendingHouseholds = 0;
    let declinedHouseholds = 0;
    let pendingHouseholds = 0;
    let attendingHeadcount = 0;
    let attendingPlusOnes = 0;
    let declinedHeadcount = 0;
    let pendingHeadcount = 0;

    const globalDietary = createEmptyDietaryBreakdown();

    for (const inv of inviteList) {
      const guestRsvps = rsvpsByInviteId.get(inv.id) || [];
      let status: 'attending' | 'declined' | 'pending';
      if (guestRsvps.length > 0) {
        if (guestRsvps.some((r) => r.status === 'attending')) {
          status = 'attending';
        } else if (guestRsvps.some((r) => r.status === 'pending')) {
          status = 'pending';
        } else {
          status = 'declined';
        }
      } else {
        status = getAttendanceStatus(inv);
      }

      const extra = parseExtraFieldsObject(inv.extraFields);
      const allocatedPlusOnes = Math.max(0, Number(inv.plusOneAllocations ?? 0) || 0);

      if (status === 'attending') {
        attendingHouseholds += 1;
        let guestAttendingPlusOnes = 0;
        const attendingEventRsvps = guestRsvps.filter((r) => r.status === 'attending');
        if (attendingEventRsvps.length > 0) {
          guestAttendingPlusOnes = attendingEventRsvps.reduce(
            (max, r) => Math.max(max, Math.max(0, Number(r.plusOneCount ?? 0) || 0)),
            0
          );
        } else if (typeof extra.plusOneCount === 'number' && extra.plusOneCount >= 0) {
          guestAttendingPlusOnes = Math.floor(extra.plusOneCount);
        } else if (
          (typeof inv.plusOneFirstName === 'string' && inv.plusOneFirstName.trim()) ||
          (typeof inv.plusOneLastName === 'string' && inv.plusOneLastName.trim())
        ) {
          guestAttendingPlusOnes = 1;
        }
        attendingPlusOnes += guestAttendingPlusOnes;
        attendingHeadcount += 1 + guestAttendingPlusOnes;
      } else if (status === 'declined') {
        declinedHouseholds += 1;
        declinedHeadcount += 1 + allocatedPlusOnes;
      } else {
        pendingHouseholds += 1;
        pendingHeadcount += 1 + allocatedPlusOnes;
      }

      // Skip declined invitations in global catering & dietary summary
      if (status === 'declined') {
        continue;
      }

      const collectedTags = new Set<string>(extractDietaryTags(inv));
      let kidsMealsForGuest = 0;

      for (const rsvp of guestRsvps) {
        if (rsvp.status !== 'attending') continue;
        const opts = normalizeMealOptions(rsvp.subEvent?.mealOptions);
        const optMap = new Map(opts.map((o) => [o.id, o]));
        const selectedMealIds = normalizeMealSelections(rsvp.mealSelections);
        let eventKidsSelections = 0;
        for (const optId of selectedMealIds) {
          const opt = optMap.get(optId);
          if (!opt) continue;
          for (const tag of opt.dietaryTags) {
            const normTag = tag.trim().toLowerCase();
            if (normTag) collectedTags.add(normTag);
          }
          if (opt.dietaryTags.some((t) => t.trim().toLowerCase() === 'kids')) {
            eventKidsSelections += 1;
          }
        }
        kidsMealsForGuest = Math.max(kidsMealsForGuest, eventKidsSelections);
      }

      if (kidsMealsForGuest === 0 && Array.isArray(extra.mealSelections)) {
        for (const entry of extra.mealSelections) {
          if (!entry || typeof entry !== 'object') continue;
          const selections = Array.isArray((entry as Record<string, unknown>).selections)
            ? ((entry as Record<string, unknown>).selections as Array<Record<string, unknown>>)
            : [];
          let eventKids = 0;
          for (const sel of selections) {
            const tags = Array.isArray(sel?.dietaryTags) ? sel.dietaryTags : [];
            if (tags.some((t) => typeof t === 'string' && t.trim().toLowerCase() === 'kids')) {
              eventKids += 1;
            }
          }
          kidsMealsForGuest = Math.max(kidsMealsForGuest, eventKids);
        }
      }

      const combinedNotesParts: string[] = [];
      if (typeof inv.dietaryNotes === 'string' && inv.dietaryNotes.trim()) {
        combinedNotesParts.push(inv.dietaryNotes.trim());
      }
      for (const rsvp of guestRsvps) {
        if (rsvp.status === 'declined') continue;
        if (typeof rsvp.dietaryNotes === 'string' && rsvp.dietaryNotes.trim()) {
          combinedNotesParts.push(rsvp.dietaryNotes.trim());
        }
      }

      const evalResult = evaluateDietaryEntry(
        combinedNotesParts.join('; '),
        Array.from(collectedTags),
        Array.isArray(inv.partyTags) ? inv.partyTags : []
      );

      if (evalResult.hasRestriction) globalDietary.totalWithRestrictions += 1;
      if (evalResult.glutenFree) globalDietary.glutenFree += 1;
      if (evalResult.vegetarian) globalDietary.vegetarian += 1;
      if (evalResult.vegan) globalDietary.vegan += 1;
      if (evalResult.dairyFree) globalDietary.dairyFree += 1;
      if (evalResult.nutFree) globalDietary.nutFree += 1;
      if (evalResult.halal) globalDietary.halal += 1;
      if (evalResult.kosher) globalDietary.kosher += 1;
      if (evalResult.other) globalDietary.other += 1;

      if (kidsMealsForGuest > 0) {
        globalDietary.kids += kidsMealsForGuest;
      } else if (evalResult.hasKidsSignal) {
        globalDietary.kids += 1;
      }
    }

    const globalMealTotals: GlobalRsvpMealTotal[] = [];
    const globalQuestionBreakdowns: RsvpQuestionBreakdown[] = [];
    const subEventSummaries: SubEventRsvpSummaryItem[] = [];

    for (const se of subEventList) {
      const mealOpts = normalizeMealOptions(se.mealOptions);
      const customQuestions = normalizeCustomQuestions(se.customQuestions);
      const rsvps: any[] = (se.rsvps || []).filter((r: any) => allInviteIds.has(r.invitationCodeId));

      const invitedIds = new Set<string>();
      if (se.isPrivate) {
        for (const acc of se.accesses || []) {
          if (allInviteIds.has(acc.invitationCodeId)) {
            invitedIds.add(acc.invitationCodeId);
          }
        }
        for (const rsvp of rsvps) {
          invitedIds.add(rsvp.invitationCodeId);
        }
      } else {
        for (const id of allInviteIds) {
          invitedIds.add(id);
        }
      }

      let seAttendingCount = 0;
      let seAttendingPlusOnes = 0;
      let seDeclinedCount = 0;
      let seKidsCount = 0;
      const seDietary = createEmptyDietaryBreakdown();

      const mealCountMap = new Map<string, RsvpMealOptionCount>();
      for (const opt of mealOpts) {
        mealCountMap.set(opt.id, {
          optionId: opt.id,
          label: opt.label,
          dietaryTags: opt.dietaryTags,
          count: 0,
        });
      }

      const questionBreakdownMap = new Map<string, RsvpQuestionBreakdown>();
      for (const q of customQuestions) {
        questionBreakdownMap.set(q.id, {
          subEventId: se.id,
          subEventTitle: se.title,
          questionId: q.id,
          prompt: q.prompt,
          type: q.type,
          totalResponses: 0,
          optionCounts: q.type === 'choice' ? q.options.map((opt) => ({ option: opt, count: 0 })) : [],
          textResponses: [],
        });
      }

      for (const rsvp of rsvps) {
        const guest = inviteById.get(rsvp.invitationCodeId);
        if (rsvp.status === 'attending') {
          seAttendingCount += 1;
          const plusOnes = Math.max(0, Number(rsvp.plusOneCount ?? 0) || 0);
          seAttendingPlusOnes += plusOnes;

          const selectedMeals = normalizeMealSelections(rsvp.mealSelections);
          const rsvpTags: string[] = [];
          let rsvpKidsMeals = 0;

          for (const optId of selectedMeals) {
            if (!optId) continue;
            let entry = mealCountMap.get(optId);
            if (!entry) {
              entry = {
                optionId: optId,
                label: optId,
                dietaryTags: [],
                count: 0,
              };
              mealCountMap.set(optId, entry);
            }
            entry.count += 1;
            for (const tag of entry.dietaryTags) {
              rsvpTags.push(tag);
            }
            if (entry.dietaryTags.some((t) => t.trim().toLowerCase() === 'kids')) {
              rsvpKidsMeals += 1;
            }
          }

          const combinedNotes = [rsvp.dietaryNotes, guest?.dietaryNotes]
            .filter((v): v is string => typeof v === 'string' && Boolean(v.trim()))
            .join('; ');
          const evalDietary = evaluateDietaryEntry(
            combinedNotes,
            rsvpTags,
            Array.isArray(guest?.partyTags) ? guest.partyTags : []
          );

          if (evalDietary.hasRestriction) seDietary.totalWithRestrictions += 1;
          if (evalDietary.glutenFree) seDietary.glutenFree += 1;
          if (evalDietary.vegetarian) seDietary.vegetarian += 1;
          if (evalDietary.vegan) seDietary.vegan += 1;
          if (evalDietary.dairyFree) seDietary.dairyFree += 1;
          if (evalDietary.nutFree) seDietary.nutFree += 1;
          if (evalDietary.halal) seDietary.halal += 1;
          if (evalDietary.kosher) seDietary.kosher += 1;
          if (evalDietary.other) seDietary.other += 1;

          if (rsvpKidsMeals > 0) {
            seDietary.kids += rsvpKidsMeals;
            seKidsCount += rsvpKidsMeals;
          } else if (evalDietary.hasKidsSignal) {
            seDietary.kids += 1;
            seKidsCount += 1;
          }
        } else if (rsvp.status === 'declined') {
          seDeclinedCount += 1;
        }

        if (rsvp.status !== 'declined') {
          const answers = normalizeCustomAnswers(rsvp.customAnswers);
          for (const [qId, ans] of Object.entries(answers)) {
            if (!ans) continue;
            let qEntry = questionBreakdownMap.get(qId);
            if (!qEntry) {
              qEntry = {
                subEventId: se.id,
                subEventTitle: se.title,
                questionId: qId,
                prompt: qId,
                type: 'text',
                totalResponses: 0,
                optionCounts: [],
                textResponses: [],
              };
              questionBreakdownMap.set(qId, qEntry);
            }
            qEntry.totalResponses += 1;
            if (qEntry.type === 'choice') {
              const choiceObj = qEntry.optionCounts.find((c) => c.option === ans);
              if (choiceObj) {
                choiceObj.count += 1;
              } else {
                qEntry.optionCounts.push({ option: ans, count: 1 });
              }
            } else if (qEntry.textResponses.length < 50) {
              qEntry.textResponses.push({
                invitationCodeId: rsvp.invitationCodeId,
                guestName: guest?.guestName || 'Guest',
                answer: ans,
              });
            }
          }
        }
      }

      const invitedCount = invitedIds.size;
      const sePendingCount = Math.max(0, invitedCount - seAttendingCount - seDeclinedCount);
      const seAttendingHeadcount = seAttendingCount + seAttendingPlusOnes;
      const mealCounts = Array.from(mealCountMap.values());
      const questionBreakdowns = Array.from(questionBreakdownMap.values());

      for (const mc of mealCounts) {
        if (mc.count > 0) {
          globalMealTotals.push({
            ...mc,
            subEventId: se.id,
            subEventTitle: se.title,
          });
        }
      }

      for (const qb of questionBreakdowns) {
        if (qb.totalResponses > 0) {
          globalQuestionBreakdowns.push(qb);
        }
      }

      subEventSummaries.push({
        subEventId: se.id,
        title: se.title,
        isPrivate: Boolean(se.isPrivate),
        invitedCount,
        attendingCount: seAttendingCount,
        attendingPlusOnes: seAttendingPlusOnes,
        attendingHeadcount: seAttendingHeadcount,
        declinedCount: seDeclinedCount,
        pendingCount: sePendingCount,
        kidsCount: seKidsCount,
        mealCounts,
        dietaryCounts: seDietary,
        questionBreakdowns,
      });
    }

    // Fallback: if invitations have synced extraFields.mealSelections without SubEventRsvp rows
    if (globalMealTotals.length === 0) {
      const fallbackMeals = new Map<string, GlobalRsvpMealTotal>();
      for (const inv of inviteList) {
        const guestRsvps = rsvpsByInviteId.get(inv.id) || [];
        if (guestRsvps.length > 0) continue;
        if (getAttendanceStatus(inv) === 'declined') continue;
        const extra = parseExtraFieldsObject(inv.extraFields);
        if (!Array.isArray(extra.mealSelections)) continue;
        for (const entry of extra.mealSelections) {
          if (!entry || typeof entry !== 'object') continue;
          const eObj = entry as Record<string, unknown>;
          const subEventId = typeof eObj.subEventId === 'string' ? eObj.subEventId : 'general';
          const subEventTitle =
            typeof eObj.subEventTitle === 'string' ? eObj.subEventTitle : 'Reception';
          const selections = Array.isArray(eObj.selections) ? eObj.selections : [];
          for (const sel of selections) {
            if (!sel || typeof sel !== 'object') continue;
            const sObj = sel as Record<string, unknown>;
            const optionId = typeof sObj.optionId === 'string' ? sObj.optionId : '';
            const label = typeof sObj.label === 'string' ? sObj.label : optionId;
            if (!label) continue;
            const tags = Array.isArray(sObj.dietaryTags)
              ? sObj.dietaryTags.filter((t): t is string => typeof t === 'string')
              : [];
            const key = `${subEventId}::${optionId || label}`;
            const existing = fallbackMeals.get(key);
            if (existing) {
              existing.count += 1;
            } else {
              fallbackMeals.set(key, {
                subEventId,
                subEventTitle,
                optionId: optionId || label,
                label,
                dietaryTags: tags,
                count: 1,
              });
            }
          }
        }
      }
      globalMealTotals.push(...fallbackMeals.values());
    }

    return {
      global: {
        totalInvitations: inviteList.length,
        attendingHouseholds,
        declinedHouseholds,
        pendingHouseholds,
        attendingHeadcount,
        attendingPlusOnes,
        declinedHeadcount,
        pendingHeadcount,
        dietary: globalDietary,
        mealTotals: globalMealTotals,
        questionBreakdowns: globalQuestionBreakdowns,
      },
      subEvents: subEventSummaries,
    };
  }

  /**
   * Fetches a single guest's InvitationCode metadata, all SubEvents (with meal options & custom questions),
   * and current SubEventRsvp rows for admin inspection/editing.
   */
  async getAdminInvitationRsvps(invitationCodeId: string): Promise<AdminInvitationRsvpsDetail> {
    const invite = await this.client.invitationCode.findUnique({
      where: { id: invitationCodeId },
    });
    if (!invite) {
      throw new ApiError(404, 'Invitation code not found.');
    }

    const [subEvents, rsvps] = await Promise.all([
      this.client.subEvent.findMany({
        orderBy: [{ startTime: 'asc' }, { createdAt: 'asc' }],
        include: {
          accesses: {
            where: { invitationCodeId },
            select: { id: true },
          },
        },
      }),
      this.client.subEventRsvp.findMany({
        where: { invitationCodeId },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return {
      invitationCode: {
        id: invite.id,
        code: invite.code,
        guestName: invite.guestName,
        used: Boolean(invite.used),
        plusOneAllocations: invite.plusOneAllocations ?? 0,
        plusOneFirstName: invite.plusOneFirstName ?? null,
        plusOneLastName: invite.plusOneLastName ?? null,
        dietaryNotes: invite.dietaryNotes ?? null,
        extraFields: parseExtraFieldsObject(invite.extraFields),
      },
      subEvents: (subEvents || []).map((se: any) => ({
        id: se.id,
        title: se.title,
        isPrivate: Boolean(se.isPrivate),
        hasAccess: !se.isPrivate || Boolean(se.accesses && se.accesses.length > 0),
        mealOptions: normalizeMealOptions(se.mealOptions),
        customQuestions: normalizeCustomQuestions(se.customQuestions),
      })),
      rsvps: (rsvps || []).map((r: any) => ({
        id: r.id,
        subEventId: r.subEventId,
        status: r.status,
        plusOneCount: r.plusOneCount ?? 0,
        plusOneNames: normalizePlusOneNames(r.plusOneNames),
        mealSelections: normalizeMealSelections(r.mealSelections),
        dietaryNotes: r.dietaryNotes ?? null,
        customAnswers: normalizeCustomAnswers(r.customAnswers),
      })),
    };
  }

  /**
   * Recomputes and updates InvitationCode fields + extraFields from remaining SubEventRsvp rows
   * inside an active Prisma transaction, and writes a SnapshotVersion audit record.
   */
  private async syncInvitationCodeFromDbRsvps(
    tx: any,
    invite: any,
    options: {
      clearedAll?: boolean;
      overallAttendanceStatus?: 'attending' | 'declined' | 'pending';
      directPlusOneCount?: number;
      directPlusOneNames?: string[];
      author: string;
      skipIndividualAudit?: boolean;
    }
  ) {
    const now = new Date();
    const dbRsvps = await tx.subEventRsvp.findMany({
      where: { invitationCodeId: invite.id },
      include: { subEvent: true },
      orderBy: { createdAt: 'asc' },
    });

    const existingExtra = parseExtraFieldsObject(invite.extraFields);

    if (!Array.isArray(dbRsvps) || dbRsvps.length === 0) {
      const cleanedExtra: Record<string, unknown> = { ...existingExtra };
      for (const key of SYNCED_RSVP_EXTRA_KEYS) {
        delete cleanedExtra[key];
      }

      if (options.clearedAll || !options.overallAttendanceStatus) {
        const updated = await tx.invitationCode.update({
          where: { id: invite.id },
          data: {
            used: false,
            usedAt: null,
            plusOneFirstName: null,
            plusOneLastName: null,
            extraFields: cleanedExtra,
          },
        });
        if (!options.skipIndividualAudit) {
          await createAuditSnapshot('InvitationCode', updated.id, updated, options.author, tx);
        }
        return updated;
      }

      const directStatus = options.overallAttendanceStatus;
      const directPlusOnes =
        directStatus === 'attending' ? Math.max(0, options.directPlusOneCount ?? 0) : 0;
      const directNames =
        directPlusOnes > 0
          ? normalizePlusOneNames(options.directPlusOneNames).slice(0, directPlusOnes)
          : [];
      let nextFirst = invite.plusOneFirstName ?? null;
      let nextLast = invite.plusOneLastName ?? null;
      if (directStatus !== 'attending' || directPlusOnes === 0) {
        nextFirst = null;
        nextLast = null;
      } else if (directNames.length > 0) {
        const split = splitFullName(directNames[0]);
        nextFirst = split.firstName;
        nextLast = split.lastName;
      }

      const isResponded = directStatus === 'attending' || directStatus === 'declined';
      const updated = await tx.invitationCode.update({
        where: { id: invite.id },
        data: {
          used: isResponded,
          usedAt: isResponded ? (invite.usedAt ?? now) : null,
          plusOneAllocations: Math.max(invite.plusOneAllocations ?? 0, directPlusOnes),
          plusOneFirstName: nextFirst,
          plusOneLastName: nextLast,
          extraFields: {
            ...cleanedExtra,
            attendanceStatus: directStatus,
            plusOneCount: directPlusOnes,
            plusOneNames: directNames,
          },
        },
      });
      if (!options.skipIndividualAudit) {
        await createAuditSnapshot('InvitationCode', updated.id, updated, options.author, tx);
      }
      return updated;
    }

    const hasAttending = dbRsvps.some((r: any) => r.status === 'attending');
    const hasPending = dbRsvps.some((r: any) => r.status === 'pending');
    const attendanceStatus: 'attending' | 'declined' | 'pending' = hasAttending
      ? 'attending'
      : hasPending
        ? 'pending'
        : 'declined';
    const hasResponded = attendanceStatus === 'attending' || attendanceStatus === 'declined';

    const maxAttendingPlusOnes = dbRsvps.reduce(
      (max: number, r: any) =>
        r.status === 'attending' ? Math.max(max, Math.max(0, r.plusOneCount ?? 0)) : max,
      0
    );

    const collectedPlusOneNames: string[] = [];
    for (const r of dbRsvps) {
      if (r.status !== 'attending' || (r.plusOneCount ?? 0) <= 0) continue;
      const names = normalizePlusOneNames(r.plusOneNames).slice(0, r.plusOneCount);
      for (const name of names) {
        if (name && !collectedPlusOneNames.includes(name)) {
          collectedPlusOneNames.push(name);
        }
      }
    }

    let nextFirstName: string | null = invite.plusOneFirstName ?? null;
    let nextLastName: string | null = invite.plusOneLastName ?? null;
    let syncedPlusOneNames: string[] = collectedPlusOneNames;

    if (maxAttendingPlusOnes === 0) {
      nextFirstName = null;
      nextLastName = null;
      syncedPlusOneNames = [];
    } else if (collectedPlusOneNames.length > 0) {
      const split = splitFullName(collectedPlusOneNames[0]);
      nextFirstName = split.firstName;
      nextLastName = split.lastName;
    } else {
      const fallbackExisting = [nextFirstName, nextLastName].filter(Boolean).join(' ').trim();
      if (fallbackExisting) {
        syncedPlusOneNames = [fallbackExisting];
      }
    }

    const activeNotesList: string[] = [];
    const seenNotesLower = new Set<string>();
    for (const r of dbRsvps) {
      if (r.status === 'declined') continue;
      const note = typeof r.dietaryNotes === 'string' ? r.dietaryNotes.trim() : '';
      if (note && !seenNotesLower.has(note.toLowerCase())) {
        seenNotesLower.add(note.toLowerCase());
        activeNotesList.push(note);
      }
    }
    const nextDietaryNotes =
      activeNotesList.length > 0 ? activeNotesList.join('; ') : (invite.dietaryNotes ?? null);

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
    const eventRsvps: Array<{
      subEventId: string;
      subEventTitle: string;
      status: 'attending' | 'declined' | 'pending';
      plusOneCount: number;
    }> = [];

    for (const r of dbRsvps) {
      const evtTitle = r.subEvent?.title || 'Event';
      eventRsvps.push({
        subEventId: r.subEventId,
        subEventTitle: evtTitle,
        status: r.status,
        plusOneCount: r.plusOneCount ?? 0,
      });

      if (r.status !== 'attending') continue;

      const evtMealOpts = normalizeMealOptions(r.subEvent?.mealOptions);
      const evtQuestions = normalizeCustomQuestions(r.subEvent?.customQuestions);
      const rMeals = normalizeMealSelections(r.mealSelections);
      const rNames = normalizePlusOneNames(r.plusOneNames);
      const rAnswers = normalizeCustomAnswers(r.customAnswers);

      if (rMeals.some(Boolean)) {
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
              ? invite.guestName || 'Primary Guest'
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

      if (Object.keys(rAnswers).length > 0) {
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

    const cleanedExtra: Record<string, unknown> = { ...existingExtra };
    for (const key of SYNCED_RSVP_EXTRA_KEYS) {
      delete cleanedExtra[key];
    }

    const updated = await tx.invitationCode.update({
      where: { id: invite.id },
      data: {
        used: hasResponded,
        usedAt: hasResponded ? (invite.usedAt ?? now) : null,
        plusOneAllocations: Math.max(invite.plusOneAllocations ?? 0, maxAttendingPlusOnes),
        plusOneFirstName: nextFirstName,
        plusOneLastName: nextLastName,
        dietaryNotes: nextDietaryNotes,
        extraFields: {
          ...cleanedExtra,
          attendanceStatus,
          plusOneCount: maxAttendingPlusOnes,
          plusOneNames: syncedPlusOneNames,
          dietaryTags: Array.from(dietaryTagSet),
          mealSelections: structuredMeals,
          mealSummary,
          customAnswers: structuredAnswers,
          customAnswersSummary,
          eventRsvps,
        },
      },
    });

    if (!options.skipIndividualAudit) {
      await createAuditSnapshot('InvitationCode', updated.id, updated, options.author, tx);
    }

    return updated;
  }

  /**
   * Admin override to upsert or clear per-event RSVPs for a single guest without
   * guest cookies or public RSVP deadline restrictions. Syncs InvitationCode and SnapshotVersion.
   */
  async adminUpdateInvitationRsvps(
    input: AdminSingleGuestRsvpOverrideDTO,
    author: string = 'Admin'
  ) {
    const invite = await this.client.invitationCode.findUnique({
      where: { id: input.invitationCodeId },
    });
    if (!invite) {
      throw new ApiError(404, 'Invitation code not found.');
    }

    const subEvents = await this.client.subEvent.findMany({
      orderBy: [{ startTime: 'asc' }, { createdAt: 'asc' }],
      include: {
        accesses: {
          where: { invitationCodeId: invite.id },
          select: { id: true },
        },
      },
    });
    const subEventMap = new Map<string, any>((subEvents || []).map((se: any) => [se.id, se]));

    const items = input.rsvps ?? [];
    for (const item of items) {
      const se = subEventMap.get(item.subEventId);
      if (!se) {
        throw new ApiError(404, `Sub-event with ID ${item.subEventId} not found.`);
      }
      if (item.status !== 'clear' && item.status !== 'declined') {
        const mealOpts = normalizeMealOptions(se.mealOptions);
        const validMealIds = new Set(mealOpts.map((m) => m.id));
        const rawMeals = normalizeMealSelections(item.mealSelections);
        for (const selectedId of rawMeals) {
          if (selectedId && !validMealIds.has(selectedId)) {
            throw new ApiError(
              400,
              `Invalid meal option "${selectedId}" for event "${se.title}".`
            );
          }
        }

        const questions = normalizeCustomQuestions(se.customQuestions);
        const questionMap = new Map(questions.map((q) => [q.id, q]));
        if (item.customAnswers && typeof item.customAnswers === 'object') {
          for (const [qId, val] of Object.entries(item.customAnswers)) {
            const q = questionMap.get(qId);
            if (!q) {
              throw new ApiError(
                400,
                `Invalid custom question "${qId}" for event "${se.title}".`
              );
            }
            const trimmed = typeof val === 'string' ? val.trim() : '';
            if (trimmed && q.type === 'choice' && !q.options.includes(trimmed)) {
              throw new ApiError(
                400,
                `Invalid choice "${trimmed}" for question "${q.prompt}" in "${se.title}".`
              );
            }
          }
        }
      }
    }

    return this.client.$transaction(async (tx: any) => {
      if (input.clearAll) {
        await tx.subEventRsvp.deleteMany({
          where: { invitationCodeId: invite.id },
        });
      } else if (items.length > 0) {
        for (const item of items) {
          if (item.status === 'clear') {
            await tx.subEventRsvp.deleteMany({
              where: {
                invitationCodeId: invite.id,
                subEventId: item.subEventId,
              },
            });
            continue;
          }

          const se = subEventMap.get(item.subEventId);
          if (se?.isPrivate && (!se.accesses || se.accesses.length === 0) && item.status !== 'pending') {
            await tx.subEventAccess.upsert({
              where: {
                subEventId_invitationCodeId: {
                  subEventId: se.id,
                  invitationCodeId: invite.id,
                },
              },
              create: {
                subEventId: se.id,
                invitationCodeId: invite.id,
              },
              update: {},
            });
          }

          const effectivePlusOnes =
            item.status === 'attending' ? Math.max(0, item.plusOneCount ?? 0) : 0;
          const plusOneNames =
            effectivePlusOnes > 0
              ? normalizePlusOneNames(item.plusOneNames).slice(0, effectivePlusOnes)
              : [];
          const mealSelections =
            item.status === 'attending'
              ? normalizeMealSelections(item.mealSelections).slice(0, 1 + effectivePlusOnes)
              : [];
          const customAnswers =
            item.status !== 'declined' ? normalizeCustomAnswers(item.customAnswers) : {};
          const dietaryNotes =
            item.dietaryNotes !== undefined && item.dietaryNotes !== null
              ? item.dietaryNotes.trim()
              : '';

          await tx.subEventRsvp.upsert({
            where: {
              subEventId_invitationCodeId: {
                subEventId: item.subEventId,
                invitationCodeId: invite.id,
              },
            },
            create: {
              subEventId: item.subEventId,
              invitationCodeId: invite.id,
              status: item.status,
              plusOneCount: effectivePlusOnes,
              plusOneNames,
              mealSelections,
              customAnswers,
              dietaryNotes,
            },
            update: {
              status: item.status,
              plusOneCount: effectivePlusOnes,
              plusOneNames,
              mealSelections,
              customAnswers,
              dietaryNotes,
            },
          });
        }
      } else if (input.overallAttendanceStatus && subEventMap.size > 0) {
        // Apply overall status across accessible sub-events when no per-event items were specified
        const accessibleEvents = (subEvents || []).filter(
          (se: any) => !se.isPrivate || Boolean(se.accesses && se.accesses.length > 0)
        );
        const plusOnes =
          input.overallAttendanceStatus === 'attending'
            ? Math.max(0, input.plusOneCount ?? 0)
            : 0;
        const plusOneNames =
          plusOnes > 0 ? normalizePlusOneNames(input.plusOneNames).slice(0, plusOnes) : [];

        for (const se of accessibleEvents) {
          await tx.subEventRsvp.upsert({
            where: {
              subEventId_invitationCodeId: {
                subEventId: se.id,
                invitationCodeId: invite.id,
              },
            },
            create: {
              subEventId: se.id,
              invitationCodeId: invite.id,
              status: input.overallAttendanceStatus,
              plusOneCount: plusOnes,
              plusOneNames,
              mealSelections: [],
              customAnswers: {},
              dietaryNotes: '',
            },
            update: {
              status: input.overallAttendanceStatus,
              plusOneCount: plusOnes,
              plusOneNames,
              ...(input.overallAttendanceStatus === 'declined'
                ? { mealSelections: [], customAnswers: {} }
                : {}),
            },
          });
        }
      }

      const updatedInvite = await this.syncInvitationCodeFromDbRsvps(tx, invite, {
        clearedAll: Boolean(input.clearAll),
        overallAttendanceStatus: input.overallAttendanceStatus,
        directPlusOneCount: input.plusOneCount,
        directPlusOneNames: input.plusOneNames,
        author,
      });

      const currentRsvps = await tx.subEventRsvp.findMany({
        where: { invitationCodeId: invite.id },
        orderBy: { createdAt: 'asc' },
      });

      return {
        invitationCode: updatedInvite,
        rsvps: currentRsvps,
      };
    });
  }

  /**
   * Batch admin override to mark selected invitations attending, declined, pending, or cleared
   * across accessible (or specified) sub-events, syncing InvitationCode and SnapshotVersion rows.
   */
  async adminBatchUpdateAttendance(
    input: AdminBatchAttendanceOverrideDTO,
    author: string = 'Admin'
  ) {
    const uniqueIds = Array.from(new Set(input.invitationCodeIds));
    const invites = await this.client.invitationCode.findMany({
      where: { id: { in: uniqueIds } },
    });
    if (!Array.isArray(invites) || invites.length === 0) {
      throw new ApiError(404, 'No matching invitation codes found.');
    }

    const subEvents = await this.client.subEvent.findMany({
      orderBy: [{ startTime: 'asc' }, { createdAt: 'asc' }],
      include: {
        accesses: {
          where: { invitationCodeId: { in: uniqueIds } },
          select: { invitationCodeId: true },
        },
      },
    });

    const requestedEventIds = input.subEventIds ? new Set(input.subEventIds) : null;
    if (requestedEventIds) {
      const existingEventIds = new Set((subEvents || []).map((se: any) => se.id));
      for (const reqId of requestedEventIds) {
        if (!existingEventIds.has(reqId)) {
          throw new ApiError(404, `Sub-event with ID ${reqId} not found.`);
        }
      }
    }

    return this.client.$transaction(async (tx: any) => {
      const updatedRecords: any[] = [];

      for (const invite of invites) {
        if (input.status === 'clear' && !requestedEventIds) {
          await tx.subEventRsvp.deleteMany({
            where: { invitationCodeId: invite.id },
          });
          const updated = await this.syncInvitationCodeFromDbRsvps(tx, invite, {
            clearedAll: true,
            author,
            skipIndividualAudit: true,
          });
          updatedRecords.push(updated);
          continue;
        }

        const targetEvents = (subEvents || []).filter((se: any) => {
          if (requestedEventIds) {
            return requestedEventIds.has(se.id);
          }
          if (!se.isPrivate) return true;
          return (se.accesses || []).some((a: any) => a.invitationCodeId === invite.id);
        });

        if (input.status === 'clear') {
          if (targetEvents.length > 0) {
            await tx.subEventRsvp.deleteMany({
              where: {
                invitationCodeId: invite.id,
                subEventId: { in: targetEvents.map((e: any) => e.id) },
              },
            });
          }
        } else {
          for (const se of targetEvents) {
            if (
              se.isPrivate &&
              !(se.accesses || []).some((a: any) => a.invitationCodeId === invite.id) &&
              input.status !== 'pending'
            ) {
              await tx.subEventAccess.upsert({
                where: {
                  subEventId_invitationCodeId: {
                    subEventId: se.id,
                    invitationCodeId: invite.id,
                  },
                },
                create: {
                  subEventId: se.id,
                  invitationCodeId: invite.id,
                },
                update: {},
              });
            }

            await tx.subEventRsvp.upsert({
              where: {
                subEventId_invitationCodeId: {
                  subEventId: se.id,
                  invitationCodeId: invite.id,
                },
              },
              create: {
                subEventId: se.id,
                invitationCodeId: invite.id,
                status: input.status,
                plusOneCount: 0,
                plusOneNames: [],
                mealSelections: [],
                customAnswers: {},
                dietaryNotes: '',
              },
              update: {
                status: input.status,
                ...(input.status === 'declined'
                  ? { plusOneCount: 0, plusOneNames: [], mealSelections: [], customAnswers: {} }
                  : {}),
              },
            });
          }
        }

        const updated = await this.syncInvitationCodeFromDbRsvps(tx, invite, {
          clearedAll: false,
          overallAttendanceStatus: input.status === 'clear' ? undefined : input.status,
          author,
          skipIndividualAudit: true,
        });
        updatedRecords.push(updated);
      }

      await createBatchAuditSnapshots('InvitationCode', updatedRecords, author, tx);

      return {
        updatedCount: updatedRecords.length,
        records: updatedRecords,
      };
    });
  }
}

export const subEventService = new SubEventService();
