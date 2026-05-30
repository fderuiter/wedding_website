import { Prisma } from '@prisma/client';

export type RegistryItem = Prisma.RegistryItemGetPayload<{
  include: { contributors: true }
}>;

export type Contributor = Prisma.ContributorGetPayload<{}>;
