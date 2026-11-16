import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { prisma } from '@/lib/prisma';
import { generateCsvContent } from '@/utils/csv';
import { matchDietaryCategory, getAttendanceStatus, isAddressComplete } from '@/features/registry';

function extractPhoneNumber(extraFields: unknown): string {
  if (!extraFields) return '';

  let parsed: unknown = extraFields;
  if (typeof extraFields === 'string') {
    try {
      parsed = JSON.parse(extraFields);
    } catch {
      return '';
    }
  }

  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    const candidate = [record.phone, record.mobile, record.phoneNumber].find(
      (val) => (typeof val === 'string' && val.trim().length > 0) || typeof val === 'number'
    );
    if (typeof candidate === 'string') return candidate;
    if (typeof candidate === 'number') return String(candidate);
  }

  return '';
}

const HEADERS = [
  'Guest Name',
  'Invitation Code',
  'RSVP Link',
  'Email',
  'Phone Number',
  'Plus-One Name',
  'Household Name',
  'Party Group',
  'Party Tags',
  'Address',
  'Dietary Notes',
  'Plus Ones',
  'Status',
];

interface InvitationCodeExportRecord extends Record<string, unknown> {
  'Guest Name': string;
  'Invitation Code': string;
  'RSVP Link': string;
  'Email': string;
  'Phone Number': string;
  'Plus-One Name': string;
  'Household Name': string;
  'Party Group': string;
  'Party Tags': string;
  'Address': string;
  'Dietary Notes': string;
  'Plus Ones': number;
  'Status': string;
}

export const GET = withApiMiddleware(async (request: NextRequest) => {
  const url = new URL(request.url);
  const searchParams = url.searchParams;

  const searchQuery = (searchParams.get('search') || searchParams.get('searchQuery') || searchParams.get('q') || '').trim();
  const statusFilter = (searchParams.get('status') || 'all').trim().toLowerCase();
  const householdFilter = (searchParams.get('household') || searchParams.get('householdName') || 'all').trim();
  const partyGroupFilter = (searchParams.get('partyGroup') || 'all').trim();
  const partyTagsParam = (searchParams.get('partyTags') || searchParams.get('tags') || searchParams.get('tag') || '').trim();
  const dietaryFilter = (searchParams.get('dietary') || 'all').trim().toLowerCase();
  const attendanceFilter = (searchParams.get('attendance') || 'all').trim().toLowerCase();
  const addressFilter = (searchParams.get('address') || 'all').trim().toLowerCase();
  const idsParam = (searchParams.get('ids') || '').trim();

  const where: any = {};

  // Filter by IDs if specified
  if (idsParam) {
    const idList = idsParam.split(',').map((id) => id.trim()).filter(Boolean);
    if (idList.length > 0) {
      where.id = { in: idList };
    }
  }

  // Filter by status (redeemed vs unused)
  if (statusFilter === 'redeemed') {
    where.used = true;
  } else if (statusFilter === 'unused') {
    where.used = false;
  }

  // Filter by household
  if (householdFilter && householdFilter !== 'all') {
    where.householdName = { contains: householdFilter, mode: 'insensitive' };
  }

  // Filter by party group
  if (partyGroupFilter && partyGroupFilter !== 'all') {
    where.partyGroup = { equals: partyGroupFilter, mode: 'insensitive' };
  }

  // Filter by party tags
  if (partyTagsParam && partyTagsParam !== 'all') {
    const tagList = partyTagsParam.split(',').map((t) => t.trim()).filter(Boolean);
    if (tagList.length > 0) {
      where.partyTags = { hasSome: tagList };
    }
  }

  // Filter by search query
  if (searchQuery) {
    where.OR = [
      { guestName: { contains: searchQuery, mode: 'insensitive' } },
      { code: { contains: searchQuery, mode: 'insensitive' } },
      { email: { contains: searchQuery, mode: 'insensitive' } },
      { householdName: { contains: searchQuery, mode: 'insensitive' } },
      { partyGroup: { contains: searchQuery, mode: 'insensitive' } },
      { plusOneFirstName: { contains: searchQuery, mode: 'insensitive' } },
      { plusOneLastName: { contains: searchQuery, mode: 'insensitive' } },
      { partyTags: { has: searchQuery } },
    ];
  }

  // Query database directly
  let dbRecords = await prisma.invitationCode.findMany({
    where,
    orderBy: { guestName: 'asc' },
  });

  // Apply in-memory secondary filters for dietary, attendance, and address if specified
  if (dietaryFilter && dietaryFilter !== 'all') {
    dbRecords = dbRecords.filter((item) => matchDietaryCategory(item.dietaryNotes, dietaryFilter));
  }

  if (attendanceFilter && attendanceFilter !== 'all') {
    dbRecords = dbRecords.filter((item) => getAttendanceStatus(item as any) === attendanceFilter);
  }

  if (addressFilter && addressFilter !== 'all') {
    if (addressFilter === 'complete') {
      dbRecords = dbRecords.filter((item) => isAddressComplete(item));
    } else if (addressFilter === 'missing') {
      dbRecords = dbRecords.filter((item) => !isAddressComplete(item));
    }
  }

  // Determine base URL for complete RSVP links
  const origin = request.nextUrl.origin;
  const proto = request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', '');
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const baseUrl = (host ? `${proto}://${host}` : origin).replace(/\/+$/, '');

  // Map to export format
  const exportRecords: InvitationCodeExportRecord[] = dbRecords.map((item) => {
    const plusOneName = [item.plusOneFirstName, item.plusOneLastName].filter(Boolean).join(' ');
    const fullAddress = [
      item.addressLine1,
      item.addressLine2,
      item.city,
      item.state,
      item.zipCode,
      item.country,
    ]
      .filter(Boolean)
      .join(', ');

    const rsvpLink = item.code ? `${baseUrl}/guest?code=${encodeURIComponent(item.code)}` : '';
    const phoneNumber = extractPhoneNumber(item.extraFields);

    return {
      'Guest Name': item.guestName || '',
      'Invitation Code': item.code || '',
      'RSVP Link': rsvpLink,
      'Email': item.email || '',
      'Phone Number': phoneNumber,
      'Plus-One Name': plusOneName,
      'Household Name': item.householdName || '',
      'Party Group': item.partyGroup || '',
      'Party Tags': Array.isArray(item.partyTags) ? item.partyTags.join(', ') : '',
      'Address': fullAddress,
      'Dietary Notes': item.dietaryNotes || '',
      'Plus Ones': item.plusOneAllocations ?? 0,
      'Status': item.used ? 'Redeemed' : 'Unused',
    };
  });

  const csvContent = generateCsvContent(exportRecords, HEADERS);
  const todayStr = new Date().toISOString().split('T')[0];

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="invitation-codes-${todayStr}.csv"`,
    },
  });
});
