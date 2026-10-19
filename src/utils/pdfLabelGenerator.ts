import type PDFDocumentClass from 'pdfkit';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';

function getPdfDocument(): typeof PDFDocumentClass {
  try {
    const url = typeof import.meta.url === 'string' && import.meta.url.startsWith('file:')
      ? import.meta.url
      : pathToFileURL(process.cwd() + '/node_modules/pdfkit/index.js').href;
    const req = createRequire(url);
    return req('pdfkit');
  } catch {
    const req = createRequire(pathToFileURL(process.cwd() + '/node_modules/pdfkit/index.js').href);
    return req('pdfkit');
  }
}

const PDFDocument = getPdfDocument();

export type LabelTemplate = 'avery_5160' | 'avery_5163';

interface LabelTemplateConfig {
  name: string;
  columns: number;
  rows: number;
  labelsPerPage: number;
  pageWidth: number; // pt (Letter = 612)
  pageHeight: number; // pt (Letter = 792)
  labelWidth: number; // pt
  labelHeight: number; // pt
  marginTop: number; // pt
  marginLeft: number; // pt
  columnGap: number; // pt
  rowGap: number; // pt
  padding: number; // pt
  fontSize: number; // pt
  lineGap: number; // pt
}

const LABEL_TEMPLATES: Record<LabelTemplate, LabelTemplateConfig> = {
  avery_5160: {
    name: 'Avery 5160 (1" x 2-5/8")',
    columns: 3,
    rows: 10,
    labelsPerPage: 30,
    pageWidth: 612,
    pageHeight: 792,
    labelWidth: 189,
    labelHeight: 72,
    marginTop: 36,
    marginLeft: 13.5,
    columnGap: 9,
    rowGap: 0,
    padding: 6,
    fontSize: 9,
    lineGap: 2,
  },
  avery_5163: {
    name: 'Avery 5163 (2" x 4")',
    columns: 2,
    rows: 5,
    labelsPerPage: 10,
    pageWidth: 612,
    pageHeight: 792,
    labelWidth: 288,
    labelHeight: 144,
    marginTop: 36,
    marginLeft: 12,
    columnGap: 12,
    rowGap: 0,
    padding: 12,
    fontSize: 12,
    lineGap: 3,
  },
};

export interface AddressContributorInput {
  name: string;
  invitationCode?: {
    guestName?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    state?: string | null;
    zipCode?: string | null;
    country?: string | null;
  } | null;
}

function formatAddressLines(data: AddressContributorInput): string[] {
  const lines: string[] = [];

  const name = (data.name || data.invitationCode?.guestName || '').trim();
  if (name) {
    lines.push(name);
  }

  const addr1 = data.invitationCode?.addressLine1?.trim();
  if (addr1) {
    lines.push(addr1);
  }

  const addr2 = data.invitationCode?.addressLine2?.trim();
  if (addr2) {
    lines.push(addr2);
  }

  const city = data.invitationCode?.city?.trim();
  const state = data.invitationCode?.state?.trim();
  const zipCode = data.invitationCode?.zipCode?.trim();

  let cityState = '';
  if (city && state) {
    cityState = `${city}, ${state}`;
  } else if (city) {
    cityState = city;
  } else if (state) {
    cityState = state;
  }

  if (cityState && zipCode) {
    lines.push(`${cityState} ${zipCode}`);
  } else if (cityState) {
    lines.push(cityState);
  } else if (zipCode) {
    lines.push(zipCode);
  }

  const country = data.invitationCode?.country?.trim();
  if (country && country.toUpperCase() !== 'USA' && country.toUpperCase() !== 'US') {
    lines.push(country);
  }

  if (lines.length === 0) {
    lines.push('Guest');
    lines.push('Address Pending');
  } else if (lines.length === 1 && lines[0] === name) {
    lines.push('Address Pending');
  }

  return lines;
}

export function generatePdfLabelSheet(
  contributors: AddressContributorInput[],
  template: LabelTemplate = 'avery_5160'
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const config = LABEL_TEMPLATES[template] || LABEL_TEMPLATES.avery_5160;

    const doc = new PDFDocument({
      autoFirstPage: false,
      size: 'letter',
      margin: 0,
    });

    const buffers: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', (err: Error) => reject(err));

    if (contributors.length === 0) {
      doc.addPage();
      doc.fontSize(10).text('No contributor records found for label export.', config.marginLeft, config.marginTop);
      doc.end();
      return;
    }

    let itemIndex = 0;
    while (itemIndex < contributors.length) {
      doc.addPage();

      for (let row = 0; row < config.rows; row++) {
        for (let col = 0; col < config.columns; col++) {
          if (itemIndex >= contributors.length) break;

          const contributor = contributors[itemIndex];
          itemIndex++;

          const x = config.marginLeft + col * (config.labelWidth + config.columnGap);
          const y = config.marginTop + row * (config.labelHeight + config.rowGap);

          const innerX = x + config.padding;
          const innerY = y + config.padding;
          const innerWidth = config.labelWidth - config.padding * 2;
          const innerHeight = config.labelHeight - config.padding * 2;

          const lines = formatAddressLines(contributor);

          doc.fontSize(config.fontSize);
          const lineHeight = config.fontSize + config.lineGap;
          const totalTextHeight = lines.length * lineHeight;
          const startY = Math.max(innerY, innerY + (innerHeight - totalTextHeight) / 2);

          doc.text(lines.join('\n'), innerX, startY, {
            width: innerWidth,
            height: innerHeight,
            align: 'left',
            lineGap: config.lineGap,
          });
        }
        if (itemIndex >= contributors.length) break;
      }
    }

    doc.end();
  });
}
