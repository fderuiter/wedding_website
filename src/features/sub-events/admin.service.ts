import { Prisma } from '@prisma/client';
import { BaseService } from '@/core/infrastructure/service';
import { BaseRepository } from '@/core/infrastructure/repository';
import { qualifyPostgresTable } from '@/lib/postgres-url.js';
import { isEndTimeBeforeStartTime } from '@/utils/dateTime';
import {
  SubEventDTO,
  MealOptionDTO,
  CustomRsvpQuestionDTO,
  MealOptionsListSchema,
  CustomRsvpQuestionsListSchema,
  normalizeMealOptions,
  normalizeCustomQuestions,
  normalizeCustomAnswers,
} from './schemas';
import { SubEventService } from './service';

interface SubEventTxClient {
  $executeRaw?: (query: Prisma.Sql) => Promise<number>;
  $queryRaw?: <T = unknown>(query: Prisma.Sql) => Promise<T>;
  subEventRsvp?: {
    findMany?: (args: Record<string, unknown>) => Promise<Array<{
      id: string;
      invitationCodeId?: string;
      customAnswers?: unknown;
    }>>;
    update?: (args: Record<string, unknown>) => Promise<unknown>;
    deleteMany?: (args: Record<string, unknown>) => Promise<{ count: number }>;
  };
}

function areMealOptionsEqual(previous: MealOptionDTO[], next: MealOptionDTO[]): boolean {
  if (previous.length !== next.length) return false;
  for (let idx = 0; idx < previous.length; idx++) {
    const prevOpt = previous[idx];
    const nextOpt = next[idx];
    if (
      prevOpt.id !== nextOpt.id ||
      prevOpt.label !== nextOpt.label ||
      (prevOpt.description ?? '') !== (nextOpt.description ?? '') ||
      prevOpt.dietaryTags.length !== nextOpt.dietaryTags.length ||
      prevOpt.dietaryTags.some((tag, tagIdx) => tag !== nextOpt.dietaryTags[tagIdx])
    ) {
      return false;
    }
  }
  return true;
}

function areCustomQuestionsEqual(
  previous: CustomRsvpQuestionDTO[],
  next: CustomRsvpQuestionDTO[]
): boolean {
  if (previous.length !== next.length) return false;
  for (let idx = 0; idx < previous.length; idx++) {
    const prevQ = previous[idx];
    const nextQ = next[idx];
    if (
      prevQ.id !== nextQ.id ||
      prevQ.prompt !== nextQ.prompt ||
      prevQ.type !== nextQ.type ||
      Boolean(prevQ.required) !== Boolean(nextQ.required) ||
      prevQ.options.length !== nextQ.options.length ||
      prevQ.options.some((opt, optIdx) => opt !== nextQ.options[optIdx])
    ) {
      return false;
    }
  }
  return true;
}

function extractChoiceRenameMap(
  rawChoiceRenames: unknown,
  previousQuestions: CustomRsvpQuestionDTO[],
  nextQuestions: CustomRsvpQuestionDTO[]
): Map<string, Map<string, string>> {
  const renameMap = new Map<string, Map<string, string>>();

  const addRename = (questionId: string, oldChoice: string, newChoice: string) => {
    const qId = questionId.trim();
    const fromVal = oldChoice.trim();
    const toVal = newChoice.trim();
    if (!qId || !fromVal || !toVal || fromVal === toVal) return;
    let qMap = renameMap.get(qId);
    if (!qMap) {
      qMap = new Map<string, string>();
      renameMap.set(qId, qMap);
    }
    qMap.set(fromVal, toVal);
  };

  if (rawChoiceRenames && typeof rawChoiceRenames === 'object' && !Array.isArray(rawChoiceRenames)) {
    for (const [qId, mapping] of Object.entries(rawChoiceRenames as Record<string, unknown>)) {
      if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) continue;
      for (const [oldOpt, newOpt] of Object.entries(mapping as Record<string, unknown>)) {
        if (typeof newOpt === 'string') {
          addRename(qId, oldOpt, newOpt);
        }
      }
    }
  }

  const prevById = new Map(previousQuestions.map((q) => [q.id, q]));
  for (const nextQ of nextQuestions) {
    if (nextQ.type !== 'choice') continue;
    const prevQ = prevById.get(nextQ.id);
    if (!prevQ || prevQ.type !== 'choice') continue;

    const existingQMap = renameMap.get(nextQ.id);
    if (prevQ.options.length === nextQ.options.length) {
      for (let idx = 0; idx < prevQ.options.length; idx++) {
        const oldOpt = prevQ.options[idx];
        const newOpt = nextQ.options[idx];
        if (
          oldOpt !== newOpt &&
          !nextQ.options.includes(oldOpt) &&
          !prevQ.options.includes(newOpt) &&
          !existingQMap?.has(oldOpt)
        ) {
          addRename(nextQ.id, oldOpt, newOpt);
        }
      }
    } else {
      const removedOpts = prevQ.options.filter(
        (opt) => !nextQ.options.includes(opt) && !existingQMap?.has(opt)
      );
      const mappedTargets = new Set(existingQMap ? Array.from(existingQMap.values()) : []);
      const addedOpts = nextQ.options.filter(
        (opt) => !prevQ.options.includes(opt) && !mappedTargets.has(opt)
      );
      if (removedOpts.length === 1 && addedOpts.length === 1) {
        addRename(nextQ.id, removedOpts[0], addedOpts[0]);
      }
    }
  }

  return renameMap;
}

