// src/app/api/registry/add-item/route.ts
import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { RegistryItem } from '@/types/registry';
import { v4 as uuidv4 } from 'uuid'; // For generating unique IDs
import { validateAddItemInput } from '@/utils/validation';

// Helper function to read data (Consider moving to a shared utils file)
async function readRegistryData(): Promise<RegistryItem[]> {
  const filePath = path.join(process.cwd(), 'src', 'data', 'registry.json');
  try {
    const jsonData = await fs.readFile(filePath, 'utf8');
    return JSON.parse(jsonData);
  } catch (error) {
    // If file doesn't exist or is empty, return empty array
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    console.error("Error reading registry file:", error);
    throw new Error('Failed to read registry data');
  }
}

// Helper function to write data (Consider moving to a shared utils file)
async function writeRegistryData(data: RegistryItem[]): Promise<void> {
  const filePath = path.join(process.cwd(), 'src', 'data', 'registry.json');
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error("Error writing registry file:", error);
    throw new Error('Failed to write registry data');
  }
}

export async function POST(request: Request) {
  // IMPORTANT: Add proper authentication/authorization checks here in a real app
  // For now, we assume the request is authenticated if it reaches here.
  try {
    const newItemData = await request.json();
    const validationError = validateAddItemInput(newItemData);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }
    const items = await readRegistryData();
    const newItem: RegistryItem = {
      id: uuidv4(),
      name: newItemData.name,
      description: newItemData.description || '',
      category: newItemData.category || 'Uncategorized',
      price: Number(newItemData.price),
      image: newItemData.image || '/images/placeholder.jpg',
      vendorUrl: newItemData.vendorUrl || null,
      quantity: Number(newItemData.quantity),
      isGroupGift: newItemData.isGroupGift || false,
      purchased: false,
      purchaserName: null,
      amountContributed: 0,
      contributors: [],
    };
    items.push(newItem);
    await writeRegistryData(items);
    return NextResponse.json({ message: 'Item added successfully', item: newItem }, { status: 201 });
  } catch (error) {
    console.error("Error adding item:", error);
    let errorMessage = 'Failed to add item to registry';
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
