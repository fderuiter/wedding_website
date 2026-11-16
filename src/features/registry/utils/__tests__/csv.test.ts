import { parseRegistryCsv, parseRegistryPrice, generateRegistryCsvTemplate } from '../csv';

describe('Registry CSV Parsing and Validation', () => {
  it('parses valid CSV rows with standard headers', () => {
    const csv = `Product Name,Price,Category,Quantity,Description,Vendor URL,Image URL,Is Group Gift,Is Most Wanted
KitchenAid Stand Mixer,299.99,Kitchen,1,A great stand mixer,https://example.com/mixer,https://example.com/mixer.jpg,true,false
Dinner Plates Set,89.50,Dining,2,Set of 6 porcelain plates,https://example.com/plates,,false,true`;

    const result = parseRegistryCsv(csv);
    expect(result.totalRows).toBe(2);
    expect(result.validCount).toBe(2);
    expect(result.errorCount).toBe(0);

    const first = result.rows[0];
    expect(first.name).toBe('KitchenAid Stand Mixer');
    expect(first.price).toBe(299.99);
    expect(first.category).toBe('Kitchen');
    expect(first.quantity).toBe(1);
    expect(first.description).toBe('A great stand mixer');
    expect(first.vendorUrl).toBe('https://example.com/mixer');
    expect(first.imageUrl).toBe('https://example.com/mixer.jpg');
    expect(first.isGroupGift).toBe(true);
    expect(first.isMostWanted).toBe(false);
    expect(first.isValid).toBe(true);

    const second = result.rows[1];
    expect(second.name).toBe('Dinner Plates Set');
    expect(second.price).toBe(89.50);
    expect(second.category).toBe('Dining');
    expect(second.quantity).toBe(2);
    expect(second.isMostWanted).toBe(true);
    expect(second.isValid).toBe(true);
  });

  it('handles price formatting with dollar signs and commas', () => {
    expect(parseRegistryPrice('$1,249.99')).toBe(1249.99);
    expect(parseRegistryPrice('45.00')).toBe(45.0);
    expect(parseRegistryPrice('invalid')).toBeUndefined();
    expect(parseRegistryPrice('-10')).toBeUndefined();
    expect(parseRegistryPrice('0')).toBeUndefined();
  });

  it('identifies and reports per-item errors clearly for malformed rows', () => {
    const csv = `Product Name,Price,Category,Vendor URL
,199.99,Kitchen,https://example.com/item1
Toaster,not-a-price,Kitchen,https://example.com/item2
Blender,49.99,Kitchen,ftp://bad-protocol.com/blender
Coffee Maker,99.99,Kitchen,https://example.com/coffee`;

    const result = parseRegistryCsv(csv);
    expect(result.totalRows).toBe(4);
    expect(result.validCount).toBe(1);
    expect(result.errorCount).toBe(3);

    expect(result.rows[0].isValid).toBe(false);
    expect(result.rows[0].errors).toContain('Product name is required.');

    expect(result.rows[1].isValid).toBe(false);
    expect(result.rows[1].errors).toContain('Price must be a positive number.');

    expect(result.rows[2].isValid).toBe(false);
    expect(result.rows[2].errors).toContain('Vendor URL must begin with http:// or https://');

    expect(result.rows[3].isValid).toBe(true);
    expect(result.rows[3].name).toBe('Coffee Maker');
  });

  it('handles empty input gracefully', () => {
    const result = parseRegistryCsv('');
    expect(result.totalRows).toBe(0);
    expect(result.rows).toEqual([]);
  });

  it('parses up to 50 rows in under 100 milliseconds', () => {
    const rows = ['Product Name,Price,Category,Vendor URL'];
    for (let i = 1; i <= 50; i++) {
      rows.push(`Registry Item ${i},${(i * 10).toFixed(2)},Category ${i % 5},https://example.com/item/${i}`);
    }
    const csv = rows.join('\n');

    const start = performance.now();
    const result = parseRegistryCsv(csv);
    const durationMs = performance.now() - start;

    expect(result.totalRows).toBe(50);
    expect(result.validCount).toBe(50);
    expect(durationMs).toBeLessThan(100); // 100 ms is well under the 5-second constraint
  });

  it('generates a valid CSV template that parses cleanly', () => {
    const template = generateRegistryCsvTemplate();
    const result = parseRegistryCsv(template);
    expect(result.totalRows).toBeGreaterThan(0);
    expect(result.validCount).toBe(result.totalRows);
  });
});
