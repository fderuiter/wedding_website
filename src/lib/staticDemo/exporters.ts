import { createIcsFile, formatScheduleEventToCalendarEvent } from '@/utils/calendar';
import type {
  DemoAppConfigRecord,
  DemoContributorRecord,
  DemoInvitationCodeRecord,
  DemoRegistryItemRecord,
  DemoSeatingTableRecord,
  DemoSubEventRecord,
  StaticDemoSnapshot,
} from './types';
import { STATIC_DEMO_BACKUP_SCHEMA_VERSION } from './types';

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  const formulaSafe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  if (/[",\r\n]/.test(formulaSafe)) {
    return `"${formulaSafe.replace(/"/g, '""')}"`;
  }
  return formulaSafe;
}

function buildCsvDocument(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((row) => row.map(escapeCsvCell).join(',')),
  ];
  return lines.join('\r\n');
}

export function buildInvitationCodesCsv(
  invitations: DemoInvitationCodeRecord[],
  tables: DemoSeatingTableRecord[],
): string {
  const tableById = new Map(tables.map((t) => [t.id, t.name]));
  return buildCsvDocument(
    [
      'Code',
      'Guest Name',
      'Email',
      'Household',
      'Party Group',
      'Party Tags',
      'Plus Ones',
      'Dietary Notes',
      'Table',
      'Seat',
      'Used',
      'Address Line 1',
      'City',
      'State',
      'Zip',
      'Country',
    ],
    invitations.map((inv) => [
      inv.code,
      inv.guestName,
      inv.email ?? '',
      inv.householdName ?? '',
      inv.partyGroup ?? '',
      (inv.partyTags ?? []).join('; '),
      inv.plusOneAllocations ?? 0,
      inv.dietaryNotes ?? '',
      inv.tableId ? (tableById.get(inv.tableId) ?? '') : '',
      inv.seatNumber ?? '',
      inv.used ? 'Yes' : 'No',
      inv.addressLine1 ?? '',
      inv.city ?? '',
      inv.state ?? '',
      inv.zipCode ?? '',
      inv.country ?? '',
    ]),
  );
}

export function buildSeatingCsv(
  tables: DemoSeatingTableRecord[],
  invitations: DemoInvitationCodeRecord[],
): string {
  const tableById = new Map(tables.map((t) => [t.id, t]));
  const assigned = invitations.filter((inv) => Boolean(inv.tableId));
  return buildCsvDocument(
    ['Table Name', 'Shape', 'Capacity', 'Seat Number', 'Guest Name', 'Household', 'Dietary Notes'],
    assigned.map((inv) => {
      const table = inv.tableId ? tableById.get(inv.tableId) : undefined;
      return [
        table?.name ?? 'Unassigned',
        table?.shape ?? '',
        table?.capacity ?? '',
        inv.seatNumber ?? '',
        inv.guestName,
        inv.householdName ?? '',
        inv.dietaryNotes ?? '',
      ];
    }),
  );
}

export function buildThankYouNotesCsv(
  contributors: DemoContributorRecord[],
  items: DemoRegistryItemRecord[],
  invitations: DemoInvitationCodeRecord[],
): string {
  const itemById = new Map(items.map((item) => [item.id, item.name]));
  const inviteById = new Map(invitations.map((inv) => [inv.id, inv]));
  return buildCsvDocument(
    [
      'Contributor Name',
      'Email',
      'Gift Item',
      'Amount',
      'Contribution Status',
      'Thank-You Status',
      'Sent At',
      'Note',
      'Mailing Address',
    ],
    contributors.map((c) => {
      const inv = c.invitationCodeId ? inviteById.get(c.invitationCodeId) : undefined;
      const address = inv
        ? [inv.addressLine1, inv.city, inv.state, inv.zipCode].filter(Boolean).join(', ')
        : '';
      return [
        c.name,
        c.email ?? '',
        c.registryItemId ? (itemById.get(c.registryItemId) ?? 'Wedding Gift') : 'Wedding Gift',
        c.amount.toFixed(2),
        c.status,
        c.thankYouStatus,
        c.thankYouSentAt ?? '',
        c.thankYouNote ?? '',
        address,
      ];
    }),
  );
}

