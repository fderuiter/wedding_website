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
