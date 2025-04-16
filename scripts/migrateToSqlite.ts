const { PrismaClient } = require('@prisma/client');
const fs = require('fs').promises;
const path = require('path');

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

async function readJsonData(): Promise<RegistryItem[]> {
  const filePath = path.join(process.cwd(), 'src', 'data', 'registry.json');
  const jsonData = await fs.readFile(filePath, 'utf8');
  return JSON.parse(jsonData);
}

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
