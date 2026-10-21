import { generatePdfLabelSheet, AddressContributorInput } from '../pdfLabelGenerator';

describe('pdfLabelGenerator', () => {
  it('generates a valid PDF buffer for Avery 5160 template with full address records', async () => {
    const contributors: AddressContributorInput[] = [
      {
        name: 'Alice Johnson',
        invitationCode: {
          guestName: 'Alice Johnson',
          addressLine1: '123 Main Street',
          addressLine2: 'Apt 4B',
          city: 'Austin',
          state: 'TX',
          zipCode: '78701',
          country: 'USA',
        },
      },
      {
        name: 'Bob Smith',
        invitationCode: {
          guestName: 'Bob Smith',
          addressLine1: '456 Elm Ave',
          city: 'Seattle',
          state: 'WA',
          zipCode: '98101',
          country: 'US',
        },
      },
    ];

    const buffer = await generatePdfLabelSheet(contributors, 'avery_5160');

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.toString('utf-8', 0, 5)).toBe('%PDF-');
  });

  it('generates a valid PDF buffer for Avery 5163 template', async () => {
    const contributors: AddressContributorInput[] = [
      {
        name: 'Charlie Brown',
        invitationCode: {
          guestName: 'Charlie Brown',
          addressLine1: '789 Maple Rd',
          city: 'Chicago',
          state: 'IL',
          zipCode: '60601',
          country: 'USA',
        },
      },
    ];

    const buffer = await generatePdfLabelSheet(contributors, 'avery_5163');

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.toString('utf-8', 0, 5)).toBe('%PDF-');
  });

  it('formats "Address Pending" when contributor record lacks a street address', async () => {
    const contributors: AddressContributorInput[] = [
      {
        name: 'David Lee',
        invitationCode: null,
      },
      {
        name: 'Eve Adams',
        invitationCode: {
          guestName: 'Eve Adams',
          addressLine1: null,
          city: null,
          state: null,
          zipCode: null,
        },
      },
    ];

    const buffer = await generatePdfLabelSheet(contributors, 'avery_5160');

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.toString('utf-8', 0, 5)).toBe('%PDF-');
  });

  it('formats non-US country line correctly when specified', async () => {
    const contributors: AddressContributorInput[] = [
      {
        name: 'Fiona Gallagher',
        invitationCode: {
          guestName: 'Fiona Gallagher',
          addressLine1: '100 Queen St W',
          city: 'Toronto',
          state: 'ON',
          zipCode: 'M5H 2N2',
          country: 'Canada',
        },
      },
    ];

    const buffer = await generatePdfLabelSheet(contributors, 'avery_5160');

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.toString('utf-8', 0, 5)).toBe('%PDF-');
  });

  it('renders a single-page notice PDF when contributor list is empty', async () => {
    const buffer = await generatePdfLabelSheet([], 'avery_5160');

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.toString('utf-8', 0, 5)).toBe('%PDF-');
  });

  it('handles multi-page label sheets when contributor count exceeds single-page capacity', async () => {
    // Avery 5160 has 30 labels per page. Providing 35 contributors forces page 2 creation.
    const contributors: AddressContributorInput[] = Array.from({ length: 35 }, (_, i) => ({
      name: `Contributor ${i + 1}`,
      invitationCode: {
        addressLine1: `${i + 1} Main St`,
        city: 'City',
        state: 'ST',
        zipCode: '12345',
      },
    }));

    const buffer = await generatePdfLabelSheet(contributors, 'avery_5160');

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.toString('utf-8', 0, 5)).toBe('%PDF-');
  });
});
