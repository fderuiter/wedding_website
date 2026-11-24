import type { InvitationCodeDTO } from '@/features/registry';

export interface DemoRouteContext {
  url: URL;
  path: string;
  method: string;
  init?: RequestInit;
  rawInput?: RequestInfo | URL;
}

let demoIdSequence = 0;

export function nextDemoId(prefix: string): string {
  demoIdSequence += 1;
  return `${prefix}-${Date.now()}-${demoIdSequence}`;
}

export function jsonResponse(
  payload: unknown,
  status = 200,
  extraHeaders?: Record<string, string>
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
}

export function binaryResponse(
  body: BodyInit | Uint8Array,
  contentType: string,
  filename: string,
  status = 200
): Response {
  const normalizedBody: BodyInit =
    body instanceof Uint8Array
      ? new Blob([new Uint8Array(body)], { type: contentType })
      : body;
  return new Response(normalizedBody, {
    status,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

export async function parseJsonBody(
  init?: RequestInit,
  rawInput?: RequestInfo | URL
): Promise<Record<string, unknown>> {
  const candidateBody = init?.body;
  if (candidateBody) {
    if (typeof FormData !== 'undefined' && candidateBody instanceof FormData) {
      const obj: Record<string, unknown> = {};
      candidateBody.forEach((val, key) => {
        if (typeof val === 'string') {
          obj[key] = val;
        }
      });
      return obj;
    }
    if (typeof candidateBody === 'string') {
      try {
        const parsed: unknown = JSON.parse(candidateBody);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return {};
      }
      return {};
    }
    if (typeof Blob !== 'undefined' && candidateBody instanceof Blob) {
      try {
        const text = await candidateBody.text();
        const parsed: unknown = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return {};
      }
    }
  }

  if (typeof Request !== 'undefined' && rawInput instanceof Request) {
    try {
      const cloned = rawInput.clone();
      const parsed: unknown = await cloned.json();
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }

  return {};
}

export async function parseRawJsonValue(
  init?: RequestInit,
  rawInput?: RequestInfo | URL
): Promise<unknown> {
  if (typeof init?.body === 'string') {
    try {
      return JSON.parse(init.body);
    } catch {
      return null;
    }
  }
  if (typeof Request !== 'undefined' && rawInput instanceof Request) {
    try {
      return await rawInput.clone().json();
    } catch {
      return null;
    }
  }
  return null;
}

export async function parseFormData(
  init?: RequestInit,
  rawInput?: RequestInfo | URL
): Promise<FormData | null> {
  if (typeof FormData !== 'undefined' && init?.body instanceof FormData) {
    return init.body;
  }
  if (typeof Request !== 'undefined' && rawInput instanceof Request) {
    try {
      return await rawInput.clone().formData();
    } catch {
      return null;
    }
  }
  return null;
}

export function resolveApiPathname(input: RequestInfo | URL): URL | null {
  if (typeof window === 'undefined') return null;
  let rawUrl = '';
  if (typeof input === 'string') {
    rawUrl = input;
  } else if (input instanceof URL) {
    rawUrl = input.toString();
  } else if (typeof Request !== 'undefined' && input instanceof Request) {
    rawUrl = input.url;
  }
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    const rawBasePath = (process.env.NEXT_PUBLIC_BASE_PATH || '').trim().replace(/\/+$/, '');
    const basePath =
      rawBasePath && rawBasePath !== '/'
        ? rawBasePath.startsWith('/')
          ? rawBasePath
          : `/${rawBasePath}`
        : '';
    let path = url.pathname;
    if (basePath && (path === basePath || path.startsWith(`${basePath}/`))) {
      path = path.slice(basePath.length) || '/';
    }
    if (!path.startsWith('/api/')) return null;
    if (path.length > 1 && path.endsWith('/')) {
      path = path.replace(/\/+$/, '');
    }
    const normalized = new URL(url.toString());
    normalized.pathname = path;
    return normalized;
  } catch {
    return null;
  }
}

export function buildPaginationHeaders(
  total: number,
  page: number,
  limit: number
): Record<string, string> {
  const safeLimit = Math.max(1, limit);
  const totalPages = Math.max(1, Math.ceil(total / safeLimit));
  return {
    'X-Total-Count': String(total),
    'X-Page': String(page),
    'X-Limit': String(safeLimit),
    'X-Total-Pages': String(totalPages),
  };
}

export function createMinimalPdfBytes(title: string, lines: string[]): Uint8Array {
  const escapePdf = (text: string) =>
    text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const textCommands = [
    'BT',
    '/F1 16 Tf',
    '50 750 Td',
    `(${escapePdf(title)}) Tj`,
    '/F1 11 Tf',
    ...lines.slice(0, 35).flatMap((line) => ['0 -18 Td', `(${escapePdf(line.slice(0, 90))}) Tj`]),
    'ET',
  ].join('\n');

  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n',
    `4 0 obj << /Length ${textCommands.length} >>\nstream\n${textCommands}\nendstream\nendobj\n`,
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

export function createMinimalZipBytes(filename: string, content: string): Uint8Array {
  const nameBytes = new TextEncoder().encode(filename);
  const dataBytes = new TextEncoder().encode(content);
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < dataBytes.length; i += 1) {
    crc = crcTable[(crc ^ dataBytes[i]) & 0xff] ^ (crc >>> 8);
  }
  crc = (crc ^ 0xffffffff) >>> 0;

  const localHeaderLen = 30 + nameBytes.length;
  const centralDirLen = 46 + nameBytes.length;
  const endRecordLen = 22;
  const total = localHeaderLen + dataBytes.length + centralDirLen + endRecordLen;
  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);

  // Local file header
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(8, 0, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, dataBytes.length, true);
  view.setUint32(22, dataBytes.length, true);
  view.setUint16(26, nameBytes.length, true);
  buf.set(nameBytes, 30);
  buf.set(dataBytes, localHeaderLen);

  // Central directory header
  const cdOffset = localHeaderLen + dataBytes.length;
  view.setUint32(cdOffset, 0x02014b50, true);
  view.setUint16(cdOffset + 4, 20, true);
  view.setUint16(cdOffset + 6, 20, true);
  view.setUint32(cdOffset + 16, crc, true);
  view.setUint32(cdOffset + 20, dataBytes.length, true);
  view.setUint32(cdOffset + 24, dataBytes.length, true);
  view.setUint16(cdOffset + 28, nameBytes.length, true);
  view.setUint32(cdOffset + 42, 0, true);
  buf.set(nameBytes, cdOffset + 46);

  // End of central directory
  const eocdOffset = cdOffset + centralDirLen;
  view.setUint32(eocdOffset, 0x06054b50, true);
  view.setUint16(eocdOffset + 8, 1, true);
  view.setUint16(eocdOffset + 10, 1, true);
  view.setUint32(eocdOffset + 12, centralDirLen, true);
  view.setUint32(eocdOffset + 16, cdOffset, true);

  return buf;
}

export function upsertInvitationsIntoStaticDemoStore(records: InvitationCodeDTO[]): void {
  if (typeof window === 'undefined' || records.length === 0) return;
  const store = (
    window as Window & {
      __STATIC_DEMO_INSTALLED__?: {
        store?: {
          mutate?: (
            mutator: (draft: {
              invitationCode: Array<Record<string, unknown>>;
            }) => void
          ) => void;
        };
      };
    }
  ).__STATIC_DEMO_INSTALLED__?.store;
  if (typeof store?.mutate !== 'function') return;
  const nowIso = new Date().toISOString();
  store.mutate((draft) => {
    for (const dto of records) {
      const existing = draft.invitationCode.find(
        (inv) =>
          inv.id === dto.id || String(inv.code || '').toUpperCase() === dto.code.toUpperCase()
      );
      if (existing) {
        existing.guestName = dto.guestName;
        existing.householdName = dto.householdName ?? '';
        existing.email = dto.email ?? null;
        existing.addressLine1 = dto.addressLine1 ?? null;
        existing.addressLine2 = dto.addressLine2 ?? null;
        existing.city = dto.city ?? null;
        existing.state = dto.state ?? null;
        existing.zipCode = dto.zipCode ?? null;
        existing.country = dto.country ?? null;
        existing.dietaryNotes = dto.dietaryNotes ?? null;
        existing.partyGroup = dto.partyGroup ?? '';
        existing.partyTags = [...(dto.partyTags ?? [])];
        existing.plusOneAllocations = dto.plusOneAllocations ?? 0;
        if (dto.extraFields !== undefined) {
          existing.extraFields = dto.extraFields;
        }
        existing.updatedAt = nowIso;
      } else {
        draft.invitationCode.push({
          id: dto.id,
          code: dto.code,
          guestName: dto.guestName,
          householdName: dto.householdName ?? '',
          email: dto.email ?? null,
          addressLine1: dto.addressLine1 ?? null,
          addressLine2: dto.addressLine2 ?? null,
          city: dto.city ?? null,
          state: dto.state ?? null,
          zipCode: dto.zipCode ?? null,
          country: dto.country ?? null,
          dietaryNotes: dto.dietaryNotes ?? null,
          plusOneAllocations: dto.plusOneAllocations ?? 0,
          plusOneFirstName: null,
          plusOneLastName: null,
          partyGroup: dto.partyGroup ?? '',
          partyTags: [...(dto.partyTags ?? [])],
          extraFields: dto.extraFields ?? null,
          used: Boolean(dto.used),
          usedAt: null,
          tableId: dto.tableId ?? null,
          seatNumber: dto.seatNumber ?? null,
          plusOneSeatNumbers: dto.plusOneSeatNumbers ?? [],
          isSample: Boolean(dto.isSample),
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      }
    }
  });
}
