import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { prisma } from '@/lib/prisma';
import { generateCsvContent } from '@/utils/csv';

const HEADERS = [
  'Guest Name',
  'Invitation Code',
  'Email',
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
  'Email': string;
  'Plus-One Name': string;
  'Household Name': string;
  'Party Group': string;
  'Party Tags': string;
  'Address': string;
  'Dietary Notes': string;
  'Plus Ones': number;
  'Status': string;
}

function matchDietaryCategory(notes: string | null | undefined, category: string): boolean {
  if (!category || category === 'all') return true;
  if (!notes || !notes.trim()) return false;
  const lower = notes.trim().toLowerCase();

  const isGlutenFree = /\b(gf|gluten[- ]free|gluten)\b/i.test(lower);
  const isVegan = /\b(vegan)\b/i.test(lower);
  const isVegetarian = /\b(vegetarian|veg)\b/i.test(lower) && !isVegan;
  const isDairyFree = /\b(df|dairy[- ]free|dairy|lactose)\b/i.test(lower);
  const isNutFree = /\b(nut[- ]free|nut|nuts|peanut|allergy|allergies)\b/i.test(lower);

  switch (category) {
    case 'gluten-free':
      return isGlutenFree;
    case 'vegetarian':
      return isVegetarian;
    case 'vegan':
      return isVegan;
    case 'dairy-free':
      return isDairyFree;
    case 'nut-free':
      return isNutFree;
    case 'other':
      return !isGlutenFree && !isVegan && !isVegetarian && !isDairyFree && !isNutFree;
    case 'has_restriction':
      return true;
    default:
      return true;
  }
}

function getAttendanceStatus(item: { used: boolean; extraFields?: Record<string, any> | null }): 'attending' | 'declined' | 'pending' {
  const rawVal = item.extraFields?.attendanceStatus ??
    item.extraFields?.rsvpStatus ??
    item.extraFields?.attendance ??
    item.extraFields?.rsvp ??
    item.extraFields?.attending ??
    item.extraFields?.status;

  if (rawVal !== undefined && rawVal !== null) {
    if (typeof rawVal === 'boolean') {
      return rawVal ? 'attending' : 'declined';
    }
    if (typeof rawVal === 'string') {
      const val = rawVal.trim().toLowerCase();
      if (['attending', 'accepted', 'yes', 'confirmed', 'true'].includes(val)) {
        return 'attending';
      }
      if (['declined', 'no', 'rejected', 'false'].includes(val)) {
        return 'declined';
      }
      if (['pending'].includes(val)) {
        return 'pending';
      }
    }
  }

  return item.used ? 'attending' : 'pending';
}

function isAddressComplete(item: {
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
}): boolean {
  return Boolean(
    item.addressLine1?.trim() &&
      item.city?.trim() &&
      item.state?.trim() &&
      item.zipCode?.trim()
  );
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

    return {
      'Guest Name': item.guestName || '',
      'Invitation Code': item.code || '',
      'Email': item.email || '',
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
