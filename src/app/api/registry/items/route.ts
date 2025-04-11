import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { RegistryItem } from '@/types/registry';

export async function GET() {
  try {
    // Construct the absolute path to the JSON file
    const filePath = path.join(process.cwd(), 'src', 'data', 'registry.json');
    
    // Read the JSON file
    const jsonData = await fs.readFile(filePath, 'utf8');
    
    // Parse the JSON data
    const items: RegistryItem[] = JSON.parse(jsonData);
    
    // Return the items as a JSON response
    return NextResponse.json(items);
  } catch (error) {
    console.error("Error reading registry file: ", error);
    // Return an error response
    return NextResponse.json({ error: 'Failed to load registry items' }, { status: 500 });
  }
}
