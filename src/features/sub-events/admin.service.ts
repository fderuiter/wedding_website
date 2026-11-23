import { BaseService } from '@/core/infrastructure/service';
import { BaseRepository } from '@/core/infrastructure/repository';
import { isEndTimeBeforeStartTime } from '@/utils/dateTime';
import {
  SubEventDTO,
  CustomRsvpQuestionDTO,
  MealOptionsListSchema,
  CustomRsvpQuestionsListSchema,
  normalizeMealOptions,
  normalizeCustomQuestions,
  normalizeCustomAnswers,
} from './schemas';
import { SubEventService } from './service';

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

      const record = await txRepo.update(id, processedData);
      await this.createSnapshot(record.id, record, author, txRepo.client);

      const shouldSyncProjections =
        data.title !== undefined ||
        data.mealOptions !== undefined ||
        data.customQuestions !== undefined ||
        choiceRenameMap.size > 0;

      if (shouldSyncProjections && typeof txRepo.client?.subEventRsvp?.findMany === 'function') {
        const eventRsvps = await txRepo.client.subEventRsvp.findMany({
          where: { subEventId: id },
        });

        if (Array.isArray(eventRsvps) && eventRsvps.length > 0) {
          if (choiceRenameMap.size > 0 && typeof txRepo.client?.subEventRsvp?.update === 'function') {
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
                await txRepo.client.subEventRsvp.update({
                  where: { id: rsvp.id },
                  data: { customAnswers: nextAnswers },
                });
              }
            }
          }

          const affectedInviteIds = Array.from(
            new Set(
              eventRsvps
                .map((r: { invitationCodeId?: string }) => r.invitationCodeId)
                .filter((val): val is string => typeof val === 'string' && Boolean(val))
            )
          );

          if (affectedInviteIds.length > 0) {
            const syncService = new SubEventService(txRepo.client);
            await syncService.resyncInvitationCodesByIds(affectedInviteIds, author);
          }
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