export class SubEventAdminService extends BaseService<SubEventDTO> {
  static ENTITY_KEY = 'sub-events';

  constructor() {
    super(new BaseRepository<SubEventDTO>('subEvent'), 'SubEvent');
  }

  private validateFields(data: Record<string, unknown>, isPartial: boolean = false): void {
    if (!isPartial || data.title !== undefined) {
      if (!data.title || typeof data.title !== 'string' || data.title.trim() === '') {
        throw new Error('Validation Error: Title is required.');
      }
    }

    const rawStart = typeof data.startTime === 'string' ? data.startTime.trim() : data.startTime;
    const rawEnd = typeof data.endTime === 'string' ? data.endTime.trim() : data.endTime;

    const start =
      rawStart instanceof Date
        ? rawStart
        : typeof rawStart === 'string' && rawStart
          ? new Date(rawStart)
          : null;
    const end =
      rawEnd instanceof Date
        ? rawEnd
        : typeof rawEnd === 'string' && rawEnd
          ? new Date(rawEnd)
          : null;

    if (start && Number.isNaN(start.getTime())) {
      throw new Error('Validation Error: Invalid start time.');
    }
    if (end && Number.isNaN(end.getTime())) {
      throw new Error('Validation Error: Invalid end time.');
    }
    if (start && end && isEndTimeBeforeStartTime(start, end)) {
      throw new Error('Validation Error: End time cannot precede start time.');
    }

    if (data.mealOptions !== undefined) {
      const mealResult = MealOptionsListSchema.safeParse(data.mealOptions);
      if (!mealResult.success) {
        const issueMessage = mealResult.error.issues.map((i) => i.message).join(', ');
        throw new Error(`Validation Error: Invalid meal options (${issueMessage})`);
      }
    }

    if (data.customQuestions !== undefined) {
      const questionResult = CustomRsvpQuestionsListSchema.safeParse(data.customQuestions);
      if (!questionResult.success) {
        const issueMessage = questionResult.error.issues.map((i) => i.message).join(', ');
        throw new Error(`Validation Error: Invalid custom questions (${issueMessage})`);
      }
    }
  }

  protected async validate(data: Record<string, unknown>): Promise<void> {
    this.validateFields(data, false);
  }

  protected async preSave(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const finalData: Record<string, unknown> = { ...data };
    delete finalData.choiceRenames;
    if (typeof finalData.title === 'string') {
      finalData.title = finalData.title.trim();
    }
    if (finalData.startTime === '' || finalData.startTime === null) {
      finalData.startTime = null;
    } else if (finalData.startTime && typeof finalData.startTime === 'string') {
      finalData.startTime = new Date(finalData.startTime);
    }
    if (finalData.endTime === '' || finalData.endTime === null) {
      finalData.endTime = null;
    } else if (finalData.endTime && typeof finalData.endTime === 'string') {
      finalData.endTime = new Date(finalData.endTime);
    }
    if (finalData.mealOptions !== undefined) {
      finalData.mealOptions = normalizeMealOptions(finalData.mealOptions);
    }
    if (finalData.customQuestions !== undefined) {
      finalData.customQuestions = normalizeCustomQuestions(finalData.customQuestions);
    }
    return finalData;
  }

