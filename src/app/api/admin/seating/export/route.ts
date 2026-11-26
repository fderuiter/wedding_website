import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { prisma } from '@/lib/prisma';
import { generateCsvContent } from '@/utils/csv';
import {
  computeTableMealCounts,
  generateAveryCardsPdf,
  generateSeatingChartPdf,
  getInvitationPartyMembers,
  getTableOccupiedChairCount,
  isGuestEligibleForSeating,
  isLandmarkTable,
  resolveDetailedSeatAssignments,
  type SeatingTableDTO,
} from '@/features/seating';
import {
  formatAttendanceLabel,
  formatGuestPlusOneNames,
  formatGuestMealSelections,
  formatGuestCustomAnswers,
  type InvitationCodeDTO,
} from '@/features/registry';
import { getAppConfig } from '@/lib/config';

const ROSTER_HEADERS = [
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

const MEAL_COUNT_HEADERS = [
  'Table Name',
  'Table Shape',
  'Capacity',
  'Seated Guests',
  'Entree Counts',
  'Dietary Counts',
];

interface SeatingExportRecord extends Record<string, unknown> {
  'Table Name': string;
  'Table Shape': string;
  'Capacity': string;
  'Seat Number': string;
  'Guest Name': string;
  'Dietary Notes': string;
  'Plus-One Name': string;
  'Plus-One Seats': string;
  'Attendance': string;
  'Meal Selections': string;
  'Table Meal Counts': string;
  'Custom Answers': string;
}

interface TableMealCountRecord extends Record<string, unknown> {
  'Table Name': string;
  'Table Shape': string;
  'Capacity': string;
  'Seated Guests': string;
  'Entree Counts': string;
  'Dietary Counts': string;
}

async function resolveExportHeaderMetadata(): Promise<{
  siteTitle: string;
  weddingDate?: string;
}> {
  let siteTitle = 'Wedding Reception Seating Chart';
  let weddingDateStr: string | undefined;

  try {
    const config = await getAppConfig();
    const couple = [config.partner1Name || config.brideName, config.partner2Name || config.groomName]
      .filter(Boolean)
      .join(' & ');
    if (couple) {
      siteTitle = `${couple} - Seating Chart & Floorplan`;
    }
    if (config.weddingDate) {
      weddingDateStr = new Date(config.weddingDate).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    }
  } catch {
    // Fallback if config is unavailable
  }

  return { siteTitle, weddingDate: weddingDateStr };
}

export const GET = withApiMiddleware(async (request: NextRequest) => {
  const format = request?.url
    ? new URL(request.url).searchParams.get('format')?.toLowerCase()
    : null;

  const hasRelationalMembers =
    typeof (prisma as unknown as { householdMember?: { findMany?: unknown } }).householdMember
      ?.findMany === 'function';

  const relationalGuestInclude = hasRelationalMembers
    ? {
      members: { orderBy: { displayOrder: 'asc' as const } },
      subEventRsvps: {
        include: {
          memberRsvps: true,
          subEvent: { select: { id: true, title: true, mealOptions: true } },
        },
      },
    }
    : undefined;

  const [rawTables, rawUnassignedGuests] = await Promise.all([
    prisma.seatingTable.findMany({
      include: {
        invitationCodes: {
          orderBy: { seatNumber: 'asc' },
          ...(relationalGuestInclude ? { include: relationalGuestInclude } : {}),
        },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.invitationCode.findMany({
      where: { tableId: null },
      orderBy: { guestName: 'asc' },
      ...(relationalGuestInclude ? { include: relationalGuestInclude } : {}),
    }),
  ]);

  const tables = rawTables
    .filter((table) => !table.isSample)
    .map((table) => ({
      ...table,
      invitationCodes: (table.invitationCodes || []).filter((guest) =>
        isGuestEligibleForSeating(guest)
      ),
    }));
  const unassignedGuests = rawUnassignedGuests.filter((guest) =>
    isGuestEligibleForSeating(guest)
  );
  const guestTables = tables.filter((table) => !isLandmarkTable(table));

  if (format === 'pdf') {
    const { siteTitle, weddingDate } = await resolveExportHeaderMetadata();
    const pdfBuffer = await generateSeatingChartPdf(
      tables as unknown as SeatingTableDTO[],
      unassignedGuests as unknown as InvitationCodeDTO[],
      { siteTitle, weddingDate }
    );

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="seating-chart.pdf"',
      },
    });
  }

  if (format === 'place-cards' || format === 'escort-cards') {
    const { siteTitle, weddingDate } = await resolveExportHeaderMetadata();
    const pdfBuffer = await generateAveryCardsPdf(
      tables as unknown as SeatingTableDTO[],
      format,
      { siteTitle, weddingDate }
    );
    const filename =
      format === 'place-cards' ? 'seating-place-cards.pdf' : 'seating-escort-cards.pdf';

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  }

  const dateStamp = new Date().toISOString().split('T')[0];

  if (format === 'meals' || format === 'meal-counts') {
    const mealRecords: TableMealCountRecord[] = [];
    const allSeatedGuests: InvitationCodeDTO[] = [];

    for (const table of guestTables) {
      const tableGuests = table.invitationCodes as unknown as InvitationCodeDTO[];
      allSeatedGuests.push(...tableGuests);
      const occupiedChairs = getTableOccupiedChairCount(tableGuests);
      const summary = computeTableMealCounts(tableGuests);

      mealRecords.push({
        'Table Name': table.name,
        'Table Shape': table.shape,
        'Capacity': String(table.capacity),
        'Seated Guests': String(occupiedChairs),
        'Entree Counts': summary.formattedMeals,
        'Dietary Counts': summary.formattedDietary,
      });
    }

    if (guestTables.length > 0) {
      const totalCapacity = guestTables.reduce((sum, t) => sum + t.capacity, 0);
      const totalSummary = computeTableMealCounts(allSeatedGuests);
      mealRecords.push({
        'Table Name': 'TOTAL',
        'Table Shape': '',
        'Capacity': String(totalCapacity),
        'Seated Guests': String(totalSummary.totalAttendees),
        'Entree Counts': totalSummary.formattedMeals,
        'Dietary Counts': totalSummary.formattedDietary,
      });
    }

    const csvString = generateCsvContent(mealRecords, MEAL_COUNT_HEADERS);
    return new NextResponse(csvString, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="seating-meal-counts-${dateStamp}.csv"`,
      },
    });
  }

  const exportRecords: SeatingExportRecord[] = [];

  for (const table of guestTables) {
    if (table.invitationCodes.length === 0) {
      exportRecords.push({
        'Table Name': table.name,
        'Table Shape': table.shape,
        'Capacity': String(table.capacity),
        'Seat Number': '',
        'Guest Name': '(Unassigned Table)',
        'Dietary Notes': '',
        'Plus-One Name': '',
        'Plus-One Seats': '',
        'Attendance': '',
        'Meal Selections': '',
        'Table Meal Counts': '',
        'Custom Answers': '',
      });
    } else {
      const tableGuests = table.invitationCodes as unknown as InvitationCodeDTO[];
      const mealSummary = computeTableMealCounts(tableGuests);
      const detailedMap = resolveDetailedSeatAssignments(tableGuests, table.capacity);
      const primarySeatByGuestId = new Map<string, number>();
      const plusOneSeatsByGuestId = new Map<string, number[]>();

      detailedMap.forEach((entry, seatNum) => {
        if (!entry.guest.id) return;
        if (entry.isPlusOne) {
          const arr = plusOneSeatsByGuestId.get(entry.guest.id) ?? [];
          arr.push(seatNum);
          plusOneSeatsByGuestId.set(entry.guest.id, arr);
        } else {
          primarySeatByGuestId.set(entry.guest.id, seatNum);
        }
      });

      for (const guest of table.invitationCodes) {
        const partyMembers = getInvitationPartyMembers(guest as unknown as InvitationCodeDTO);
        const hasMemberBindings = partyMembers.some((m) => Boolean(m.memberId));
        const primarySeat = hasMemberBindings
          ? primarySeatByGuestId.get(guest.id) ?? guest.seatNumber
          : guest.seatNumber || primarySeatByGuestId.get(guest.id);
        const plusOneSeats = (plusOneSeatsByGuestId.get(guest.id) ?? []).sort((a, b) => a - b);

        const primaryDisplayName = hasMemberBindings
          ? partyMembers[0]?.attendeeName || guest.guestName
          : guest.guestName;
        const plusOneDisplayNames = hasMemberBindings
          ? partyMembers
            .slice(1)
            .map((m) => m.attendeeName)
            .join(', ')
          : formatGuestPlusOneNames(guest);
        const dietaryNotesText = hasMemberBindings
          ? partyMembers
            .map((m) => {
              const badges = m.dietaryBadges
                .filter((b) => b.category === 'kids')
                .map((b) => b.label);
              const combined = [m.dietaryNotesText, ...badges].filter(Boolean).join(', ');
              if (!combined) return '';
              return partyMembers.length > 1 ? `${m.attendeeName}: ${combined}` : combined;
            })
            .filter(Boolean)
            .join('; ')
          : guest.dietaryNotes || '';
        const mealSelectionsText = hasMemberBindings
          ? partyMembers
            .filter((m) => Boolean(m.mealChoice))
            .map((m) => `${m.attendeeName}: ${m.mealChoice}`)
            .join('; ') || formatGuestMealSelections(guest)
          : formatGuestMealSelections(guest);

        exportRecords.push({
          'Table Name': table.name,
          'Table Shape': table.shape,
          'Capacity': String(table.capacity),
          'Seat Number': primarySeat ? String(primarySeat) : '',
          'Guest Name': primaryDisplayName,
          'Dietary Notes': dietaryNotesText,
          'Plus-One Name': plusOneDisplayNames,
          'Plus-One Seats': plusOneSeats.map(String).join(', '),
          'Attendance': formatAttendanceLabel(guest as unknown as InvitationCodeDTO),
          'Meal Selections': mealSelectionsText,
          'Table Meal Counts': mealSummary.formattedMeals,
          'Custom Answers': formatGuestCustomAnswers(guest),
        });
      }
    }
  }

  for (const guest of unassignedGuests) {
    const partyMembers = getInvitationPartyMembers(guest as unknown as InvitationCodeDTO);
    const hasMemberBindings = partyMembers.some((m) => Boolean(m.memberId));
    const primaryDisplayName = hasMemberBindings
      ? partyMembers[0]?.attendeeName || guest.guestName
      : guest.guestName;
    const plusOneDisplayNames = hasMemberBindings
      ? partyMembers
        .slice(1)
        .map((m) => m.attendeeName)
        .join(', ')
      : formatGuestPlusOneNames(guest);
    const dietaryNotesText = hasMemberBindings
      ? partyMembers
        .map((m) => {
          const badges = m.dietaryBadges
            .filter((b) => b.category === 'kids')
            .map((b) => b.label);
          const combined = [m.dietaryNotesText, ...badges].filter(Boolean).join(', ');
          if (!combined) return '';
          return partyMembers.length > 1 ? `${m.attendeeName}: ${combined}` : combined;
        })
        .filter(Boolean)
        .join('; ')
      : guest.dietaryNotes || '';
    const mealSelectionsText = hasMemberBindings
      ? partyMembers
        .filter((m) => Boolean(m.mealChoice))
        .map((m) => `${m.attendeeName}: ${m.mealChoice}`)
        .join('; ') || formatGuestMealSelections(guest)
      : formatGuestMealSelections(guest);

    exportRecords.push({
      'Table Name': 'Unassigned',
      'Table Shape': '',
      'Capacity': '',
      'Seat Number': '',
      'Guest Name': primaryDisplayName,
      'Dietary Notes': dietaryNotesText,
      'Plus-One Name': plusOneDisplayNames,
      'Plus-One Seats': '',
      'Attendance': formatAttendanceLabel(guest as unknown as InvitationCodeDTO),
      'Meal Selections': mealSelectionsText,
      'Table Meal Counts': '',
      'Custom Answers': formatGuestCustomAnswers(guest),
    });
  }

  const csvString = generateCsvContent(exportRecords, ROSTER_HEADERS);

  return new NextResponse(csvString, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="seating-roster-${dateStamp}.csv"`,
    },
  });
});
