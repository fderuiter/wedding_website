/**
 * @jest-environment node
 */

import { RegistryRepository } from '../repository';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

// Unmock @prisma/client for this test file so we can interact with the real PostgreSQL container
jest.unmock('@prisma/client');
jest.unmock('@prisma/adapter-pg');
jest.unmock('pg');

const { PrismaClient } = jest.requireActual('@prisma/client');

const connectionString = process.env.DATABASE_URL || 'postgresql://wedding:wedding123@localhost:5432/wedding_test?schema=public';
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const realPrisma = new PrismaClient({ adapter });

// Instantiate RegistryRepository with the real PrismaClient
const realRepository = new RegistryRepository(realPrisma);

describe('Registry Gift Contribution Concurrency & Row-Level Locking', () => {
  let testItem: any;

  beforeEach(async () => {
    // Clean up registry items and media before each test
    await realPrisma.contributor.deleteMany();
    await realPrisma.registryItem.deleteMany();
    await realPrisma.media.deleteMany();

    // Create a media item for the imageId foreign key requirement
    const media = await realPrisma.media.create({
      data: {
        url: '/images/placeholder.png',
        altText: 'Placeholder Image',
        isDecorative: true,
      },
    });

    // Create a group gift registry item with a total target price of 100
    testItem = await realPrisma.registryItem.create({
      data: {
        name: 'Sofa Group Gift',
        description: 'A beautiful group gift sofa.',
        category: 'Living Room',
        price: 100,
        imageId: media.id,
        quantity: 1,
        isGroupGift: true,
        amountContributed: 0,
        purchased: false,
      },
    });
  });

  afterAll(async () => {
    // Clean up database after tests complete
    await realPrisma.contributor.deleteMany();
    await realPrisma.registryItem.deleteMany();
    await realPrisma.media.deleteMany();
    await realPrisma.$disconnect();
    await pool.end();
  });

  test('prevents overfunding of group gifts on concurrent contributions', async () => {
    // Current amountContributed is 0, price is 100.
    // Let's assume there is only 30 remaining amount. We contribute 70 first.
    await realRepository.contributeToItem(testItem.id, {
      name: 'User A',
      amount: 70,
    });

    // Now remaining amount is 30.
    // Two concurrent users attempt to contribute 30 each at the exact same moment.
    const contributionPromise1 = realRepository.contributeToItem(testItem.id, {
      name: 'User B',
      amount: 30,
    });
    const contributionPromise2 = realRepository.contributeToItem(testItem.id, {
      name: 'User C',
      amount: 30,
    });

    // Run both simultaneously and capture outcomes
    const results = await Promise.allSettled([contributionPromise1, contributionPromise2]);

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    // Exactly one must succeed, and exactly one must fail because price (100) cannot be exceeded.
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);

    // Verify the failure reason is one of the expected validation errors
    const failureReason = (failed[0] as PromiseRejectedResult).reason;
    const allowedErrors = [
      'This item has already been purchased.',
      'Contribution cannot be greater than the remaining amount.'
    ];
    expect(allowedErrors).toContain(failureReason.message);

    // Verify the final amount contributed is exactly 100, and is marked as purchased
    const finalItem = await realPrisma.registryItem.findUnique({
      where: { id: testItem.id },
      include: { contributors: true },
    });

    expect(finalItem).toBeDefined();
    expect(finalItem!.amountContributed).toBe(100);
    expect(finalItem!.purchased).toBe(true);
    expect(finalItem!.contributors).toHaveLength(2); // User A (70) and User B or C (30)
  });

  test('prevents double-purchasing a unique standard gift on concurrent full purchases', async () => {
    // A standard gift (not group gift) with target price of 100.
    // Two users simultaneously attempt to buy it by contributing the full 100.
    const purchasePromise1 = realRepository.contributeToItem(testItem.id, {
      name: 'Buyer 1',
      amount: 100,
    });
    const purchasePromise2 = realRepository.contributeToItem(testItem.id, {
      name: 'Buyer 2',
      amount: 100,
    });

    // Run both simultaneously
    const results = await Promise.allSettled([purchasePromise1, purchasePromise2]);

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    // Exactly one must succeed, and the other must be rejected
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);

    // One of the errors could be 'This item has already been purchased.' or 'Contribution cannot be greater than the remaining amount.'
    const failureReason = (failed[0] as PromiseRejectedResult).reason;
    const allowedErrors = [
      'This item has already been purchased.',
      'Contribution cannot be greater than the remaining amount.'
    ];
    expect(allowedErrors).toContain(failureReason.message);

    // Verify final database state is correct and has exactly 1 contributor
    const finalItem = await realPrisma.registryItem.findUnique({
      where: { id: testItem.id },
      include: { contributors: true },
    });

    expect(finalItem).toBeDefined();
    expect(finalItem!.amountContributed).toBe(100);
    expect(finalItem!.purchased).toBe(true);
    expect(finalItem!.contributors).toHaveLength(1); // Only the winner
  });
});
