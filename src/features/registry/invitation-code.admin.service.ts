import { BaseService } from '@/core/infrastructure/service';
import { BaseRepository } from '@/core/infrastructure/repository';
import {
  InvitationCodeDTO,
  DryRunValidatedRow,
  DryRunValidationSummary,
  DryRunValidationResponse,
  MergeInvitationCodesResult,
} from './schemas';
import { executeInTransaction } from '@/lib/transaction';
import { createAuditSnapshot } from '@/lib/audit';
import { Prisma } from '@prisma/client';
import { generateRandomCode } from './utils/invitation';
import {
  normalizeMealOptions,
  normalizeCustomQuestions,
  normalizeMealSelections,
  normalizeCustomAnswers,
  normalizePlusOneNames,
} from '@/utils/rsvpPrompts';
import {
  BatchInvitationCodeRecord,
  InvitationCollisionStrategy,
  NormalizedInvitationCodeRecord,
  computeMergedInvitationPreview,
  mergeDietaryNotes,
  normalizeBatchInvitationRecord,
  normalizeInvitationCode,
  normalizePartialInvitationFields,
  normalizePartyTags,
  resolveBatchGuestMatches,
  validateInvitationGuestFields,
  validateInvitationGuestFieldsWithColumns,
} from '@/utils/invitationValidation';

function parseExtraObject(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  return {};
}

function buildMealSummaryFromEntries(
  entries: Array<{
    subEventTitle: string;
    selections: Array<{ attendee: string; label: string; dietaryTags: string[] }>;
  }>
): string {
  return entries
    .map((entry) => {
      const inner = entry.selections
        .map((sel) =>
          sel.dietaryTags.length > 0
            ? `${sel.attendee}: ${sel.label} (${sel.dietaryTags.join(', ')})`
            : `${sel.attendee}: ${sel.label}`
        )
        .join('; ');
      return entries.length > 1 ? `${entry.subEventTitle} — ${inner}` : inner;
    })
    .join(' | ');
}

export class InvitationCodeAdminService extends BaseService<InvitationCodeDTO> {
  static ENTITY_KEY = 'invitation-codes';

  constructor() {
    super(new BaseRepository<InvitationCodeDTO>('invitationCode'), 'InvitationCode');
  }

  protected async validate(data: unknown, _client?: Prisma.TransactionClient): Promise<void> {
    const errors = validateInvitationGuestFields(data, { mode: 'service' });
    if (errors.length > 0) {
      throw new Error(errors[0]);
    }
  }

  protected async preSave(
    data: Record<string, unknown>,
    client?: Prisma.TransactionClient,
    _author?: string
  ): Promise<Record<string, unknown>> {
    const finalData = normalizePartialInvitationFields(data);
    const activeClient = client || this.repo.client;

    const normalizedCode = normalizeInvitationCode(finalData.code);
    if (!normalizedCode) {
      let uniqueCode = '';
      let attempts = 0;
      while (attempts < 10) {
        const potentialCode = generateRandomCode();
        const existing = await activeClient.invitationCode.findUnique({
          where: { code: potentialCode },
        });
        if (!existing) {
          uniqueCode = potentialCode;
          break;
        }
        attempts++;
      }
      if (!uniqueCode) {
        throw new Error('Failed to generate a unique invitation code.');
      }
      finalData.code = uniqueCode;
    } else {
      finalData.code = normalizedCode;
      const existing = await activeClient.invitationCode.findUnique({
        where: { code: finalData.code },
      });
      if (existing) {
        // Handled by Prisma unique constraint or update collision check
      }
    }

    return finalData;
  }

