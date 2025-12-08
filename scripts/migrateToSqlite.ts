/**
 * @fileoverview Main entry point for the Prisma migration script.
 * This script reads registry data from a JSON file and migrates it to the database
 * using the Prisma Client.
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs').promises;
const path = require('path');

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

const prisma = new PrismaClient();

/**
 * Reads the registry data from the 'src/data/registry.json' file.
 * @returns {Promise<RegistryItem[]>} A promise that resolves to an array of RegistryItem objects.
 */
async function readJsonData(): Promise<RegistryItem[]> {
  const filePath = path.join(process.cwd(), 'src', 'data', 'registry.json');
  const jsonData = await fs.readFile(filePath, 'utf8');
  return JSON.parse(jsonData);
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
    const jsonData = await readJsonData();
    
    for (const item of jsonData) {
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
