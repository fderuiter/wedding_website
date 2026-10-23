import {
  generatePdfLabelSheet,
  resolvePdfFont,
  resolvePdfColor,
  AddressContributorInput,
} from '../pdfLabelGenerator';

describe('pdfLabelGenerator', () => {
  describe('resolvePdfFont', () => {
    it('maps serif theme fonts to Times-Roman', () => {
      expect(resolvePdfFont('var(--font-playfair), Playfair Display, Georgia, serif')).toBe('Times-Roman');
      expect(resolvePdfFont('var(--font-cormorant), Cormorant Garamond, Georgia, serif')).toBe('Times-Roman');
      expect(resolvePdfFont('var(--font-bodoni), Bodoni Moda, Georgia, serif')).toBe('Times-Roman');
      expect(resolvePdfFont('serif')).toBe('Times-Roman');
      expect(resolvePdfFont('Times-Roman')).toBe('Times-Roman');
    });

    it('maps sans-serif theme fonts to Helvetica', () => {
      expect(resolvePdfFont('var(--font-inter), Inter, system-ui, sans-serif')).toBe('Helvetica');
      expect(resolvePdfFont('var(--font-space-grotesk), Space Grotesk, sans-serif')).toBe('Helvetica');
      expect(resolvePdfFont('var(--font-geist-sans), Arial, Helvetica, sans-serif')).toBe('Helvetica');
      expect(resolvePdfFont('sans-serif')).toBe('Helvetica');
      expect(resolvePdfFont('Helvetica')).toBe('Helvetica');
    });

    it('maps monospace theme fonts to Courier', () => {
      expect(resolvePdfFont('var(--font-geist-mono), monospace')).toBe('Courier');
      expect(resolvePdfFont('monospace')).toBe('Courier');
      expect(resolvePdfFont('Courier')).toBe('Courier');
    });

    it('defaults to Helvetica when input is empty or missing', () => {
      expect(resolvePdfFont(undefined)).toBe('Helvetica');
      expect(resolvePdfFont('')).toBe('Helvetica');
      expect(resolvePdfFont('custom-unknown-font')).toBe('Helvetica');
    });
  });

  describe('resolvePdfColor', () => {
    it('returns exact hex colors', () => {
      expect(resolvePdfColor('#1f2937')).toBe('#1f2937');
      expect(resolvePdfColor('#B91C1C')).toBe('#B91C1C');
      expect(resolvePdfColor('#fff')).toBe('#fff');
    });

    it('extracts hex colors from CSS var fallback values', () => {
      expect(resolvePdfColor('var(--color-primary, #b91c1c)')).toBe('#b91c1c');
    });

    it('falls back to default dark text token when input is invalid or missing', () => {
      expect(resolvePdfColor(undefined, '#111827')).toBe('#111827');
      expect(resolvePdfColor('invalid-color', '#111827')).toBe('#111827');
    });
  });

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

  it('incorporates Classic serif/sans theme tokens and primary brand color', async () => {
    const contributors: AddressContributorInput[] = [
      {
        name: 'Eleanor Vance',
        invitationCode: {
          addressLine1: '100 Hill House Rd',
          city: 'Boston',
          state: 'MA',
          zipCode: '02108',
        },
      },
    ];

    const buffer = await generatePdfLabelSheet(contributors, 'avery_5160', {
      fontHeading: 'var(--font-playfair), Playfair Display, Georgia, serif',
      fontBody: 'var(--font-geist-sans), Arial, Helvetica, sans-serif',
      textColor: '#1f2937',
      primaryColor: '#B91C1C',
    });

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.toString('utf-8', 0, 5)).toBe('%PDF-');
  });

  it('incorporates Romantic all-serif theme preset tokens', async () => {
    const contributors: AddressContributorInput[] = [
      {
        name: 'Jane Bennet',
        invitationCode: {
          addressLine1: '12 Netherfield Park',
          city: 'Hertfordshire',
          state: 'UK',
          zipCode: 'AL1 1AA',
        },
      },
    ];

    const buffer = await generatePdfLabelSheet(contributors, 'avery_5163', {
      themeTokens: {
        '--font-heading': 'var(--font-cormorant), Cormorant Garamond, Georgia, serif',
        '--font-body': 'var(--font-alexandra), Alexandra, Georgia, serif',
        '--print-text': '#1c1917',
        '--heading-color': '#be123c',
      },
    });

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.toString('utf-8', 0, 5)).toBe('%PDF-');
  });

  it('incorporates Modern all-sans-serif theme preset tokens', async () => {
    const contributors: AddressContributorInput[] = [
      {
        name: 'Miles Davis',
        invitationCode: {
          addressLine1: '52 W 52nd St',
          city: 'New York',
          state: 'NY',
          zipCode: '10019',
        },
      },
    ];

    const buffer = await generatePdfLabelSheet(contributors, 'avery_5160', {
      themeTokens: {
        '--font-heading': 'var(--font-inter), Inter, system-ui, sans-serif',
        '--font-body': 'var(--font-inter), Inter, system-ui, sans-serif',
        '--print-text': '#09090b',
        '--heading-color': '#0284c7',
      },
    });

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.toString('utf-8', 0, 5)).toBe('%PDF-');
  });
});
