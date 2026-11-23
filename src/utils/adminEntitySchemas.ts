import { z } from 'zod';
import {
  ContentNodeInputSchema,
  ContentNodeUpdateInputSchema,
} from '@/features/content';
import {
  WeddingPartyInputSchema,
  WeddingPartyUpdateInputSchema,
} from '@/features/wedding-party';
import {
  AttractionCreateInputSchema,
  AttractionInputSchema,
} from '@/features/attractions';
import {
  RegistryItemCreateInputSchema,
  RegistryItemInputSchema,
  InvitationCodeInputSchema,
  InvitationCodeUpdateInputSchema,
} from '@/features/registry';
import {
  SeatingTableInputSchema,
  SeatingTableUpdateInputSchema,
} from '@/features/seating';
import {
  SubEventInputSchema,
  SubEventUpdateInputSchema,
} from '@/features/sub-events';

export const AdminEntityCreateSchema = z.union([
  ContentNodeInputSchema,
  WeddingPartyInputSchema,
  AttractionCreateInputSchema,
  RegistryItemCreateInputSchema,
  InvitationCodeInputSchema,
  SeatingTableInputSchema,
  SubEventInputSchema,
]);

export const AdminEntityUpdateSchema = z.union([
  ContentNodeUpdateInputSchema,
  WeddingPartyUpdateInputSchema,
  AttractionInputSchema,
  RegistryItemInputSchema,
  InvitationCodeUpdateInputSchema,
  SeatingTableUpdateInputSchema,
  SubEventUpdateInputSchema,
]);