function escapePdfText(text: string): string {
  return text
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

/**
 * Generates a valid, standards-compliant single-page PDF document purely in TypeScript
 * without importing Node-only `pdfkit` or `fontkit`.
 */
export function buildSimplePdfBytes(title: string, lines: string[]): Uint8Array {
  const safeLines = [title, '', ...lines].slice(0, 42);
  const contentCommands = ['BT', '/F1 14 Tf', '50 750 Td'];

  safeLines.forEach((line, index) => {
    if (index === 1) {
      contentCommands.push('/F1 10 Tf');
    }
    if (index > 0) {
      contentCommands.push('0 -16 Td');
    }
    contentCommands.push(`(${escapePdfText(line.slice(0, 95))}) Tj`);
  });
  contentCommands.push('ET');

  const streamContent = contentCommands.join('\n');
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream\nendobj\n`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj;
  }

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return new TextEncoder().encode(pdf);
}

function computeCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Generates a valid uncompressed (STORE) `.zip` archive in memory without Node `archiver`.
 */
export function buildStoredZipBytes(
  entries: Array<{ filename: string; data: Uint8Array }>,
): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.filename.replace(/^\/+/, '') || 'photo.txt');
    const data = entry.data;
    const crc = computeCrc32(data);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0x21, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0x21, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    localParts.push(localHeader, data);
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const centralSize = centralParts.reduce((acc, part) => acc + part.length, 0);
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true);

  const totalLength = offset + centralSize + endRecord.length;
  const output = new Uint8Array(totalLength);
  let cursor = 0;
  for (const part of [...localParts, ...centralParts, endRecord]) {
    output.set(part, cursor);
    cursor += part.length;
  }
  return output;
}

export function buildSubEventIcs(
  event: DemoSubEventRecord,
  config?: DemoAppConfigRecord,
): { filename: string; content: string } {
  const calendarEvent = formatScheduleEventToCalendarEvent(
    {
      id: event.id,
      title: event.title,
      startTime: event.startTime || undefined,
      endTime: event.endTime || undefined,
      locationName: event.locationName || undefined,
      location: event.location || undefined,
      attireRules: event.attireRules || undefined,
      description: event.description || undefined,
    },
    undefined,
    config?.timezone || 'UTC',
  );
  const icsContent =
    createIcsFile(calendarEvent) ||
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Wedding Showcase//EN',
      'BEGIN:VEVENT',
      `UID:${event.id}@wedding.showcase`,
      `SUMMARY:${event.title}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
  const cleanTitle = (event.title || 'event').replace(/["\r\n\t]/g, '').trim() || 'event';
  return {
    filename: `${cleanTitle}.ics`,
    content: icsContent,
  };
}

export function buildBackupExportPayload(snapshot: StaticDemoSnapshot): Record<string, unknown> {
  return {
    version: STATIC_DEMO_BACKUP_SCHEMA_VERSION,
    schemaVersion: STATIC_DEMO_BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    appConfig: snapshot.appConfig.map(({ contactPhone: _contactPhone, ...rest }) => rest),
    contentNode: snapshot.contentNode,
    media: snapshot.media,
    seatingTable: snapshot.seatingTable,
    invitationCode: snapshot.invitationCode,
    weddingPartyMember: snapshot.weddingPartyMember,
    attraction: snapshot.attraction,
    registryItem: snapshot.registryItem,
    contributor: snapshot.contributor,
    subEvent: snapshot.subEvent.map(({ attireRules: _attireRules, ...rest }) => rest),
    subEventAccess: snapshot.subEventAccess,
    subEventRsvp: snapshot.subEventRsvp,
    broadcastMessage: snapshot.broadcastMessage,
    broadcastRecipient: snapshot.broadcastRecipient,
    snapshotVersion: snapshot.snapshotVersion,
  };
}
