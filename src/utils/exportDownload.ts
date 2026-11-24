import { withBasePath } from '@/lib/basePath';

interface NativeExportDownloadPayload {
  ids?: string[];
  tag?: string;
  category?: string;
}

interface NativeExportDownloadOptions {
  url: string;
  filename: string;
  payload?: NativeExportDownloadPayload;
}

/**
 * Validates export readiness via a lightweight preflight request, then triggers
 * a native browser download (via `<a download>` for GET or a hidden `<form method="POST">`
 * for selective POST exports) so the browser streams the ZIP directly to disk without
 * buffering `Response.blob()` in RAM.
 */
export async function triggerNativeExportDownload({
  url,
  filename,
  payload,
}: NativeExportDownloadOptions): Promise<void> {
  const resolvedUrl = withBasePath(url);

  if (payload) {
    const preflightRes = await fetch(resolvedUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        filename,
        preflight: true,
      }),
    });

    if (!preflightRes.ok) {
      throw new Error(`Export request failed with HTTP ${preflightRes.status}`);
    }

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = resolvedUrl;
    form.style.display = 'none';

    const appendField = (name: string, value: string) => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = value;
      form.appendChild(input);
    };

    if (Array.isArray(payload.ids)) {
      for (const id of payload.ids) {
        appendField('ids', id);
      }
    }
    if (payload.tag) {
      appendField('tag', payload.tag);
    }
    if (payload.category) {
      appendField('category', payload.category);
    }
    appendField('filename', filename);

    document.body.appendChild(form);
    try {
      form.submit();
    } finally {
      document.body.removeChild(form);
    }
    return;
  }

  const parsedUrl = new URL(resolvedUrl, window.location.origin);
  const preflightUrl = new URL(parsedUrl.toString());
  preflightUrl.searchParams.set('preflight', '1');
  preflightUrl.searchParams.set('filename', filename);

  const preflightRes = await fetch(`${preflightUrl.pathname}${preflightUrl.search}`);
  if (!preflightRes.ok) {
    throw new Error(`Export request failed with HTTP ${preflightRes.status}`);
  }

  const downloadUrl = new URL(parsedUrl.toString());
  downloadUrl.searchParams.set('filename', filename);

  const link = document.createElement('a');
  link.href = `${downloadUrl.pathname}${downloadUrl.search}`;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    document.body.removeChild(link);
  }
}

function parseDispositionFilename(headerValue: string | null | undefined): string | null {
  if (!headerValue) return null;
  const utf8Match = /filename\*=UTF-8''([^;\r\n]+)/i.exec(headerValue);
  if (utf8Match?.[1]) {
    try {
      const decoded = decodeURIComponent(utf8Match[1].trim());
      if (decoded) return decoded;
    } catch {
      // Fall back to standard filename parameter
    }
  }
  const match = /filename="?([^";\r\n]+)"?/i.exec(headerValue);
  if (match?.[1]?.trim()) {
    return match[1].trim();
  }
  return null;
}

export async function downloadExportBlob(
  url: string,
  fallbackFilename: string,
  init?: RequestInit
): Promise<{ filename: string; blob: Blob }> {
  const resolvedUrl = withBasePath(url);
  const res = init !== undefined ? await fetch(resolvedUrl, init) : await fetch(resolvedUrl);

  if (!res.ok) {
    let errorMessage = `Export failed (HTTP ${res.status}).`;
    try {
      const contentType = res.headers?.get?.('content-type') || '';
      if (contentType.includes('application/json') && typeof res.json === 'function') {
        const payload: unknown = await res.json();
        const extracted =
          payload && typeof payload === 'object'
            ? (payload as { error?: unknown; message?: unknown }).error ??
              (payload as { error?: unknown; message?: unknown }).message
            : null;
        if (typeof extracted === 'string' && extracted.trim()) {
          errorMessage = extracted.trim();
        }
      } else if (typeof res.text === 'function') {
        const rawText = await res.text();
        if (rawText.trim()) {
          try {
            const parsed = JSON.parse(rawText) as { error?: unknown; message?: unknown };
            const extracted = parsed?.error ?? parsed?.message;
            if (typeof extracted === 'string' && extracted.trim()) {
              errorMessage = extracted.trim();
            }
          } catch {
            if (rawText.trim().length < 200) {
              errorMessage = rawText.trim();
            }
          }
        }
      }
    } catch {
      // Preserve HTTP status fallback message
    }
    throw new Error(errorMessage);
  }

  let blob: Blob;
  if (typeof res.blob === 'function') {
    blob = await res.blob();
  } else if (typeof res.arrayBuffer === 'function') {
    const buffer = await res.arrayBuffer();
    blob = new Blob([buffer], {
      type: res.headers?.get?.('content-type') || 'application/octet-stream',
    });
  } else if (typeof res.text === 'function') {
    const text = await res.text();
    blob = new Blob([text], {
      type: res.headers?.get?.('content-type') || 'text/plain; charset=utf-8',
    });
  } else {
    blob = new Blob([]);
  }

  const headerFilename = parseDispositionFilename(res.headers?.get?.('content-disposition'));
  const filename = headerFilename || fallbackFilename;

  const objectUrl =
    typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
      ? URL.createObjectURL(blob)
      : 'blob:download';
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.dataset.staticDemoBypass = 'true';
  link.style.display = 'none';
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    document.body.removeChild(link);
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(objectUrl);
    }
  }

  return { filename, blob };
}
