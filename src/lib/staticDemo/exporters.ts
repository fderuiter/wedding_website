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
    invitations.map((inv) => {
      const extraRecord =
        inv.extraFields && typeof inv.extraFields === 'object' ? inv.extraFields : null;
      const isDeclined =
        typeof extraRecord?.attendanceStatus === 'string' &&
        extraRecord.attendanceStatus.trim().toLowerCase() === 'declined';
      const confirmedPlusOnes =
        extraRecord && typeof extraRecord.plusOneCount === 'number'
          ? extraRecord.plusOneCount
          : null;
      return [
        inv.code,
        inv.guestName,
        inv.email ?? '',
        inv.householdName ?? '',
        inv.partyGroup ?? '',
        (inv.partyTags ?? []).join('; '),
        isDeclined ? 0 : (confirmedPlusOnes ?? inv.plusOneAllocations ?? 0),
        inv.dietaryNotes ?? '',
        inv.tableId ? (tableById.get(inv.tableId) ?? '') : '',
        inv.seatNumber ?? '',
        inv.used ? 'Yes' : 'No',
        inv.addressLine1 ?? '',
        inv.city ?? '',
        inv.state ?? '',
        inv.zipCode ?? '',
        inv.country ?? '',
      ];
    }),
  );
}

const DEMO_LANDMARK_SHAPES = new Set([
  'dance-floor',
  'bar',
  'dj',
  'buffet',
  'cake',
]);

export function isDemoLandmarkShape(shape: string | null | undefined): boolean {
  return typeof shape === 'string' && DEMO_LANDMARK_SHAPES.has(shape);
}

function resolveMealLabelMap(subEvents: DemoSubEventRecord[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const ev of subEvents) {
    for (const opt of ev.mealOptions ?? []) {
      if (opt.id && opt.label) {
        map.set(opt.id, opt.label);
      }
    }
  }
  return map;
}

function summarizeGuestRsvpFields(
  snapshot: StaticDemoSnapshot,
  inv: DemoInvitationCodeRecord,
  mealLabelById: Map<string, string>,
): {
  attendance: string;
  plusOneName: string;
  mealSelections: string[];
  customAnswers: string;
  headcount: number;
} {
  const rsvps = snapshot.subEventRsvp.filter((r) => r.invitationCodeId === inv.id);
  const hasAttending = rsvps.some((r) => r.status === 'attending');
  const allDeclined = rsvps.length > 0 && rsvps.every((r) => r.status === 'declined');
  const attendance = hasAttending
    ? 'Attending'
    : allDeclined
      ? 'Declined'
      : inv.used
        ? 'Attending'
        : 'Pending';

  const rsvpNames = rsvps.flatMap((r) =>
    Array.isArray(r.plusOneNames) ? r.plusOneNames.filter(Boolean) : [],
  );
  const fallbackCompanion = [inv.plusOneFirstName, inv.plusOneLastName]
    .filter(Boolean)
    .join(' ')
    .trim();
  const plusOneName =
    rsvpNames.length > 0
      ? Array.from(new Set(rsvpNames)).join(', ')
      : fallbackCompanion;

  const maxRsvpPlusOnes = rsvps.reduce(
    (max, r) => (r.status === 'declined' ? max : Math.max(max, r.plusOneCount ?? 0)),
    0,
  );
  const companionCount = allDeclined
    ? 0
    : Math.max(maxRsvpPlusOnes, inv.plusOneAllocations ?? 0);
  const headcount = allDeclined ? 0 : 1 + companionCount;

  const meals: string[] = [];
  for (const r of rsvps) {
    if (r.status === 'declined') continue;
    for (const rawMeal of r.mealSelections ?? []) {
      const label = mealLabelById.get(rawMeal) ?? rawMeal;
      if (label.trim()) meals.push(label.trim());
    }
  }

  const answerParts: string[] = [];
  for (const r of rsvps) {
    if (!r.customAnswers || typeof r.customAnswers !== 'object') continue;
    for (const [k, v] of Object.entries(r.customAnswers)) {
      if (typeof v === 'string' && v.trim()) {
        answerParts.push(`${k}: ${v.trim()}`);
      }
    }
  }

  return {
    attendance,
    plusOneName,
    mealSelections: meals,
    customAnswers: answerParts.join(' | '),
    headcount,
  };
}

function summarizeTableMealsAndDietary(
  snapshot: StaticDemoSnapshot,
  guests: DemoInvitationCodeRecord[],
  mealLabelById: Map<string, string>,
): { seatedHeadcount: number; formattedMeals: string; formattedDietary: string } {
  const mealCounts = new Map<string, number>();
  const dietaryCounts = new Map<string, number>();
  let seatedHeadcount = 0;

  for (const g of guests) {
    const info = summarizeGuestRsvpFields(snapshot, g, mealLabelById);
    seatedHeadcount += Math.max(1, info.headcount);
    if (info.mealSelections.length === 0) {
      mealCounts.set('Unspecified', (mealCounts.get('Unspecified') ?? 0) + 1);
    } else {
      for (const m of info.mealSelections) {
        mealCounts.set(m, (mealCounts.get(m) ?? 0) + 1);
      }
    }
    const notes = (g.dietaryNotes ?? '').trim();
    if (notes) {
      for (const token of notes.split(/[,;]/).map((s) => s.trim()).filter(Boolean)) {
        dietaryCounts.set(token, (dietaryCounts.get(token) ?? 0) + 1);
      }
    }
  }

  const formattedMeals =
    Array.from(mealCounts.entries())
      .map(([label, count]) => `${label}: ${count}`)
      .join('; ') || 'None specified';
  const formattedDietary =
    Array.from(dietaryCounts.entries())
      .map(([label, count]) => `${label}: ${count}`)
      .join('; ') || 'None';

  return { seatedHeadcount, formattedMeals, formattedDietary };
}

