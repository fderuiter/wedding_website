import { downloadExportBlob } from '../exportDownload';

describe('downloadExportBlob', () => {
  const originalFetch = global.fetch;
  const originalBasePath = process.env.NEXT_PUBLIC_BASE_PATH;

  beforeEach(() => {
    jest.restoreAllMocks();
    process.env.NEXT_PUBLIC_BASE_PATH = '';
  });

  afterAll(() => {
    global.fetch = originalFetch;
    process.env.NEXT_PUBLIC_BASE_PATH = originalBasePath;
  });

  it('prefixes NEXT_PUBLIC_BASE_PATH, parses Content-Disposition filename, marks link with staticDemoBypass, and revokes object URL', async () => {
    process.env.NEXT_PUBLIC_BASE_PATH = '/wedding_website/demo';

    const mockCreateObjectURL = jest.fn(() => 'blob:http://localhost/export-1');
    const mockRevokeObjectURL = jest.fn();
    Object.defineProperty(window.URL, 'createObjectURL', {
      value: mockCreateObjectURL,
      configurable: true,
    });
    Object.defineProperty(window.URL, 'revokeObjectURL', {
      value: mockRevokeObjectURL,
      configurable: true,
    });

    const createdLinks: HTMLAnchorElement[] = [];
    const origCreateElement = document.createElement.bind(document);
    jest.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const el = origCreateElement(tagName);
      if (tagName.toLowerCase() === 'a') {
        createdLinks.push(el as HTMLAnchorElement);
      }
      return el;
    });
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    global.fetch = jest.fn().mockResolvedValueOnce(
      new Response('col1,col2\nval1,val2\n', {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="guests-2026.csv"',
        },
      })
    );

    const result = await downloadExportBlob('/api/admin/invitation-codes/export', 'fallback.csv');

    expect(global.fetch).toHaveBeenCalledWith(
      '/wedding_website/demo/api/admin/invitation-codes/export'
    );
    expect(result.filename).toBe('guests-2026.csv');
    expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(createdLinks).toHaveLength(1);
    expect(createdLinks[0].download).toBe('guests-2026.csv');
    expect(createdLinks[0].dataset.staticDemoBypass).toBe('true');
    expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/export-1');
  });

  it('supports RFC 5987 UTF-8 filename* parameter and falls back when absent', async () => {
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        new Response('pdf', {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': "attachment; filename*=UTF-8''seating%20chart.pdf",
          },
        })
      )
      .mockResolvedValueOnce(
        new Response('ics', {
          status: 200,
          headers: { 'Content-Type': 'text/calendar' },
        })
      );

    const first = await downloadExportBlob('/api/admin/seating/export?format=pdf', 'fallback.pdf');
    expect(first.filename).toBe('seating chart.pdf');

    const second = await downloadExportBlob('/api/schedule/evt-1/ics', 'ceremony.ics');
    expect(second.filename).toBe('ceremony.ics');

    clickSpy.mockRestore();
  });

  it('throws extracted server error message without triggering anchor download on non-2xx responses', async () => {
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    global.fetch = jest.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Unauthorized export request.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(
      downloadExportBlob('/api/admin/maintenance/export', 'backup.json')
    ).rejects.toThrow('Unauthorized export request.');
    expect(clickSpy).not.toHaveBeenCalled();

    clickSpy.mockRestore();
  });
});
