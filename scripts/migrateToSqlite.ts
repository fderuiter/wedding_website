/**
 * @fileoverview Main entry point for the Prisma migration script.
 * This script reads registry data from a JSON file and migrates it to the database
 * using the Prisma Client.
 */

import { prisma } from '@/lib/prisma';
import jsonData from '@/data/registry.json' with { type: 'json' };

/**
 * Interface representing the structure of a registry item in the JSON data.
 */
interface RegistryItem {
  id: string;
  name: string;
  description: string;
  category: string;
  price: number;
  image: string;
  vendorUrl: string | null;
  quantity: number;
  isGroupGift: boolean;
  purchased: boolean;
  purchaserName?: string | null;
  amountContributed: number;
  contributors: Array<{
    name: string;
    amount: number;
    date: string;
  }>;
}

/**
 * Main migration function.
 * Reads data from the JSON file and creates corresponding records in the database.
 * It iterates through each item in the JSON, creates a registry item record,
 * and creates associated contributor records.
 *
 * @returns {Promise<void>} A promise that resolves when the migration is complete.
 * @throws {Error} If migration fails.
 */
async function migrateData() {
  try {
    console.log('Starting migration...');
    const data = jsonData as RegistryItem[];
    
    for (const item of data) {
      // Create the registry item
      const registryItem = await prisma.registryItem.create({
        data: {
          id: item.id, // Preserve existing IDs
          name: item.name,
          description: item.description,
          category: item.category,
          price: item.price,
          image: item.image,
          vendorUrl: item.vendorUrl,
          quantity: item.quantity,
          isGroupGift: item.isGroupGift,
          purchased: item.purchased,
          purchaserName: item.purchaserName,
          amountContributed: item.amountContributed,
          contributors: {
            create: item.contributors.map(contributor => ({
              name: contributor.name,
              amount: contributor.amount,
              date: new Date(contributor.date),
            }))
          }
        }
      });
      
      console.log(`Migrated item: ${item.name}`);
    }
    
    console.log('Migration completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the migration
migrateData();