export function buildSeatingCsv(
  tables: DemoSeatingTableRecord[],
  invitations: DemoInvitationCodeRecord[],
  snapshot?: StaticDemoSnapshot,
): string {
  const guestTables = tables.filter(
    (t) => !isDemoLandmarkShape(t.shape) && t.capacity > 0,
  );
  const mealLabelById = resolveMealLabelMap(snapshot?.subEvent ?? []);
  const headers = [
    'Table Name',
    'Table Shape',
    'Capacity',
    'Seat Number',
    'Guest Name',
    'Dietary Notes',
    'Plus-One Name',
    'Plus-One Seats',
    'Attendance',
    'Meal Selections',
    'Table Meal Counts',
    'Custom Answers',
  ];

  const rows: Array<Array<unknown>> = [];
  for (const table of guestTables) {
    const seated = invitations
      .filter((inv) => inv.tableId === table.id)
      .sort((a, b) => (a.seatNumber ?? 999) - (b.seatNumber ?? 999));

    if (seated.length === 0) {
      rows.push([
        table.name,
        table.shape,
        String(table.capacity),
        '',
        '(Unassigned Table)',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
      ]);
      continue;
    }

    const tableSummary = snapshot
      ? summarizeTableMealsAndDietary(snapshot, seated, mealLabelById)
      : { formattedMeals: '' };

    for (const inv of seated) {
      const info = snapshot
        ? summarizeGuestRsvpFields(snapshot, inv, mealLabelById)
        : {
          attendance: inv.used ? 'Attending' : 'Pending',
          plusOneName: [inv.plusOneFirstName, inv.plusOneLastName]
            .filter(Boolean)
            .join(' '),
          mealSelections: [] as string[],
          customAnswers: '',
        };
      const plusOneSeats = Array.isArray(inv.plusOneSeatNumbers)
        ? [...inv.plusOneSeatNumbers].sort((a, b) => a - b).join(', ')
        : '';

      rows.push([
        table.name,
        table.shape,
        String(table.capacity),
        inv.seatNumber ?? '',
        inv.guestName,
        inv.dietaryNotes ?? '',
        info.plusOneName,
        plusOneSeats,
        info.attendance,
        info.mealSelections.join(', '),
        tableSummary.formattedMeals,
        info.customAnswers,
      ]);
    }
  }

  for (const inv of invitations.filter((g) => !g.tableId)) {
    const info = snapshot
      ? summarizeGuestRsvpFields(snapshot, inv, mealLabelById)
      : {
        attendance: inv.used ? 'Attending' : 'Pending',
        plusOneName: [inv.plusOneFirstName, inv.plusOneLastName]
          .filter(Boolean)
          .join(' '),
        mealSelections: [] as string[],
        customAnswers: '',
      };
    if (info.attendance === 'Declined') continue;
    rows.push([
      'Unassigned',
      '',
      '',
      '',
      inv.guestName,
      inv.dietaryNotes ?? '',
      info.plusOneName,
      '',
      info.attendance,
      info.mealSelections.join(', '),
      '',
      info.customAnswers,
    ]);
  }

  return buildCsvDocument(headers, rows);
}

export function buildSeatingMealCountsCsv(snapshot: StaticDemoSnapshot): string {
  const guestTables = snapshot.seatingTable.filter(
    (t) => !isDemoLandmarkShape(t.shape) && t.capacity > 0,
  );
  const mealLabelById = resolveMealLabelMap(snapshot.subEvent);
  const headers = [
    'Table Name',
    'Table Shape',
    'Capacity',
    'Seated Guests',
    'Entree Counts',
    'Dietary Counts',
  ];

  const rows: Array<Array<unknown>> = [];
  const allSeated: DemoInvitationCodeRecord[] = [];

  for (const table of guestTables) {
    const seated = snapshot.invitationCode.filter((inv) => inv.tableId === table.id);
    allSeated.push(...seated);
    const summary = summarizeTableMealsAndDietary(snapshot, seated, mealLabelById);
    rows.push([
      table.name,
      table.shape,
      String(table.capacity),
      String(seated.length === 0 ? 0 : summary.seatedHeadcount),
      seated.length === 0 ? 'None specified' : summary.formattedMeals,
      seated.length === 0 ? 'None' : summary.formattedDietary,
    ]);
  }

  if (guestTables.length > 0) {
    const totalCap = guestTables.reduce((sum, t) => sum + t.capacity, 0);
    const totalSummary = summarizeTableMealsAndDietary(
      snapshot,
      allSeated,
      mealLabelById,
    );
    rows.push([
      'TOTAL',
      '',
      String(totalCap),
      String(allSeated.length === 0 ? 0 : totalSummary.seatedHeadcount),
      allSeated.length === 0 ? 'None specified' : totalSummary.formattedMeals,
      allSeated.length === 0 ? 'None' : totalSummary.formattedDietary,
    ]);
  }

  return buildCsvDocument(headers, rows);
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
      const hasOwnAddress = Boolean(c.addressLine1 && c.addressLine1.trim());
      const address = hasOwnAddress
        ? [c.addressLine1, c.city, c.state, c.zipCode].filter(Boolean).join(', ')
        : inv
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