  async update(
    id: string,
    data: Partial<SubEventDTO> & Record<string, unknown>,
    author: string = 'Admin'
  ): Promise<SubEventDTO> {
    return this.repo.transaction(async (txRepo) => {
      const needsExisting =
        (data.startTime === undefined && data.endTime !== undefined) ||
        (data.startTime !== undefined && data.endTime === undefined) ||
        data.title !== undefined ||
        data.mealOptions !== undefined ||
        data.customQuestions !== undefined ||
        data.choiceRenames !== undefined;

      const existing =
        needsExisting && typeof txRepo.findUnique === 'function'
          ? await txRepo.findUnique(id)
          : null;

      let validationInput: Record<string, unknown> = data;
      if (
        existing &&
        ((data.startTime === undefined && data.endTime !== undefined) ||
          (data.startTime !== undefined && data.endTime === undefined))
      ) {
        validationInput = {
          ...data,
          startTime: data.startTime !== undefined ? data.startTime : existing.startTime,
          endTime: data.endTime !== undefined ? data.endTime : existing.endTime,
        };
      }

      this.validateFields(validationInput, true);
      const processedData = await this.preSave(data);

      const previousMealOptions = existing ? normalizeMealOptions(existing.mealOptions) : [];
      const nextMealOptions =
        processedData.mealOptions !== undefined
          ? (processedData.mealOptions as MealOptionDTO[])
          : previousMealOptions;
      const previousQuestions = existing ? normalizeCustomQuestions(existing.customQuestions) : [];
      const nextQuestions =
        processedData.customQuestions !== undefined
          ? (processedData.customQuestions as CustomRsvpQuestionDTO[])
          : previousQuestions;
      const choiceRenameMap = extractChoiceRenameMap(
        data.choiceRenames,
        previousQuestions,
        nextQuestions
      );

      const shouldSyncProjections = existing
        ? (processedData.title !== undefined && processedData.title !== existing.title) ||
          (processedData.mealOptions !== undefined &&
            !areMealOptionsEqual(previousMealOptions, nextMealOptions)) ||
          (processedData.customQuestions !== undefined &&
            !areCustomQuestionsEqual(previousQuestions, nextQuestions)) ||
          choiceRenameMap.size > 0
        : processedData.title !== undefined ||
          processedData.mealOptions !== undefined ||
          processedData.customQuestions !== undefined ||
          choiceRenameMap.size > 0;

      const record = await txRepo.update(id, processedData);
      await this.createSnapshot(record.id, record, author, txRepo.client);

      const txClient = txRepo.client as SubEventTxClient | undefined;
      const hasRawMutationSupport =
        typeof txClient?.$executeRaw === 'function' &&
        typeof txClient?.$queryRaw === 'function';

      if (
        shouldSyncProjections &&
        (hasRawMutationSupport || typeof txClient?.subEventRsvp?.findMany === 'function')
      ) {
        let affectedInviteIds: string[] = [];

        if (hasRawMutationSupport && txClient?.$queryRaw) {
          const subEventRsvpTable = Prisma.raw(qualifyPostgresTable('SubEventRsvp'));
          const renameQuestionIds: string[] = [];
          const renameOldChoices: string[] = [];
          const renameNewChoices: string[] = [];

          for (const [qId, qRenames] of choiceRenameMap.entries()) {
            for (const [oldChoice, newChoice] of qRenames.entries()) {
              renameQuestionIds.push(qId);
              renameOldChoices.push(oldChoice);
              renameNewChoices.push(newChoice);
            }
          }

          if (renameQuestionIds.length > 0) {
            const nowIso = new Date().toISOString();
            const rows = await txClient.$queryRaw<Array<{ invitationCodeId: string | null }>>(
              Prisma.sql`
                WITH rename_rules AS (
                  SELECT *
                  FROM UNNEST(
                    ${renameQuestionIds}::text[],
                    ${renameOldChoices}::text[],
                    ${renameNewChoices}::text[]
                  ) AS r("questionId", "oldChoice", "newChoice")
                ),
                event_rsvps AS (
                  SELECT "id", "invitationCodeId", "customAnswers"
                  FROM ${subEventRsvpTable}
                  WHERE "subEventId" = ${id}
                ),
                recomputed AS (
                  SELECT
                    er."id",
                    jsonb_object_agg(
                      kv.trimmed_key,
                      COALESCE(rr."newChoice", kv.trimmed_val)
                    ) AS "nextAnswers",
                    BOOL_OR(rr."newChoice" IS NOT NULL) AS "mutated"
                  FROM event_rsvps er
                  CROSS JOIN LATERAL (
                    SELECT
                      regexp_replace(e.key, '^[[:space:]]+|[[:space:]]+$', '', 'g') AS trimmed_key,
                      regexp_replace(e.value #>> '{}', '^[[:space:]]+|[[:space:]]+$', '', 'g') AS trimmed_val
                    FROM jsonb_each(
                      CASE
                        WHEN jsonb_typeof(er."customAnswers") = 'object' THEN er."customAnswers"
                        ELSE '{}'::jsonb
                      END
                    ) AS e(key, value)
                    WHERE jsonb_typeof(e.value) = 'string'
                      AND regexp_replace(e.key, '^[[:space:]]+|[[:space:]]+$', '', 'g') <> ''
                      AND regexp_replace(e.value #>> '{}', '^[[:space:]]+|[[:space:]]+$', '', 'g') <> ''
                  ) AS kv
                  LEFT JOIN rename_rules rr
                    ON rr."questionId" = kv.trimmed_key
                   AND rr."oldChoice" = kv.trimmed_val
                  GROUP BY er."id"
                ),
                applied AS (
                  UPDATE ${subEventRsvpTable} AS sr
                  SET
                    "customAnswers" = rec."nextAnswers",
                    "updatedAt" = (${nowIso}::timestamptz AT TIME ZONE 'UTC')
                  FROM recomputed rec
                  WHERE sr."id" = rec."id"
                    AND rec."mutated" = TRUE
                  RETURNING sr."id"
                )
                SELECT DISTINCT er."invitationCodeId"
                FROM event_rsvps er
                WHERE er."invitationCodeId" IS NOT NULL
                  AND er."invitationCodeId" <> ''
              `
            );
            affectedInviteIds = (Array.isArray(rows) ? rows : [])
              .map((r) => r.invitationCodeId)
              .filter((val): val is string => typeof val === 'string' && Boolean(val));
          } else {
            const rows = await txClient.$queryRaw<Array<{ invitationCodeId: string | null }>>(
              Prisma.sql`
                SELECT DISTINCT "invitationCodeId"
                FROM ${subEventRsvpTable}
                WHERE "subEventId" = ${id}
                  AND "invitationCodeId" IS NOT NULL
                  AND "invitationCodeId" <> ''
              `
            );
            affectedInviteIds = (Array.isArray(rows) ? rows : [])
              .map((r) => r.invitationCodeId)
              .filter((val): val is string => typeof val === 'string' && Boolean(val));
          }
        } else if (typeof txClient?.subEventRsvp?.findMany === 'function') {
          const eventRsvps = await txClient.subEventRsvp.findMany({
            where: { subEventId: id },
          });

          if (Array.isArray(eventRsvps) && eventRsvps.length > 0) {
            if (choiceRenameMap.size > 0 && typeof txClient.subEventRsvp.update === 'function') {
              for (const rsvp of eventRsvps) {
                const currentAnswers = normalizeCustomAnswers(rsvp.customAnswers);
                let answersMutated = false;
                const nextAnswers: Record<string, string> = { ...currentAnswers };

                for (const [qId, qRenames] of choiceRenameMap.entries()) {
                  const existingAnswer = nextAnswers[qId];
                  if (existingAnswer && qRenames.has(existingAnswer)) {
                    nextAnswers[qId] = qRenames.get(existingAnswer)!;
                    answersMutated = true;
                  }
                }

                if (answersMutated) {
                  await txClient.subEventRsvp.update({
                    where: { id: rsvp.id },
                    data: { customAnswers: nextAnswers },
                  });
                }
              }
            }

            affectedInviteIds = Array.from(
              new Set(
                eventRsvps
                  .map((r: { invitationCodeId?: string }) => r.invitationCodeId)
                  .filter((val): val is string => typeof val === 'string' && Boolean(val))
              )
            );
          }
        }

        if (affectedInviteIds.length > 0) {
          const syncService = new SubEventService(txRepo.client);
          await syncService.resyncInvitationCodesByIds(affectedInviteIds, author);
        }
      }

      return record;
    });
  }

  async delete(id: string, author: string = 'Admin'): Promise<SubEventDTO> {
    if (typeof this.repo.client?.subEventRsvp?.findMany !== 'function') {
      return super.delete(id, author);
    }

    return this.repo.transaction(async (txRepo) => {
      const existingRsvps = await txRepo.client.subEventRsvp.findMany({
        where: { subEventId: id },
        select: { invitationCodeId: true },
      });
      const affectedInviteIds = Array.from(
        new Set(
          (Array.isArray(existingRsvps) ? existingRsvps : [])
            .map((r: { invitationCodeId?: string }) => r.invitationCodeId)
            .filter((val): val is string => typeof val === 'string' && Boolean(val))
        )
      );

      if (affectedInviteIds.length > 0 && typeof txRepo.client?.subEventRsvp?.deleteMany === 'function') {
        await txRepo.client.subEventRsvp.deleteMany({
          where: { subEventId: id },
        });
      }

      const record = await txRepo.delete(id, author);

      if (affectedInviteIds.length > 0) {
        const syncService = new SubEventService(txRepo.client);
        await syncService.resyncInvitationCodesByIds(affectedInviteIds, author);
      }

      return record;
    });
  }
}
