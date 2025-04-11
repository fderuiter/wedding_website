// src/app/api/registry/items/[id]/route.ts
import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { RegistryItem } from '@/types/registry';

const dataFilePath = path.join(process.cwd(), 'src', 'data', 'registry.json');

// Helper function to read data
async function readRegistryData(): Promise<RegistryItem[]> {
  try {
    const jsonData = await fs.readFile(dataFilePath, 'utf8');
    return JSON.parse(jsonData);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []; // Return empty array if file doesn't exist
    }
    console.error("Error reading registry file:", error);
    throw new Error('Failed to read registry data');
  }
}

// Helper function to write data
async function writeRegistryData(data: RegistryItem[]): Promise<void> {
  try {
    await fs.writeFile(dataFilePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error("Error writing registry file:", error);
    throw new Error('Failed to write registry data');
  }
}

// GET Handler (Fetch single item - useful for edit page)
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  // Add Authentication check here in a real app
  const itemId = params.id;
  try {
    const items = await readRegistryData();
    const item = items.find(i => i.id === itemId);

    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }
    return NextResponse.json(item);
  } catch (error) {
    console.error("Error fetching item:", error);
    return NextResponse.json({ error: 'Failed to fetch item data' }, { status: 500 });
  }
}


// PUT Handler (Update item)
export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  // Add Authentication check here in a real app
  const itemId = params.id;
  try {
    const updatedData = await request.json();
    const items = await readRegistryData();

    const itemIndex = items.findIndex(i => i.id === itemId);

    if (itemIndex === -1) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    // Basic validation (add more as needed)
    if (!updatedData.name || typeof updatedData.price !== 'number' || typeof updatedData.quantity !== 'number') {
        return NextResponse.json({ error: 'Missing or invalid required fields (name, price, quantity)' }, { status: 400 });
    }

    // Merge existing item with updated data, preserving fields not sent in request
    // Important: Keep existing contribution data if it's a group gift unless explicitly changed
    const existingItem = items[itemIndex];
    items[itemIndex] = {
      ...existingItem, // Keep existing fields like id, purchased status, contributions etc.
      ...updatedData, // Overwrite with new data
      price: Number(updatedData.price), // Ensure numbers are numbers
      quantity: Number(updatedData.quantity),
      // Ensure boolean fields are handled correctly
      isGroupGift: updatedData.isGroupGift === true || updatedData.isGroupGift === 'on',
      // Do NOT reset contribution data unless intended by the update logic
      // amountContributed: updatedData.amountContributed ?? existingItem.amountContributed,
      // contributors: updatedData.contributors ?? existingItem.contributors,
    };

    await writeRegistryData(items);

    return NextResponse.json({ message: 'Item updated successfully', item: items[itemIndex] });

  } catch (error) {
    console.error("Error updating item:", error);
    let errorMessage = 'Failed to update item';
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

// DELETE Handler (Remove item)
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  // Add Authentication check here in a real app
  const itemId = params.id;
  try {
    const items = await readRegistryData();
    const initialLength = items.length;
    const filteredItems = items.filter(i => i.id !== itemId);

    if (filteredItems.length === initialLength) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    await writeRegistryData(filteredItems);

    return NextResponse.json({ message: 'Item deleted successfully' }, { status: 200 }); // Use 200 or 204

  } catch (error) {
    console.error("Error deleting item:", error);
    return NextResponse.json({ error: 'Failed to delete item' }, { status: 500 });
  }
}
