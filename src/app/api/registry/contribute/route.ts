import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { RegistryItem, Contributor } from '@/types/registry';

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
    const { itemId, contributorName, amount } = await request.json();

    if (!itemId || !contributorName || (amount !== undefined && typeof amount !== 'number')) {
      return NextResponse.json({ error: 'Missing or invalid required fields' }, { status: 400 });
    }

    const items = await readRegistryData();
    const itemIndex = items.findIndex(item => item.id === itemId);

    if (itemIndex === -1) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    const item = items[itemIndex];

    // Check if item is already purchased/fully funded
    if (item.purchased) {
      return NextResponse.json({ error: 'This item has already been claimed or fully funded.' }, { status: 400 });
    }

    const contributionAmount = Number(amount) || 0;

    if (item.isGroupGift) {
        // Group Gift Logic
        if (contributionAmount <= 0) {
             return NextResponse.json({ error: 'Contribution amount must be positive.' }, { status: 400 });
        }
        const remainingNeeded = item.price - item.amountContributed;
        if (contributionAmount > remainingNeeded) {
             return NextResponse.json({ error: `Contribution exceeds remaining amount needed ($${remainingNeeded.toFixed(2)}).` }, { status: 400 });
        }

        item.amountContributed += contributionAmount;
        const newContributor: Contributor = {
            name: contributorName,
            amount: contributionAmount,
            date: new Date().toISOString(),
        };
        item.contributors.push(newContributor);

        // Check if fully funded
        if (item.amountContributed >= item.price) {
            item.purchased = true; // Mark as fully funded
            item.amountContributed = item.price; // Cap contribution at price
        }
    } else {
        // Non-Group Gift (Claiming)
        // Amount is ignored here, claiming means taking the full item
        item.purchased = true;
        item.purchaserName = contributorName;
        item.amountContributed = item.price; // Mark as fully contributed
    }

    items[itemIndex] = item; // Update the item in the array
    await writeRegistryData(items); // Write updated data back to file

    // Return the updated item
    return NextResponse.json({ message: 'Contribution processed successfully', item });

  } catch (error) {
    console.error("Error processing contribution:", error);
    let errorMessage = 'Failed to process contribution';
    if (error instanceof Error) {
        errorMessage = error.message;
    }
    // Check if the error is due to file system issues (e.g., permissions)
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'EACCES') {
        errorMessage = 'Server error: Insufficient permissions to update registry data.';
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
    
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
