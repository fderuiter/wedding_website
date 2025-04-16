import { NextResponse } from 'next/server';
import { RegistryService } from '@/services/registryService';

export async function GET() {
  try {
    const items = await RegistryService.getAllItems();
    return NextResponse.json(items);
  } catch (error) {
    console.error("Error reading registry items: ", error);
    return NextResponse.json({ error: 'Failed to load registry items' }, { status: 500 });
  }
}
