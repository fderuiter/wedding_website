import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { prisma } from '@/lib/prisma';
import { generateCsvContent } from '@/utils/csv';
import { generateSeatingChartPdf } from '@/features/seating/pdf.service';
import { getAppConfig } from '@/lib/config';

const HEADERS = [
  'Table Name',
  'Table Shape',
  'Capacity',
  'Seat Number',
  'Guest Name',
  'Invitation Code',
];

interface SeatingExportRecord extends Record<string, unknown> {
  'Table Name': string;
  'Table Shape': string;
  'Capacity': string;
  'Seat Number': string;
  'Guest Name': string;
  'Invitation Code': string;
}

export const GET = withApiMiddleware(async (request: NextRequest) => {
  const format = request?.url ? new URL(request.url).searchParams.get('format')?.toLowerCase() : null;

  const [tables, unassignedGuests] = await Promise.all([
    prisma.seatingTable.findMany({
      include: {
        invitationCodes: {
          orderBy: { seatNumber: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.invitationCode.findMany({
      where: { tableId: null },
      orderBy: { guestName: 'asc' },
    }),
  ]);

  if (format === 'pdf') {
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

    const pdfBuffer = await generateSeatingChartPdf(tables as any, unassignedGuests as any, {
      siteTitle,
      weddingDate: weddingDateStr,
    });

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="seating-chart.pdf"',
      },
    });
  }

  const exportRecords: SeatingExportRecord[] = [];

  for (const table of tables) {
    if (table.invitationCodes.length === 0) {
      exportRecords.push({
        'Table Name': table.name,
        'Table Shape': table.shape,
        'Capacity': String(table.capacity),
        'Seat Number': '',
        'Guest Name': '(Unassigned Table)',
        'Invitation Code': '',
      });
    } else {
      for (const guest of table.invitationCodes) {
        exportRecords.push({
          'Table Name': table.name,
          'Table Shape': table.shape,
          'Capacity': String(table.capacity),
          'Seat Number': guest.seatNumber ? String(guest.seatNumber) : '',
          'Guest Name': guest.guestName,
          'Invitation Code': guest.code,
        });
      }
    }
  }

  for (const guest of unassignedGuests) {
    exportRecords.push({
      'Table Name': 'Unassigned',
      'Table Shape': '',
      'Capacity': '',
      'Seat Number': '',
      'Guest Name': guest.guestName,
      'Invitation Code': guest.code,
    });
  }

  const csvString = generateCsvContent(exportRecords, HEADERS);

  return new NextResponse(csvString, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="seating-roster-${new Date().toISOString().split('T')[0]}.csv"`,
    },
  });
});

