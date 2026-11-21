import { BaseService } from '@/core/infrastructure/service';
import { BaseRepository } from '@/core/infrastructure/repository';
import { isEndTimeBeforeStartTime } from '@/utils/dateTime';
import {
  SubEventDTO,
  MealOptionsListSchema,
  CustomRsvpQuestionsListSchema,
  normalizeMealOptions,
  normalizeCustomQuestions,
} from './schemas';

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
      let validationInput: Record<string, unknown> = data;
      if (
        (data.startTime === undefined && data.endTime !== undefined) ||
        (data.startTime !== undefined && data.endTime === undefined)
      ) {
        const existing = await txRepo.findUnique(id);
        if (existing) {
          validationInput = {
            ...data,
            startTime: data.startTime !== undefined ? data.startTime : existing.startTime,
            endTime: data.endTime !== undefined ? data.endTime : existing.endTime,
          };
        }
      }
      this.validateFields(validationInput, true);
      const processedData = await this.preSave(data);
      const record = await txRepo.update(id, processedData);
      await this.createSnapshot(record.id, record, author, txRepo.client);
      return record;
    });
  }
}
