import { parseCsvContent } from '@/utils/csv';

export const MAX_REGISTRY_CSV_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

export interface ParsedRegistryItemRow {
  id: string;
  rowIndex: number;
  name: string;
  price: number | undefined;
  category: string;
  description: string;
  vendorUrl: string;
  imageUrl: string;
  imageAlt?: string;
  quantity: number;
  isGroupGift: boolean;
  isMostWanted: boolean;
  isValid: boolean;
  errors: string[];
}

export interface RegistryCsvParseResult {
  headers: string[];
  rows: ParsedRegistryItemRow[];
  totalRows: number;
  validCount: number;
  errorCount: number;
}

/**
 * Normalizes header string for comparison.
 */
function normalizeHeader(h: string): string {
  return (h || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parses numeric price from string, stripping currency symbols and commas.
 */
export function parseRegistryPrice(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') {
    return isNaN(value) || !isFinite(value) || value <= 0 ? undefined : Math.round(value * 100) / 100;
  }
  const str = String(value).trim().replace(/,/g, '');
  const match = str.match(/-?\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const num = parseFloat(match[0]);
  if (isNaN(num) || !isFinite(num) || num <= 0) return undefined;
  return Math.round(num * 100) / 100;
}

/**
 * Validates a single registry item row.
 */
export function validateRegistryItemRow(
  data: Partial<ParsedRegistryItemRow>
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  const name = (data.name || '').trim();
  if (!name) {
    errors.push('Product name is required.');
  } else if (name.length > 255) {
    errors.push('Product name must be under 255 characters.');
  }

  const price = data.price;
  if (price === undefined || isNaN(price) || price <= 0) {
    errors.push('Price must be a positive number.');
  }

  const vendorUrl = (data.vendorUrl || '').trim();
  if (vendorUrl) {
    try {
      const parsed = new URL(vendorUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        errors.push('Vendor URL must begin with http:// or https://');
      }
    } catch {
      errors.push('Invalid vendor URL format.');
    }
  }

  const quantity = data.quantity;
  if (quantity !== undefined && (!Number.isInteger(quantity) || quantity <= 0)) {
    errors.push('Quantity must be a positive integer.');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Parses CSV text content into structured, validated registry item rows.
 */
export function parseRegistryCsv(text: string): RegistryCsvParseResult {
  if (!text || !text.trim()) {
    return {
      headers: [],
      rows: [],
      totalRows: 0,
      validCount: 0,
      errorCount: 0,
    };
  }

  const parsed = parseCsvContent(text);
  const headers = parsed.headers || [];
  const rawRows = parsed.rows || [];

  // Determine column mappings based on aliases
  const normalizedHeaders = headers.map(normalizeHeader);

  const findCol = (aliases: string[]): string | undefined => {
    for (let i = 0; i < normalizedHeaders.length; i++) {
      const h = normalizedHeaders[i];
      for (const alias of aliases) {
        if (h === alias || h.includes(alias)) {
          return headers[i];
        }
      }
    }
    return undefined;
  };

  const nameCol = findCol(['product name', 'item name', 'name', 'title', 'product']);
  const priceCol = findCol(['price', 'cost', 'amount', 'unit price']);
  const categoryCol = findCol(['category', 'department', 'group', 'type']);
  const descCol = findCol(['description', 'item description', 'details', 'notes', 'desc']);
  const vendorUrlCol = findCol(['vendor url', 'vendor link', 'product url', 'product link', 'store url', 'vendor', 'url', 'link']);
  const imageUrlCol = findCol(['image url', 'image link', 'photo url', 'photo', 'picture', 'image']);
  const imageAltCol = findCol(['image alt', 'alt text', 'alt']);
  const quantityCol = findCol(['quantity', 'qty', 'count', 'amount needed']);
  const isGroupGiftCol = findCol(['is group gift', 'group gift', 'allow group gift', 'group']);
  const isMostWantedCol = findCol(['is most wanted', 'most wanted', 'featured', 'starred']);

  const rows: ParsedRegistryItemRow[] = [];

  rawRows.forEach((r, idx) => {
    // Skip completely empty rows
    const allEmpty = Object.values(r).every((v) => !v || !v.trim());
    if (allEmpty) return;

    const rawName = nameCol ? r[nameCol] : r['name'] || r['Name'] || r['Title'] || '';
    const rawPrice = priceCol ? r[priceCol] : r['price'] || r['Price'] || r['Cost'] || '';
    const rawCategory = categoryCol ? r[categoryCol] : r['category'] || r['Category'] || '';
    const rawDesc = descCol ? r[descCol] : r['description'] || r['Description'] || '';
    const rawVendorUrl = vendorUrlCol ? r[vendorUrlCol] : r['vendorUrl'] || r['Vendor URL'] || r['url'] || r['URL'] || '';
    const rawImageUrl = imageUrlCol ? r[imageUrlCol] : r['imageUrl'] || r['Image URL'] || r['image'] || '';
    const rawImageAlt = imageAltCol ? r[imageAltCol] : r['imageAlt'] || r['Image Alt'] || '';
    const rawQuantity = quantityCol ? r[quantityCol] : r['quantity'] || r['Quantity'] || '';
    const rawGroup = isGroupGiftCol ? r[isGroupGiftCol] : r['isGroupGift'] || r['Is Group Gift'] || '';
    const rawMostWanted = isMostWantedCol ? r[isMostWantedCol] : r['isMostWanted'] || r['Is Most Wanted'] || '';

    const name = (rawName || '').trim();
    const price = parseRegistryPrice(rawPrice);
    const category = (rawCategory || '').trim() || 'Uncategorized';
    const description = (rawDesc || '').trim();
    const vendorUrl = (rawVendorUrl || '').trim();
    const imageUrl = (rawImageUrl || '').trim();
    const imageAlt = (rawImageAlt || '').trim();

    let quantity = 1;
    if (rawQuantity && rawQuantity.trim()) {
      const parsedQty = parseInt(rawQuantity.trim(), 10);
      if (!isNaN(parsedQty) && parsedQty > 0) {
        quantity = parsedQty;
      }
    }

    const isGroupGift =
      rawGroup.toLowerCase() === 'true' ||
      rawGroup.toLowerCase() === 'yes' ||
      rawGroup.toLowerCase() === '1' ||
      rawGroup.toLowerCase() === 'y';

    const isMostWanted =
      rawMostWanted.toLowerCase() === 'true' ||
      rawMostWanted.toLowerCase() === 'yes' ||
      rawMostWanted.toLowerCase() === '1' ||
      rawMostWanted.toLowerCase() === 'y';

    const validation = validateRegistryItemRow({
      name,
      price,
      vendorUrl,
      quantity,
    });

    rows.push({
      id: `csv-row-${idx + 1}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      rowIndex: idx + 1,
      name,
      price,
      category,
      description,
      vendorUrl,
      imageUrl,
      imageAlt: imageAlt || undefined,
      quantity,
      isGroupGift,
      isMostWanted,
      isValid: validation.isValid,
      errors: validation.errors,
    });
  });

  const validCount = rows.filter((r) => r.isValid).length;
  const errorCount = rows.length - validCount;

  return {
    headers,
    rows,
    totalRows: rows.length,
    validCount,
    errorCount,
  };
}

/**
 * Generates sample CSV template string for couple download.
 */
export function generateRegistryCsvTemplate(): string {
  const sampleHeaders = [
    'Product Name',
    'Price',
    'Category',
    'Quantity',
    'Description',
    'Vendor URL',
    'Image URL',
    'Is Group Gift',
    'Is Most Wanted',
  ];

  const sampleRows = [
    [
      'KitchenAid Artisan Series 5-Quart Stand Mixer',
      '449.99',
      'Kitchen',
      '1',
      'Classic stand mixer in Matte Black with 10 speeds and stainless steel bowl.',
      'https://www.target.com/p/kitchenaid-artisan-stand-mixer/-/A-12345678',
      'https://target.scene7.com/is/image/Target/GUEST_123',
      'true',
      'true',
    ],
    [
      'Le Creuset Enameled Cast Iron Dutch Oven, 5.5 Qt',
      '420.00',
      'Cookware',
      '1',
      'Round Dutch oven for slow-cooking, braising, and roasting.',
      'https://www.amazon.com/dp/B00005IFEF',
      'https://images.amazon.com/images/P/B00005IFEF.01.LZZZZZZZ.jpg',
      'true',
      'false',
    ],
    [
      'Brooklinen Luxe Sateen Core Sheet Set - Queen',
      '189.00',
      'Bedding',
      '2',
      '480 thread count sateen sheets in Solid White.',
      'https://www.brooklinen.com/products/luxe-sateen-core-sheet-set',
      '',
      'false',
      'false',
    ],
  ];

  const escapeCell = (val: string): string => {
    if (val.includes(',') || val.includes('"') || val.includes('\n')) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  };

  const headerLine = sampleHeaders.map(escapeCell).join(',');
  const rowLines = sampleRows.map((row) => row.map(escapeCell).join(','));

  return [headerLine, ...rowLines].join('\n');
}