  async update(
    id: string,
    data: Partial<InvitationCodeDTO> & Record<string, unknown>,
    author: string = 'Admin'
  ): Promise<InvitationCodeDTO> {
    return this.repo.transaction(async (txRepo) => {
      const errors = validateInvitationGuestFields(data, { mode: 'service', partial: true });
      if (errors.length > 0) {
        throw new Error(errors[0]);
      }

      const processedData = normalizePartialInvitationFields(data);

      if (processedData.code !== undefined) {
        const normalizedCode = normalizeInvitationCode(processedData.code);
        if (!normalizedCode) {
          throw new Error('Validation Error: Code cannot be empty.');
        }
        processedData.code = normalizedCode;
        const existing = await txRepo.client.invitationCode.findUnique({
          where: { code: normalizedCode },
        });
        if (existing && existing.id !== id) {
          throw new Error(
            `Validation Error: Invitation code "${normalizedCode}" is already in use.`
          );
        }
      }

      const touchesSyncedIdentityFields =
        'guestName' in processedData ||
        'plusOneFirstName' in processedData ||
        'plusOneLastName' in processedData ||
        'plusOneAllocations' in processedData ||
        'extraFields' in processedData;

      if (touchesSyncedIdentityFields && typeof txRepo.client?.invitationCode?.findUnique === 'function') {
        const existingInvite = await txRepo.client.invitationCode.findUnique({
          where: { id },
        });
        const dbRsvps =
          typeof txRepo.client?.subEventRsvp?.findMany === 'function'
            ? await txRepo.client.subEventRsvp.findMany({
              where: { invitationCodeId: id },
              include: { subEvent: true },
              orderBy: { createdAt: 'asc' },
            })
            : [];

        const oldGuestName =
          typeof existingInvite?.guestName === 'string' ? existingInvite.guestName.trim() : '';
        const nextGuestName =
          typeof processedData.guestName === 'string' && processedData.guestName.trim()
            ? processedData.guestName.trim()
            : oldGuestName;
        const oldCompanion0 = [existingInvite?.plusOneFirstName, existingInvite?.plusOneLastName]
          .filter(Boolean)
          .join(' ')
          .trim();
        const hasExplicitPlusOneColumns =
          'plusOneFirstName' in processedData || 'plusOneLastName' in processedData;
        const nextFirst =
          'plusOneFirstName' in processedData
            ? (processedData.plusOneFirstName as string | null)
            : (existingInvite?.plusOneFirstName ?? null);
        const nextLast =
          'plusOneLastName' in processedData
            ? (processedData.plusOneLastName as string | null)
            : (existingInvite?.plusOneLastName ?? null);
        const nextCompanion0 = [nextFirst, nextLast].filter(Boolean).join(' ').trim();

        const hadStructuredDbRsvp =
          Array.isArray(dbRsvps) &&
          dbRsvps.some(
            (r) =>
              normalizePlusOneNames(r.plusOneNames).length > 0 ||
              normalizeMealSelections(r.mealSelections).some(Boolean) ||
              Object.keys(normalizeCustomAnswers(r.customAnswers)).length > 0
          );

        if (
          hasExplicitPlusOneColumns &&
          Array.isArray(dbRsvps) &&
          dbRsvps.length > 0 &&
          typeof txRepo.client?.subEventRsvp?.update === 'function'
        ) {
          for (const rsvp of dbRsvps) {
            if (rsvp.status !== 'attending' || (rsvp.plusOneCount ?? 0) <= 0) continue;
            const rNames = normalizePlusOneNames(rsvp.plusOneNames);
            while (rNames.length < rsvp.plusOneCount) {
              rNames.push('');
            }
            let rsvpNamesChanged = false;
            if (nextCompanion0) {
              if (!rNames[0] || rNames[0] === oldCompanion0) {
                rNames[0] = nextCompanion0;
                rsvpNamesChanged = true;
              }
            } else if (rNames[0] && (!oldCompanion0 || rNames[0] === oldCompanion0)) {
              rNames[0] = '';
              rsvpNamesChanged = true;
            }
            if (rsvpNamesChanged) {
              rsvp.plusOneNames = rNames;
              await txRepo.client.subEventRsvp.update({
                where: { id: rsvp.id },
                data: { plusOneNames: rNames },
              });
            }
          }
        }

        const baseExtra =
          processedData.extraFields !== undefined
            ? parseExtraObject(processedData.extraFields)
            : parseExtraObject(existingInvite?.extraFields);

        const hasStructuredProjectionExtra =
          Array.isArray(baseExtra.plusOneNames) ||
          Array.isArray(baseExtra.mealSelections) ||
          typeof baseExtra.mealSummary === 'string' ||
          Array.isArray(baseExtra.customAnswers) ||
          typeof baseExtra.customAnswersSummary === 'string' ||
          'plusOneCount' in baseExtra ||
          Array.isArray(baseExtra.eventRsvps);

        if (
          Array.isArray(dbRsvps) &&
          dbRsvps.length > 0 &&
          (hadStructuredDbRsvp || hasStructuredProjectionExtra)
        ) {
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
          const maxAttendingPlusOnes = dbRsvps.reduce(
            (max: number, r: any) =>
              r.status === 'attending' ? Math.max(max, Math.max(0, r.plusOneCount ?? 0)) : max,
            0
          );
          let syncedPlusOneNames = collectedPlusOneNames;
          if (maxAttendingPlusOnes === 0) {
            syncedPlusOneNames = [];
          } else if (syncedPlusOneNames.length === 0 && nextCompanion0) {
            syncedPlusOneNames = [nextCompanion0];
          }

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
            answers: Array<{ questionId: string; prompt: string; answer: string }>;
          }> = [];

          for (const r of dbRsvps) {
            if (r.status !== 'attending') continue;
            const evtTitle = r.subEvent?.title || 'Event';
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
                tags.forEach((t) => dietaryTagSet.add(t));
                const attendee =
                  idx === 0
                    ? nextGuestName || 'Primary Guest'
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
                resolvedAnswers.push({
                  questionId: qId,
                  prompt: qMap.get(qId)?.prompt || qId,
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

          const customAnswersSummary = structuredAnswers
            .map((entry) => {
              const inner = entry.answers.map((ans) => `${ans.prompt}: ${ans.answer}`).join('; ');
              return structuredAnswers.length > 1 ? `${entry.subEventTitle} — ${inner}` : inner;
            })
            .join(' | ');

          processedData.extraFields = {
            ...baseExtra,
            plusOneCount: maxAttendingPlusOnes,
            plusOneNames: syncedPlusOneNames,
            dietaryTags: Array.from(dietaryTagSet),
            mealSelections: structuredMeals,
            mealSummary: buildMealSummaryFromEntries(structuredMeals),
            customAnswers: structuredAnswers,
            customAnswersSummary,
          } as Prisma.InputJsonValue;
        } else if (hasStructuredProjectionExtra) {
          const nextExtra: Record<string, unknown> = { ...baseExtra };
          let nextNames = Array.isArray(baseExtra.plusOneNames)
            ? baseExtra.plusOneNames
              .filter((n): n is string => typeof n === 'string')
              .map((n) => n.trim())
              .filter(Boolean)
            : [];

          if (hasExplicitPlusOneColumns) {
            if (nextCompanion0) {
              if (nextNames.length === 0) {
                nextNames = [nextCompanion0];
              } else {
                nextNames = [
                  nextCompanion0,
                  ...nextNames.slice(1).filter((n) => n !== nextCompanion0),
                ];
              }
            } else if (nextNames.length > 0 && (!oldCompanion0 || nextNames[0] === oldCompanion0)) {
              nextNames = nextNames.slice(1);
            }
            nextExtra.plusOneNames = nextNames;
            if (typeof nextExtra.plusOneCount === 'number' && nextNames.length > nextExtra.plusOneCount) {
              nextExtra.plusOneCount = nextNames.length;
            }
          }

          if (Array.isArray(baseExtra.mealSelections)) {
            const updatedMealEntries = baseExtra.mealSelections
              .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
              .map((entry) => {
                const subEventTitle =
                  typeof entry.subEventTitle === 'string' ? entry.subEventTitle : 'Event';
                const rawSelections = Array.isArray(entry.selections) ? entry.selections : [];
                const updatedSelections = rawSelections
                  .filter((sel): sel is Record<string, unknown> => Boolean(sel && typeof sel === 'object'))
                  .map((sel, idx) => {
                    let attendee = typeof sel.attendee === 'string' ? sel.attendee : '';
                    if (idx === 0 && nextGuestName) {
                      if (!attendee || attendee === oldGuestName || attendee === 'Primary Guest') {
                        attendee = nextGuestName;
                      }
                    } else if (idx > 0 && nextNames[idx - 1]) {
                      attendee = nextNames[idx - 1];
                    }
                    const label = typeof sel.label === 'string' ? sel.label : '';
                    const dietaryTags = Array.isArray(sel.dietaryTags)
                      ? sel.dietaryTags.filter((t): t is string => typeof t === 'string')
                      : [];
                    return {
                      ...sel,
                      attendee,
                      label,
                      dietaryTags,
                    };
                  });
                return {
                  ...entry,
                  subEventTitle,
                  selections: updatedSelections,
                };
              });

            nextExtra.mealSelections = updatedMealEntries;
            nextExtra.mealSummary = buildMealSummaryFromEntries(updatedMealEntries);
          }

          processedData.extraFields = nextExtra as Prisma.InputJsonValue;
        }
      }

      const record = await txRepo.update(id, processedData);
      await this.createSnapshot(record.id, record, author, txRepo.client);
      return record;
    });
  }

  async updateBatch(
    ids: string[],
    data: Partial<InvitationCodeDTO> & Record<string, unknown>,
    author: string = 'Admin'
  ): Promise<InvitationCodeDTO[]> {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new Error('Validation Error: At least one ID is required.');
    }
    if (ids.length > 100) {
      throw new Error('Validation Error: Maximum of 100 items allowed per batch request.');
    }

    return this.repo.transaction(async (txRepo) => {
      const errors = validateInvitationGuestFields(data, { mode: 'service', partial: true });
      if (errors.length > 0) {
        throw new Error(errors[0]);
      }

      const processedData = normalizePartialInvitationFields(data);

      if (processedData.code !== undefined) {
        if (ids.length > 1) {
          throw new Error(
            'Validation Error: Invitation code cannot be shared across multiple guest records.'
          );
        }
        const normalizedCode = normalizeInvitationCode(processedData.code);
        if (!normalizedCode) {
          throw new Error('Validation Error: Code cannot be empty.');
        }
        processedData.code = normalizedCode;
        const existing = await txRepo.client.invitationCode.findUnique({
          where: { code: normalizedCode },
        });
        if (existing && existing.id !== ids[0]) {
          throw new Error(
            `Validation Error: Invitation code "${normalizedCode}" is already in use.`
          );
        }
      }

      let records: InvitationCodeDTO[];
      if (typeof txRepo.updateManyAndReturn === 'function') {
        records = await txRepo.updateManyAndReturn({
          where: { id: { in: ids } },
          data: processedData,
        });
      } else if (typeof txRepo.model?.updateManyAndReturn === 'function') {
        records = await txRepo.model.updateManyAndReturn({
          where: { id: { in: ids } },
          data: processedData,
        });
      } else if (typeof txRepo.updateMany === 'function') {
        await txRepo.updateMany({
          where: { id: { in: ids } },
          data: processedData,
        });
        records = await txRepo.findMany({
          where: { id: { in: ids } },
        });
      } else if (typeof txRepo.model?.updateMany === 'function') {
        await txRepo.model.updateMany({
          where: { id: { in: ids } },
          data: processedData,
        });
        records = await txRepo.findMany({
          where: { id: { in: ids } },
        });
      } else {
        records = await Promise.all(ids.map((id) => txRepo.update(id, processedData)));
      }

      await this.createBatchSnapshots(records, author, txRepo.client);
      return records;
    });
  }

  private buildBatchUpdateData(
    row: BatchInvitationCodeRecord,
    normalized: NormalizedInvitationCodeRecord
  ): Record<string, unknown> {
    const updateData: Record<string, unknown> = { guestName: normalized.guestName };
    if (row.email !== undefined) updateData.email = normalized.email;
    if (row.addressLine1 !== undefined) updateData.addressLine1 = normalized.addressLine1;
    if (row.addressLine2 !== undefined) updateData.addressLine2 = normalized.addressLine2;
    if (row.city !== undefined) updateData.city = normalized.city;
    if (row.state !== undefined) updateData.state = normalized.state;
    if (row.zipCode !== undefined) updateData.zipCode = normalized.zipCode;
    if (row.country !== undefined) updateData.country = normalized.country;
    if (row.dietaryNotes !== undefined) updateData.dietaryNotes = normalized.dietaryNotes;
    if (row.plusOneAllocations !== undefined) {
      updateData.plusOneAllocations = normalized.plusOneAllocations ?? 0;
    }
    if (row.plusOneFirstName !== undefined) updateData.plusOneFirstName = normalized.plusOneFirstName;
    if (row.plusOneLastName !== undefined) updateData.plusOneLastName = normalized.plusOneLastName;
    if (row.householdName !== undefined) updateData.householdName = normalized.householdName;
    if (row.partyGroup !== undefined) updateData.partyGroup = normalized.partyGroup;
    if (row.partyTags !== undefined) updateData.partyTags = normalized.partyTags;
    if (row.extraFields !== undefined) updateData.extraFields = normalized.extraFields;
    return updateData;
  }

  async importBatch(
    records: BatchInvitationCodeRecord[],
    collisionStrategy: InvitationCollisionStrategy = 'skip',
    author: string = 'Admin'
  ) {
    if (!Array.isArray(records) || records.length === 0) {
      throw new Error('Validation Error: Records array cannot be empty.');
    }

    return executeInTransaction(this.repo.client, async (tx: Prisma.TransactionClient) => {
      for (let i = 0; i < records.length; i++) {
        const errors = validateInvitationGuestFields(records[i], {
          mode: 'batch',
          rowNumber: i + 1,
        });
        if (errors.length > 0) {
          throw new Error(errors[0]);
        }
      }

      const existingDbRecords = await tx.invitationCode.findMany({
        select: {
          id: true,
          code: true,
          guestName: true,
          email: true,
          householdName: true,
          partyTags: true,
        },
      });
      const normalizedRows = records.map((r) => normalizeBatchInvitationRecord(r));
      const { dbCodeMap, matches } = resolveBatchGuestMatches(normalizedRows, existingDbRecords);

      let imported = 0;
      let skipped = 0;
      let updated = 0;
      const seenBatchCodes = new Set<string>();
      const allKnownCodes = new Set<string>(dbCodeMap.keys());
      const toCreate: Prisma.InvitationCodeCreateManyInput[] = [];
      const toUpdate: Array<{ id: string; data: Record<string, unknown> }> = [];

      for (let i = 0; i < records.length; i++) {
        const row = records[i];
        const normalized = normalizedRows[i];
        const guestName = normalized.guestName;
        let code = normalized.code;

        if (!code && matches[i]?.matchedRecord) {
          code = matches[i].matchedRecord!.code;
        }

        if (!code) {
          let newCode = '';
          let attempts = 0;
          while (attempts < 20) {
            const candidate = generateRandomCode();
            if (!allKnownCodes.has(candidate)) {
              newCode = candidate;
              break;
            }
            attempts++;
          }
          if (!newCode) {
            throw new Error('Failed to generate a unique invitation code for ' + guestName);
          }
          code = newCode;
          allKnownCodes.add(code);
        }

        const existsInDb = dbCodeMap.has(code);
        const existsInBatch = seenBatchCodes.has(code);

        if (collisionStrategy === 'reject' && (existsInDb || existsInBatch)) {
          throw new Error(`Duplicate invitation code found: ${code}`);
        }

        if (existsInBatch) {
          if (collisionStrategy === 'skip') {
            skipped++;
            continue;
          } else if (collisionStrategy === 'update') {
            if (existsInDb) {
              const existingRecord = dbCodeMap.get(code)!;
              toUpdate.push({
                id: existingRecord.id,
                data: this.buildBatchUpdateData(row, normalized),
              });
              updated++;
            }
            continue;
          }
        }

        seenBatchCodes.add(code);
        allKnownCodes.add(code);

        if (existsInDb) {
          if (collisionStrategy === 'skip') {
            skipped++;
          } else if (collisionStrategy === 'update') {
            const existingRecord = dbCodeMap.get(code)!;
            toUpdate.push({
              id: existingRecord.id,
              data: this.buildBatchUpdateData(row, normalized),
            });
            updated++;
          }
        } else {
          toCreate.push({
            guestName,
            code,
            email: normalized.email,
            addressLine1: normalized.addressLine1,
            addressLine2: normalized.addressLine2,
            city: normalized.city,
            state: normalized.state,
            zipCode: normalized.zipCode,
            country: normalized.country,
            dietaryNotes: normalized.dietaryNotes,
            plusOneAllocations: normalized.plusOneAllocations ?? 0,
            plusOneFirstName: normalized.plusOneFirstName,
            plusOneLastName: normalized.plusOneLastName,
            householdName: normalized.householdName,
            partyGroup: normalized.partyGroup,
            partyTags: normalized.partyTags,
            extraFields: (normalized.extraFields as Prisma.InputJsonValue | null) ?? undefined,
            used: false,
          });
          imported++;
        }
      }

      if (toCreate.length > 0) {
        await tx.invitationCode.createMany({
          data: toCreate,
        });
      }

      if (toUpdate.length > 0) {
        // Consolidate updates by record ID in case multiple rows target the same invitation code
        const updatesById = new Map<string, Record<string, unknown>>();
        for (const item of toUpdate) {
          const existing = updatesById.get(item.id);
          if (existing) {
            Object.assign(existing, item.data);
          } else {
            updatesById.set(item.id, { ...item.data });
          }
        }

        const rows = Array.from(updatesById.entries()).map(([id, d]) => {
          return Prisma.sql`(
            ${id}::text,
            ${d.guestName}::text,
            ${'email' in d ? d.email : null}::text,
            ${'email' in d}::boolean,
            ${'addressLine1' in d ? d.addressLine1 : null}::text,
            ${'addressLine1' in d}::boolean,
            ${'addressLine2' in d ? d.addressLine2 : null}::text,
            ${'addressLine2' in d}::boolean,
            ${'city' in d ? d.city : null}::text,
            ${'city' in d}::boolean,
            ${'state' in d ? d.state : null}::text,
            ${'state' in d}::boolean,
            ${'zipCode' in d ? d.zipCode : null}::text,
            ${'zipCode' in d}::boolean,
            ${'country' in d ? d.country : null}::text,
            ${'country' in d}::boolean,
            ${'dietaryNotes' in d ? d.dietaryNotes : null}::text,
            ${'dietaryNotes' in d}::boolean,
            ${'plusOneAllocations' in d ? d.plusOneAllocations : null}::integer,
            ${'plusOneAllocations' in d}::boolean,
            ${'plusOneFirstName' in d ? d.plusOneFirstName : null}::text,
            ${'plusOneFirstName' in d}::boolean,
            ${'plusOneLastName' in d ? d.plusOneLastName : null}::text,
            ${'plusOneLastName' in d}::boolean,
            ${'householdName' in d ? d.householdName : null}::text,
            ${'householdName' in d}::boolean,
            ${'partyGroup' in d ? d.partyGroup : null}::text,
            ${'partyGroup' in d}::boolean,
            ${'partyTags' in d ? d.partyTags : null}::text[],
            ${'partyTags' in d}::boolean,
            ${'extraFields' in d && d.extraFields !== null && d.extraFields !== undefined ? JSON.stringify(d.extraFields) : null}::jsonb,
            ${'extraFields' in d}::boolean
          )`;
        });

        const values = Prisma.join(rows, ', ');

        const bulkUpdateQuery = Prisma.sql`
          UPDATE "InvitationCode" AS t
          SET
            "guestName" = COALESCE(v."guestName", t."guestName"),
            "email" = CASE WHEN v."has_email" THEN v."email" ELSE t."email" END,
            "addressLine1" = CASE WHEN v."has_addressLine1" THEN v."addressLine1" ELSE t."addressLine1" END,
            "addressLine2" = CASE WHEN v."has_addressLine2" THEN v."addressLine2" ELSE t."addressLine2" END,
            "city" = CASE WHEN v."has_city" THEN v."city" ELSE t."city" END,
            "state" = CASE WHEN v."has_state" THEN v."state" ELSE t."state" END,
            "zipCode" = CASE WHEN v."has_zipCode" THEN v."zipCode" ELSE t."zipCode" END,
            "country" = CASE WHEN v."has_country" THEN v."country" ELSE t."country" END,
            "dietaryNotes" = CASE WHEN v."has_dietaryNotes" THEN v."dietaryNotes" ELSE t."dietaryNotes" END,
            "plusOneAllocations" = CASE WHEN v."has_plusOneAllocations" THEN v."plusOneAllocations" ELSE t."plusOneAllocations" END,
            "plusOneFirstName" = CASE WHEN v."has_plusOneFirstName" THEN v."plusOneFirstName" ELSE t."plusOneFirstName" END,
            "plusOneLastName" = CASE WHEN v."has_plusOneLastName" THEN v."plusOneLastName" ELSE t."plusOneLastName" END,
            "householdName" = CASE WHEN v."has_householdName" THEN v."householdName" ELSE t."householdName" END,
            "partyGroup" = CASE WHEN v."has_partyGroup" THEN v."partyGroup" ELSE t."partyGroup" END,
            "partyTags" = CASE WHEN v."has_partyTags" THEN v."partyTags" ELSE t."partyTags" END,
            "extraFields" = CASE WHEN v."has_extraFields" THEN v."extraFields" ELSE t."extraFields" END,
            "updatedAt" = NOW()
          FROM (VALUES ${values}) AS v(
            "id",
            "guestName",
            "email",
            "has_email",
            "addressLine1",
            "has_addressLine1",
            "addressLine2",
            "has_addressLine2",
            "city",
            "has_city",
            "state",
            "has_state",
            "zipCode",
            "has_zipCode",
            "country",
            "has_country",
            "dietaryNotes",
            "has_dietaryNotes",
            "plusOneAllocations",
            "has_plusOneAllocations",
            "plusOneFirstName",
            "has_plusOneFirstName",
            "plusOneLastName",
            "has_plusOneLastName",
            "householdName",
            "has_householdName",
            "partyGroup",
            "has_partyGroup",
            "partyTags",
            "has_partyTags",
            "extraFields",
            "has_extraFields"
          )
          WHERE t."id" = v."id"
        `;

        await tx.$executeRaw(bulkUpdateQuery);
      }

      await createAuditSnapshot(
        'InvitationCode',
        'batch_import',
        { total: records.length, imported, skipped, updated, collisionStrategy },
        author,
        tx
      );

      return {
        success: true,
        count: records.length,
        imported,
        skipped,
        updated,
      };
    });
  }

  async dryRunValidateBatch(
    records: BatchInvitationCodeRecord[],
    collisionStrategy: InvitationCollisionStrategy = 'skip'
  ): Promise<DryRunValidationResponse> {
    if (!Array.isArray(records) || records.length === 0) {
      throw new Error('Validation Error: Records array cannot be empty.');
    }

    const existingDbRecords = await this.repo.client.invitationCode.findMany({
      select: {
        id: true,
        code: true,
        guestName: true,
        email: true,
        householdName: true,
        partyTags: true,
      },
    });

    const normalizedRows = records.map((r) => normalizeBatchInvitationRecord(r));
    const { dbCodeMap, matches } = resolveBatchGuestMatches(normalizedRows, existingDbRecords);

    const batchCodeFreq = new Map<string, number>();
    const effectiveCodeFreq = new Map<string, number>();
    for (let i = 0; i < normalizedRows.length; i++) {
      const explicitCode = normalizedRows[i].code;
      if (explicitCode) {
        batchCodeFreq.set(explicitCode, (batchCodeFreq.get(explicitCode) || 0) + 1);
      }
      const effectiveCode = explicitCode || matches[i]?.matchedRecord?.code || '';
      if (effectiveCode) {
        effectiveCodeFreq.set(effectiveCode, (effectiveCodeFreq.get(effectiveCode) || 0) + 1);
      }
    }

    const rows: DryRunValidatedRow[] = [];
    let validCount = 0;
    let invalidCount = 0;
    let duplicateCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let createdCount = 0;

    for (let i = 0; i < records.length; i++) {
      const normalized = normalizedRows[i];
      const matchInfo = matches[i];
      const { errors, fieldErrors } = validateInvitationGuestFieldsWithColumns(normalized, {
        mode: 'row',
      });
      const warnings: string[] = [];
      let resolvedCode = normalized.code;

      const pushCodeError = (msg: string) => {
        errors.push(msg);
        if (!fieldErrors.code) {
          fieldErrors.code = [msg];
        } else {
          fieldErrors.code.push(msg);
        }
      };

      let isDuplicate = false;
      let existingGuestName: string | null = null;
      let actionOutcome: 'create' | 'update' | 'skip' | 'reject' | 'invalid' = 'create';

      if (normalized.code) {
        const isBatchDuplicate = (batchCodeFreq.get(normalized.code) || 0) > 1;
        const existingInDb = dbCodeMap.get(normalized.code);

        if (existingInDb) {
          isDuplicate = true;
          existingGuestName = existingInDb.guestName;
          if (collisionStrategy === 'reject') {
            pushCodeError(
              `Code "${normalized.code}" already exists in database (belongs to "${existingGuestName}").`
            );
            actionOutcome = 'reject';
          } else if (collisionStrategy === 'skip') {
            warnings.push(
              `Code "${normalized.code}" already exists in database for guest "${existingGuestName}". Will be skipped.`
            );
            actionOutcome = 'skip';
          } else if (collisionStrategy === 'update') {
            warnings.push(
              `Code "${normalized.code}" already exists in database for guest "${existingGuestName}". Will be updated.`
            );
            actionOutcome = 'update';
          }
          if ((effectiveCodeFreq.get(normalized.code) || 0) > 1 && collisionStrategy !== 'reject') {
            warnings.push(
              `Multiple rows in this batch resolve to invitation code "${normalized.code}".`
            );
          }
        } else if (isBatchDuplicate) {
          isDuplicate = true;
          pushCodeError(`Duplicate invitation code "${normalized.code}" within batch.`);
          actionOutcome = 'invalid';
        } else {
          actionOutcome = 'create';
        }
      } else if (matchInfo?.matchedRecord) {
        const matched = matchInfo.matchedRecord;
        resolvedCode = matched.code;
        isDuplicate = true;
        existingGuestName = matched.guestName;
        const matchReasonLabel =
          matchInfo.matchedBy === 'email'
            ? 'email'
            : matchInfo.matchedBy === 'name_household'
              ? 'name and household'
              : 'unique name';

        if (collisionStrategy === 'reject') {
          pushCodeError(
            `Matched existing guest "${existingGuestName}" (${resolvedCode}) by ${matchReasonLabel}.`
          );
          actionOutcome = 'reject';
        } else if (collisionStrategy === 'skip') {
          warnings.push(
            `Matched existing guest "${existingGuestName}" (${resolvedCode}) by ${matchReasonLabel}. Will be skipped.`
          );
          actionOutcome = 'skip';
        } else if (collisionStrategy === 'update') {
          warnings.push(
            `Matched existing guest "${existingGuestName}" (${resolvedCode}) by ${matchReasonLabel}. Will be updated.`
          );
          actionOutcome = 'update';
        }

        if ((effectiveCodeFreq.get(resolvedCode) || 0) > 1) {
          if (collisionStrategy === 'reject') {
            pushCodeError(
              `Multiple rows in this batch resolve to invitation code "${resolvedCode}".`
            );
          } else {
            warnings.push(
              `Multiple rows in this batch resolve to invitation code "${resolvedCode}".`
            );
          }
        }
      } else if (matchInfo?.ambiguityWarning) {
        warnings.push(matchInfo.ambiguityWarning);
        actionOutcome = 'create';
      } else {
        warnings.push('Blank code: Auto-generated code will be assigned.');
        actionOutcome = 'create';
      }

      const isValid = errors.length === 0;
      if (!isValid) {
        if (actionOutcome !== 'reject') {
          actionOutcome = 'invalid';
        }
        invalidCount++;
      } else {
        validCount++;
        if (actionOutcome === 'create') createdCount++;
        else if (actionOutcome === 'update') updatedCount++;
        else if (actionOutcome === 'skip') skippedCount++;
      }

      if (isDuplicate) {
        duplicateCount++;
      }

      rows.push({
        rowIndex: i + 1,
        ...normalized,
        code: resolvedCode,
        isValid,
        errors,
        fieldErrors: errors.length > 0 ? fieldErrors : undefined,
        warnings,
        isDuplicate,
        existingGuestName,
        actionOutcome,
      });
    }

    const summary: DryRunValidationSummary = {
      total: records.length,
      validCount,
      invalidCount,
      duplicateCount,
      updatedCount,
      skippedCount,
      createdCount,
    };

    return {
      success: true,
      summary,
      rows,
    };
  }

  async batchUpdateTags(
    ids: string[],
    tags: string[],
    action: 'add' | 'remove' | 'replace' = 'add',
    author: string = 'Admin'
  ): Promise<InvitationCodeDTO[]> {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new Error('Validation Error: IDs array cannot be empty.');
    }
    if (ids.length > 5000) {
      throw new Error('Validation Error: Maximum of 5000 invitation code IDs allowed per batch request.');
    }
    const trimmedIds: string[] = [];
    for (const id of ids) {
      if (typeof id !== 'string' || id.trim() === '') {
        throw new Error('Validation Error: Invalid ID in array.');
      }
      trimmedIds.push(id.trim());
    }
    const uniqueIds = Array.from(new Set(trimmedIds));

    if (action !== 'add' && action !== 'remove' && action !== 'replace') {
      throw new Error('Validation Error: Invalid tag update action.');
    }

    if (!Array.isArray(tags)) {
      throw new Error('Validation Error: Party tags must be an array of strings.');
    }
    const cleanTags = normalizePartyTags(tags, { dedupe: true });
    if ((action === 'add' || action === 'remove') && cleanTags.length === 0) {
      throw new Error(
        'Validation Error: At least one non-empty tag is required when adding or removing tags.'
      );
    }

    return executeInTransaction(this.repo.client, async (tx: Prisma.TransactionClient) => {
      const dbRecords = await tx.invitationCode.findMany({
        where: { id: { in: uniqueIds } },
      });

      if (dbRecords.length === 0) {
        return [];
      }

      const removeSet = action === 'remove' ? new Set(cleanTags) : null;
      const now = new Date();
      const updatedRecords: InvitationCodeDTO[] = dbRecords.map((record) => {
        const existingTags = normalizePartyTags(record.partyTags, { dedupe: true });
        let updatedTags: string[];
        if (action === 'replace') {
          updatedTags = [...cleanTags];
        } else if (removeSet) {
          updatedTags = existingTags.filter((t) => !removeSet.has(t));
        } else {
          updatedTags = Array.from(new Set([...existingTags, ...cleanTags]));
        }

        return {
          ...(record as unknown as InvitationCodeDTO),
          partyTags: updatedTags,
          updatedAt: now,
        };
      });

      const rows = updatedRecords.map((record) =>
        Prisma.sql`(${record.id}::text, ${record.partyTags}::text[])`
      );
      const values = Prisma.join(rows, ', ');

      const bulkUpdateQuery = Prisma.sql`
        UPDATE "InvitationCode" AS t
        SET
          "partyTags" = v."partyTags",
          "updatedAt" = NOW()
        FROM (VALUES ${values}) AS v("id", "partyTags")
        WHERE t."id" = v."id"
      `;

      await tx.$executeRaw(bulkUpdateQuery);
      await this.createBatchSnapshots(updatedRecords, author, tx);

      return updatedRecords;
    });
  }

