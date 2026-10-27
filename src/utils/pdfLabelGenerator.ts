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

export interface LabelThemeOptions {
  fontFamily?: string;
  fontHeading?: string;
  fontBody?: string;
  textColor?: string;
  primaryColor?: string;
  themeTokens?: Record<string, string>;
}

export function resolvePdfFont(fontInput?: string): 'Helvetica' | 'Times-Roman' | 'Courier' | string {
  if (!fontInput || typeof fontInput !== 'string') {
    return 'Helvetica';
  }

  const str = fontInput.toLowerCase();

  if (str === 'times-roman' || str === 'times') return 'Times-Roman';
  if (str === 'helvetica' || str === 'arial') return 'Helvetica';
  if (str === 'courier') return 'Courier';

  if (str.includes('monospace') || str.includes('mono') || str.includes('courier')) {
    return 'Courier';
  }

  if (str.includes('sans-serif') || str.includes('sans') || str.includes('helvetica') || str.includes('arial') || str.includes('inter')) {
    return 'Helvetica';
  }

  if (str.includes('serif') || str.includes('georgia') || str.includes('times') || str.includes('playfair') || str.includes('bodoni') || str.includes('cormorant') || str.includes('spectral')) {
    return 'Times-Roman';
  }

  return 'Helvetica';
}

export function resolvePdfColor(colorInput?: string, fallback: string = '#111827'): string {
  if (!colorInput || typeof colorInput !== 'string') {
    return fallback;
  }

  const trimmed = colorInput.trim();
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)) {
    return trimmed;
  }

  const hexMatch = trimmed.match(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})/);
  if (hexMatch) {
    return hexMatch[0];
  }

  return fallback;
}

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

export type ChunkFetcher = (cursor?: string) => Promise<{ items: AddressContributorInput[]; nextCursor?: string | null }>;

export function generatePdfLabelSheetStream(
  fetcher: ChunkFetcher | AddressContributorInput[],
  template: LabelTemplate = 'avery_5160',
  themeOptions?: LabelThemeOptions
): ReadableStream<Uint8Array> {
  const config = LABEL_TEMPLATES[template] || LABEL_TEMPLATES.avery_5160;

  const headingFontInput =
    themeOptions?.fontHeading ||
    themeOptions?.themeTokens?.['--font-heading'];

  const bodyFontInput =
    themeOptions?.fontBody ||
    themeOptions?.fontFamily ||
    themeOptions?.themeTokens?.['--font-body'];

  const resolvedBodyFont = resolvePdfFont(bodyFontInput);
  const resolvedHeadingFont = resolvePdfFont(headingFontInput || bodyFontInput);

  const textColorInput =
    themeOptions?.textColor ||
    themeOptions?.themeTokens?.['--print-text'];

  const primaryColorInput =
    themeOptions?.primaryColor ||
    themeOptions?.themeTokens?.['--heading-color'] ||
    themeOptions?.themeTokens?.['--btn-primary-bg'];

  const resolvedTextColor = resolvePdfColor(textColorInput, '#111827');
  const resolvedPrimaryColor = resolvePdfColor(primaryColorInput, resolvedTextColor);

  const chunkFetcher: ChunkFetcher = typeof fetcher === 'function'
    ? fetcher
    : async (cursor) => {
      if (cursor) return { items: [], nextCursor: null };
      return { items: fetcher, nextCursor: null };
    };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const doc = new PDFDocument({
        autoFirstPage: false,
        size: 'letter',
        margin: 0,
      });

      doc.on('data', (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      doc.on('end', () => {
        controller.close();
      });
      doc.on('error', (err: Error) => {
        controller.error(err);
      });

      try {
        let cursor: string | undefined = undefined;
        let labelOnPageCount = 0;
        let totalItemsProcessed = 0;

        while (true) {
          const { items, nextCursor } = await chunkFetcher(cursor);
          if (!items || items.length === 0) {
            break;
          }

          for (const contributor of items) {
            totalItemsProcessed++;

            if (labelOnPageCount === 0) {
              doc.addPage();
            }

            const row = Math.floor(labelOnPageCount / config.columns);
            const col = labelOnPageCount % config.columns;

            const x = config.marginLeft + col * (config.labelWidth + config.columnGap);
            const y = config.marginTop + row * (config.labelHeight + config.rowGap);

            const innerX = x + config.padding;
            const innerY = y + config.padding;
            const innerWidth = config.labelWidth - config.padding * 2;
            const innerHeight = config.labelHeight - config.padding * 2;

            const lines = formatAddressLines(contributor);

            const lineHeight = config.fontSize + config.lineGap;
            const totalTextHeight = lines.length * lineHeight;
            const startY = Math.max(innerY, innerY + (innerHeight - totalTextHeight) / 2);

            lines.forEach((line, lineIdx) => {
              const lineY = startY + lineIdx * lineHeight;
              const isNameLine = lineIdx === 0;
              const fontToUse = isNameLine ? resolvedHeadingFont : resolvedBodyFont;
              const colorToUse = isNameLine ? resolvedPrimaryColor : resolvedTextColor;

              doc
                .font(fontToUse)
                .fontSize(config.fontSize)
                .fillColor(colorToUse)
                .text(line, innerX, lineY, {
                  width: innerWidth,
                  height: lineHeight,
                  align: 'left',
                  lineBreak: false,
                });
            });

            labelOnPageCount++;
            if (labelOnPageCount >= config.labelsPerPage) {
              labelOnPageCount = 0;
            }
          }

          if (!nextCursor || nextCursor === cursor) {
            break;
          }
          cursor = nextCursor;
        }

        if (totalItemsProcessed === 0) {
          doc.addPage();
          doc
            .font(resolvedBodyFont)
            .fontSize(10)
            .fillColor(resolvedTextColor)
            .text('No contributor records found for label export.', config.marginLeft, config.marginTop);
        }

        doc.end();
      } catch (err) {
        controller.error(err instanceof Error ? err : new Error(String(err)));
      }
    },
  });
}

export async function generatePdfLabelSheet(
  contributors: AddressContributorInput[],
  template: LabelTemplate = 'avery_5160',
  themeOptions?: LabelThemeOptions
): Promise<Buffer> {
  const stream = generatePdfLabelSheetStream(contributors, template, themeOptions);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}
