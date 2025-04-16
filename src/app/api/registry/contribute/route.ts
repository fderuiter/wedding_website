import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { RegistryItem, Contributor } from '@/types/registry';
import { validateContributeInput } from '@/utils/validation';

// Helper function to read data
async function readRegistryData(): Promise<RegistryItem[]> {
  const filePath = path.join(process.cwd(), 'src', 'data', 'registry.json');
  const jsonData = await fs.readFile(filePath, 'utf8');
  return JSON.parse(jsonData);
}

// Helper function to write data
async function writeRegistryData(data: RegistryItem[]): Promise<void> {
  const filePath = path.join(process.cwd(), 'src', 'data', 'registry.json');
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

export async function POST(request: Request) {
  try {
    const input = await request.json();
    const validationError = validateContributeInput(input);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }
    const { itemId, purchaserName, amount } = input;

    const items = await readRegistryData();
    const itemIndex = items.findIndex(item => item.id === itemId);
    if (itemIndex === -1) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }
    const item = items[itemIndex];
    if (item.purchased) {
      return NextResponse.json({ error: 'This item has already been claimed or fully funded.' }, { status: 400 });
    }
    const contributionAmount = Number(amount) || 0;
    if (item.isGroupGift) {
      if (contributionAmount <= 0) {
        return NextResponse.json({ error: 'Contribution amount must be positive.' }, { status: 400 });
      }
      const remainingNeeded = item.price - item.amountContributed;
      if (contributionAmount > remainingNeeded) {
        return NextResponse.json({ error: `Contribution exceeds remaining amount needed ($${remainingNeeded.toFixed(2)}).` }, { status: 400 });
      }
      item.amountContributed += contributionAmount;
      const newContributor: Contributor = {
        name: purchaserName,
        amount: contributionAmount,
        date: new Date().toISOString(),
      };
      item.contributors.push(newContributor);
      if (item.amountContributed >= item.price) {
        item.purchased = true;
        item.amountContributed = item.price;
      }
    } else {
      item.purchased = true;
      item.purchaserName = purchaserName;
      item.amountContributed = item.price;
    }
    items[itemIndex] = item;
    await writeRegistryData(items);
    return NextResponse.json({ message: 'Contribution processed successfully', item });
  } catch (error) {
    console.error("Error processing contribution:", error);
    let errorMessage = 'Failed to process contribution';
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'EACCES') {
      errorMessage = 'Server error: Insufficient permissions to update registry data.';
      return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