  async batchDelete(ids: string[], author: string = 'Admin') {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new Error('Validation Error: IDs array cannot be empty.');
    }
    for (const id of ids) {
      if (typeof id !== 'string' || id.trim() === '') {
        throw new Error('Validation Error: Invalid ID in array.');
      }
    }

    return executeInTransaction(this.repo.client, async (tx: Prisma.TransactionClient) => {
      await tx.contributor.updateMany({
        where: { invitationCodeId: { in: ids } },
        data: { invitationCodeId: null },
      });
      await tx.subEventAccess.deleteMany({
        where: { invitationCodeId: { in: ids } },
      });
      await tx.subEventRsvp.deleteMany({
        where: { invitationCodeId: { in: ids } },
      });
      await tx.broadcastRecipient.updateMany({
        where: { invitationCodeId: { in: ids } },
        data: { invitationCodeId: null },
      });

      const deleteResult = await tx.invitationCode.deleteMany({
        where: { id: { in: ids } },
      });

      await createAuditSnapshot(
        'InvitationCode',
        'batch_delete',
        { count: deleteResult.count, ids },
        author,
        tx
      );

      return {
        success: true,
        count: deleteResult.count,
      };
    });
  }

  async mergeDuplicates(
    primaryId: string,
    secondaryIds: string[],
    author: string = 'Admin'
  ): Promise<MergeInvitationCodesResult> {
    const cleanPrimaryId = typeof primaryId === 'string' ? primaryId.trim() : '';
    if (!cleanPrimaryId) {
      throw new Error('Validation Error: Primary guest ID is required.');
    }
    if (!Array.isArray(secondaryIds) || secondaryIds.length === 0) {
      throw new Error('Validation Error: At least one secondary guest ID is required.');
    }

    const trimmedSecondaries: string[] = [];
    for (const rawId of secondaryIds) {
      if (typeof rawId !== 'string' || rawId.trim() === '') {
        throw new Error('Validation Error: Secondary guest ID cannot be empty.');
      }
      const trimmed = rawId.trim();
      if (trimmed !== cleanPrimaryId && !trimmedSecondaries.includes(trimmed)) {
        trimmedSecondaries.push(trimmed);
      }
    }

    if (trimmedSecondaries.length === 0) {
      throw new Error('Validation Error: At least one distinct secondary guest ID is required to merge.');
    }
    if (trimmedSecondaries.length > 100) {
      throw new Error('Validation Error: Maximum of 100 secondary guest records allowed per merge.');
    }

    return executeInTransaction(this.repo.client, async (tx: Prisma.TransactionClient) => {
      const allIds = [cleanPrimaryId, ...trimmedSecondaries];
      const foundRecords = await tx.invitationCode.findMany({
        where: { id: { in: allIds } },
      });

      const byId = new Map(foundRecords.map((rec) => [rec.id, rec]));
      const primary = byId.get(cleanPrimaryId);
      if (!primary) {
        throw new Error('Validation Error: Primary guest record not found.');
      }

      const secondaries = trimmedSecondaries.map((secId) => {
        const rec = byId.get(secId);
        if (!rec) {
          throw new Error(`Validation Error: Secondary guest record "${secId}" not found.`);
        }
        return rec;
      });

      const merged = computeMergedInvitationPreview(
        primary as unknown as InvitationCodeDTO,
        secondaries as unknown as InvitationCodeDTO[]
      );
      const seatTransferred = !primary.tableId && Boolean(merged.tableId);

      // 1. Transfer linked Contributor gift records
      const contributorResult = await tx.contributor.updateMany({
        where: { invitationCodeId: { in: trimmedSecondaries } },
        data: { invitationCodeId: cleanPrimaryId },
      });

      // 2. Transfer SubEventAccess records while avoiding @@unique([subEventId, invitationCodeId]) collisions
      const secOrder = new Map(trimmedSecondaries.map((id, idx) => [id, idx]));
      const allAccesses = await tx.subEventAccess.findMany({
        where: { invitationCodeId: { in: allIds } },
      });
      const coveredAccessSubEvents = new Set<string>(
        allAccesses
          .filter((a) => a.invitationCodeId === cleanPrimaryId)
          .map((a) => a.subEventId)
      );
      const accessIdsToTransfer: string[] = [];
      const accessIdsToDelete: string[] = [];
      const secondaryAccesses = allAccesses
        .filter((a) => a.invitationCodeId !== cleanPrimaryId)
        .sort((a, b) => (secOrder.get(a.invitationCodeId) ?? 0) - (secOrder.get(b.invitationCodeId) ?? 0));

      for (const acc of secondaryAccesses) {
        if (coveredAccessSubEvents.has(acc.subEventId)) {
          accessIdsToDelete.push(acc.id);
        } else {
          coveredAccessSubEvents.add(acc.subEventId);
          accessIdsToTransfer.push(acc.id);
        }
      }

      if (accessIdsToDelete.length > 0) {
        await tx.subEventAccess.deleteMany({
          where: { id: { in: accessIdsToDelete } },
        });
      }
      if (accessIdsToTransfer.length > 0) {
        await tx.subEventAccess.updateMany({
          where: { id: { in: accessIdsToTransfer } },
          data: { invitationCodeId: cleanPrimaryId },
        });
      }

      // 3. Transfer SubEventRsvp records while avoiding @@unique([subEventId, invitationCodeId]) collisions
      const allRsvps = await tx.subEventRsvp.findMany({
        where: { invitationCodeId: { in: allIds } },
      });
      const rsvpsBySubEvent = new Map<string, typeof allRsvps>();
      for (const rsvp of allRsvps) {
        const list = rsvpsBySubEvent.get(rsvp.subEventId);
        if (list) list.push(rsvp);
        else rsvpsBySubEvent.set(rsvp.subEventId, [rsvp]);
      }

      let transferredRsvpCount = 0;
      const rsvpIdsToDelete: string[] = [];

      for (const [, group] of rsvpsBySubEvent.entries()) {
        const primaryRsvp = group.find((r) => r.invitationCodeId === cleanPrimaryId);
        const secRsvps = group
          .filter((r) => r.invitationCodeId !== cleanPrimaryId)
          .sort((a, b) => (secOrder.get(a.invitationCodeId) ?? 0) - (secOrder.get(b.invitationCodeId) ?? 0));

        if (secRsvps.length === 0) continue;

        const combinedRsvpDietary =
          mergeDietaryNotes([
            primaryRsvp?.dietaryNotes,
            ...secRsvps.map((r) => r.dietaryNotes),
          ]) ?? '';
        const maxRsvpPlusOnes = Math.max(
          primaryRsvp?.plusOneCount ?? 0,
          ...secRsvps.map((r) => r.plusOneCount ?? 0)
        );

        const orderedCandidates = [...(primaryRsvp ? [primaryRsvp] : []), ...secRsvps];
        const prioritizedRsvps = [
          ...orderedCandidates.filter((r) => r.status === 'attending'),
          ...orderedCandidates.filter((r) => r.status !== 'attending' && r.status !== 'declined'),
        ];

        const resolvedStatus = primaryRsvp
          ? primaryRsvp.status !== 'pending'
            ? primaryRsvp.status
            : secRsvps.find((r) => r.status !== 'pending')?.status ?? primaryRsvp.status
          : (secRsvps.find((r) => r.status !== 'pending') ?? secRsvps[0]).status;

        const resolvedPlusOneCount = resolvedStatus === 'declined' ? 0 : maxRsvpPlusOnes;

        let resolvedMeals: string[] = [];
        const resolvedAnswers: Record<string, string> = {};
        let resolvedPlusOneNames: string[] = [];

        if (resolvedStatus !== 'declined') {
          for (const candidate of prioritizedRsvps) {
            const candidateMeals = normalizeMealSelections(candidate.mealSelections);
            if (resolvedMeals.length === 0 && candidateMeals.some(Boolean)) {
              resolvedMeals = candidateMeals;
            }
            const candidateAnswers = normalizeCustomAnswers(candidate.customAnswers);
            for (const [qId, ans] of Object.entries(candidateAnswers)) {
              if (!resolvedAnswers[qId]) {
                resolvedAnswers[qId] = ans;
              }
            }
            const candidateNames = normalizePlusOneNames(candidate.plusOneNames);
            if (resolvedPlusOneNames.length === 0 && candidateNames.some(Boolean)) {
              resolvedPlusOneNames = candidateNames.slice(0, resolvedPlusOneCount);
            }
          }
        }

        const hasJsonbRsvpFields = orderedCandidates.some(
          (r) =>
            r.mealSelections !== undefined ||
            r.customAnswers !== undefined ||
            r.plusOneNames !== undefined
        );

        if (primaryRsvp) {
          const prevMeals = normalizeMealSelections(primaryRsvp.mealSelections);
          const prevAnswers = normalizeCustomAnswers(primaryRsvp.customAnswers);
          const prevNames = normalizePlusOneNames(primaryRsvp.plusOneNames);
          const jsonbChanged =
            hasJsonbRsvpFields &&
            (JSON.stringify(resolvedMeals) !== JSON.stringify(prevMeals) ||
              JSON.stringify(resolvedAnswers) !== JSON.stringify(prevAnswers) ||
              JSON.stringify(resolvedPlusOneNames) !== JSON.stringify(prevNames));

          if (
            resolvedStatus !== primaryRsvp.status ||
            resolvedPlusOneCount !== primaryRsvp.plusOneCount ||
            combinedRsvpDietary !== (primaryRsvp.dietaryNotes ?? '') ||
            jsonbChanged
          ) {
            await tx.subEventRsvp.update({
              where: { id: primaryRsvp.id },
              data: {
                status: resolvedStatus,
                plusOneCount: resolvedPlusOneCount,
                dietaryNotes: combinedRsvpDietary,
                ...(hasJsonbRsvpFields
                  ? {
                    mealSelections: resolvedMeals,
                    customAnswers: resolvedAnswers,
                    plusOneNames: resolvedPlusOneNames,
                  }
                  : {}),
              },
            });
            transferredRsvpCount++;
          }
          for (const sr of secRsvps) {
            rsvpIdsToDelete.push(sr.id);
          }
        } else {
          const chosenSec = secRsvps.find((r) => r.status !== 'pending') ?? secRsvps[0];
          await tx.subEventRsvp.update({
            where: { id: chosenSec.id },
            data: {
              invitationCodeId: cleanPrimaryId,
              plusOneCount: resolvedPlusOneCount,
              dietaryNotes: combinedRsvpDietary,
              ...(hasJsonbRsvpFields
                ? {
                  mealSelections: resolvedMeals,
                  customAnswers: resolvedAnswers,
                  plusOneNames: resolvedPlusOneNames,
                }
                : {}),
            },
          });
          transferredRsvpCount++;
          for (const sr of secRsvps) {
            if (sr.id !== chosenSec.id) {
              rsvpIdsToDelete.push(sr.id);
            }
          }
        }
      }

      if (rsvpIdsToDelete.length > 0) {
        await tx.subEventRsvp.deleteMany({
          where: { id: { in: rsvpIdsToDelete } },
        });
      }

      // 4. Transfer BroadcastRecipient delivery logs & rewrite scheduled BroadcastMessage selectedIds
      const broadcastResult = await tx.broadcastRecipient.updateMany({
        where: { invitationCodeId: { in: trimmedSecondaries } },
        data: { invitationCodeId: cleanPrimaryId },
      });

      if (typeof tx.broadcastMessage?.findMany === 'function') {
        const scheduledBroadcasts = await tx.broadcastMessage.findMany({
          where: { status: { in: ['PENDING', 'SCHEDULED'] } },
          select: { id: true, targetFilters: true },
        });
        const secondaryIdSet = new Set(trimmedSecondaries);
        for (const bm of scheduledBroadcasts) {
          const tf = bm.targetFilters;
          if (tf && typeof tf === 'object' && !Array.isArray(tf)) {
            const tfRecord = tf as Record<string, unknown>;
            if (Array.isArray(tfRecord.selectedIds)) {
              let changed = false;
              const rewrittenIds: string[] = [];
              for (const rawId of tfRecord.selectedIds) {
                if (typeof rawId !== 'string') continue;
                const mappedId = secondaryIdSet.has(rawId) ? cleanPrimaryId : rawId;
                if (mappedId !== rawId) changed = true;
                if (!rewrittenIds.includes(mappedId)) {
                  rewrittenIds.push(mappedId);
                }
              }
              if (changed) {
                await tx.broadcastMessage.update({
                  where: { id: bm.id },
                  data: {
                    targetFilters: {
                      ...tfRecord,
                      selectedIds: rewrittenIds,
                    } as Prisma.InputJsonValue,
                  },
                });
              }
            }
          }
        }
      }

      // 5. Delete secondary InvitationCode records before consolidating seating onto primary
      await tx.invitationCode.deleteMany({
        where: { id: { in: trimmedSecondaries } },
      });

      // 6. Consolidate profile & seating fields onto primary InvitationCode
      const updatedPrimary = await tx.invitationCode.update({
        where: { id: cleanPrimaryId },
        data: {
          guestName: merged.guestName,
          email: merged.email,
          addressLine1: merged.addressLine1,
          addressLine2: merged.addressLine2,
          city: merged.city,
          state: merged.state,
          zipCode: merged.zipCode,
          country: merged.country,
          dietaryNotes: merged.dietaryNotes,
          plusOneAllocations: merged.plusOneAllocations,
          plusOneFirstName: merged.plusOneFirstName,
          plusOneLastName: merged.plusOneLastName,
          householdName: merged.householdName,
          partyGroup: merged.partyGroup,
          partyTags: merged.partyTags,
          extraFields:
            merged.extraFields === null
              ? Prisma.DbNull
              : (merged.extraFields as Prisma.InputJsonValue),
          used: merged.used,
          usedAt: merged.usedAt ? new Date(merged.usedAt) : null,
          tableId: merged.tableId,
          seatNumber: merged.seatNumber,
        },
      });

      const transferredCounts = {
        contributors: contributorResult.count,
        subEventAccesses: accessIdsToTransfer.length,
        subEventRsvps: transferredRsvpCount,
        broadcastRecipients: broadcastResult.count,
        seatTransferred,
      };

      await createAuditSnapshot(
        'InvitationCode',
        'merge_duplicates',
        {
          primaryId: cleanPrimaryId,
          primaryCode: primary.code,
          mergedSecondaryIds: trimmedSecondaries,
          mergedSecondaryCodes: secondaries.map((s) => s.code),
          transferredCounts,
          record: updatedPrimary,
        },
        author,
        tx
      );

      return {
        success: true,
        record: updatedPrimary as unknown as InvitationCodeDTO,
        mergedCount: trimmedSecondaries.length,
        transferredCounts,
      };
    });
  }
}
