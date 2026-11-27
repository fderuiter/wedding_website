import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import { PhotoUploadQRModal } from '../PhotoUploadQRModal';

expect.extend(toHaveNoViolations);

const mockAddToast = jest.fn();
const mockConfirm = jest.fn();

jest.mock('@/components/ui/ToastProvider', () => {
  const actual = jest.requireActual('@/components/ui/ToastProvider');
  return {
    ...actual,
    useToast: () => ({
      addToast: mockAddToast,
      confirm: mockConfirm,
    }),
  };
});

describe('PhotoUploadQRModal Component', () => {
  const sampleUploadUrl = 'https://wedding.example.com/photos?qr=signed-token-v2';

  const defaultProps = {
    isOpen: true,
    onClose: jest.fn(),
    uploadUrl: sampleUploadUrl,
    tokenVersion: 2,
    isRotating: false,
    onRotateToken: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(() => {
    HTMLCanvasElement.prototype.toDataURL = jest.fn(() => 'data:image/png;base64,mockQrPng');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfirm.mockResolvedValue(true);
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(<PhotoUploadQRModal {...defaultProps} isOpen={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders signed upload URL input, QR code preview, and token version badge with zero axe violations', async () => {
    const { container } = render(<PhotoUploadQRModal {...defaultProps} />);

    expect(screen.getByText('Guest Photo Upload QR & Printable Cards')).toBeInTheDocument();
    expect(screen.getByTestId('photo-qr-version-badge')).toHaveTextContent('Token v2');

    const urlInput = screen.getByTestId('photo-qr-signed-url-input') as HTMLInputElement;
    expect(urlInput.value).toBe(sampleUploadUrl);

    const qrCanvas = screen.getByLabelText('Guest photo upload QR code');
    expect(qrCanvas).toBeInTheDocument();

    const results = await axe(container, {
      rules: {
        'label-content-name-mismatch': { enabled: true },
      },
    });
    expect(results).toHaveNoViolations();
  });

  it('copies signed upload URL to clipboard and triggers toast', async () => {
    const originalClipboard = navigator.clipboard;
    const writeTextMock = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    const { container } = render(<PhotoUploadQRModal {...defaultProps} />);

    fireEvent.click(screen.getByTestId('copy-photo-qr-link-btn'));

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith(sampleUploadUrl);
      expect(mockAddToast).toHaveBeenCalledWith(
        'Signed guest photo upload link copied to clipboard!',
        'success'
      );
    });

    const copiedAxeResults = await axe(container, {
      rules: {
        'label-content-name-mismatch': { enabled: true },
      },
    });
    expect(copiedAxeResults).toHaveNoViolations();

    Object.assign(navigator, { clipboard: originalClipboard });
  });

  it('triggers 512x512 PNG download named qr-photo-upload-v2.png', () => {
    const anchorClickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    const appendChildSpy = jest.spyOn(document.body, 'appendChild');
    const removeChildSpy = jest.spyOn(document.body, 'removeChild');

    try {
      render(<PhotoUploadQRModal {...defaultProps} />);

      fireEvent.click(screen.getByTestId('download-photo-qr-png-btn'));

      expect(appendChildSpy).toHaveBeenCalled();
      const anchor = appendChildSpy.mock.calls[appendChildSpy.mock.calls.length - 1][0] as HTMLAnchorElement;
      expect(anchor.download).toMatch(/\.png$/);
      expect(anchorClickSpy).toHaveBeenCalledTimes(1);
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.stringMatching(/Downloaded .*\.png/),
        'success'
      );
    } finally {
      anchorClickSpy.mockRestore();
      appendChildSpy.mockRestore();
      removeChildSpy.mockRestore();
    }
  });

  it('switches to Print mode, supports Table Cards, Avery 5163, and Avery 5160 sheets, and invokes window.print', async () => {
    const originalPrint = window.print;
    const mockPrint = jest.fn();
    window.print = mockPrint;

    const { container } = render(<PhotoUploadQRModal {...defaultProps} />);

    fireEvent.click(screen.getByTestId('switch-photo-qr-print-view-btn'));
    expect(document.body.classList.contains('printing-qr-labels')).toBe(true);
    expect(document.body.classList.contains('printing-qr-portal')).toBe(false);

    // Default template is Table Cards (4 per sheet)
    const select = screen.getByTestId('photo-qr-print-template-select') as HTMLSelectElement;
    expect(select.value).toBe('table_cards');
    expect(screen.getByTestId('qr-print-sheet')).toBeInTheDocument();
    expect(screen.getAllByTestId('qr-label-card')).toHaveLength(4);

    // Switch to Avery 5163 (10 per sheet)
    fireEvent.change(select, { target: { value: 'avery_5163' } });
    expect(select.value).toBe('avery_5163');
    expect(screen.getAllByTestId('qr-label-card')).toHaveLength(10);

    // Switch to Avery 5160 (30 per sheet)
    fireEvent.change(select, { target: { value: 'avery_5160' } });
    expect(select.value).toBe('avery_5160');
    expect(screen.getAllByTestId('qr-label-card')).toHaveLength(30);

    // Accessibility check in print mode (including WCAG 2.5.3 label-content-name-mismatch & heading-order)
    const results = await axe(container, {
      rules: {
        'label-content-name-mismatch': { enabled: true },
        'heading-order': { enabled: true },
      },
    });
    expect(results).toHaveNoViolations();

    // Trigger print
    fireEvent.click(screen.getByTestId('print-photo-qr-cards-btn'));
    expect(mockPrint).toHaveBeenCalledTimes(1);

    window.print = originalPrint;
  });

  it('confirms before rotating the QR token and invokes onRotateToken', async () => {
    const onRotateToken = jest.fn().mockResolvedValue(undefined);
    render(<PhotoUploadQRModal {...defaultProps} onRotateToken={onRotateToken} />);

    fireEvent.click(screen.getByTestId('rotate-photo-qr-token-btn'));

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledWith(
        expect.stringMatching(/Rotate the guest photo QR link/i)
      );
      expect(onRotateToken).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps #ffffff QR background and >= 4.5:1 module contrast in dark mode', async () => {
    const { ThemeProvider } = await import('@/components/ThemeProvider');
    const { getContrastRatio, hexToRgb } = await import('@/lib/theme/stylesheet');

    const fillStyles: string[] = [];
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = jest.fn(function () {
      const ctx = {
        _fillStyle: '',
        set fillStyle(val: string) {
          this._fillStyle = val;
          fillStyles.push(val);
        },
        get fillStyle() {
          return this._fillStyle;
        },
        fillRect: jest.fn(),
        clearRect: jest.fn(),
        drawImage: jest.fn(),
        scale: jest.fn(),
        imageSmoothingEnabled: true,
      };
      return ctx as unknown as RenderingContext;
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    try {
      render(
        <ThemeProvider
          initialThemeMode="dark"
          config={{
            themePreset: 'romantic',
            colorPrimary: '#f472b6',
          }}
        >
          <PhotoUploadQRModal {...defaultProps} />
        </ThemeProvider>
      );

      const normalizedFills = fillStyles.map((s) => s.toLowerCase());
      expect(normalizedFills).toContain('#ffffff');
      const moduleColors = normalizedFills.filter(
        (c) => /^#[0-9a-f]{6}$/i.test(c) && c !== '#ffffff'
      );
      expect(moduleColors.length).toBeGreaterThan(0);
      for (const fg of moduleColors) {
        expect(getContrastRatio(hexToRgb(fg), hexToRgb('#ffffff'))).toBeGreaterThanOrEqual(4.5);
      }
    } finally {
      HTMLCanvasElement.prototype.getContext = originalGetContext;
    }
  });

  it('warns when configuredUploadUrl origin differs from current host and lets admins toggle between origins', async () => {
    const originalClipboard = navigator.clipboard;
    const writeTextMock = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    try {
      const configuredUrl = 'https://wedding.example.com/photos?qr=signed-token-v2';
      const activeUrl = `${window.location.origin}/photos?qr=signed-token-v2`;

      const { container } = render(
        <PhotoUploadQRModal
          {...defaultProps}
          uploadUrl={configuredUrl}
          configuredUploadUrl={configuredUrl}
          activeUploadUrl={activeUrl}
        />
      );

      const warningBanner = screen.getByTestId('photo-qr-origin-mismatch-warning');
      expect(warningBanner).toBeInTheDocument();
      expect(warningBanner).toHaveTextContent('https://wedding.example.com');
      expect(warningBanner).toHaveTextContent(window.location.origin);

      const urlInput = screen.getByTestId('photo-qr-signed-url-input') as HTMLInputElement;
      expect(urlInput.value).toBe(configuredUrl);

      const activeOriginBtn = screen.getByTestId('photo-qr-origin-active-btn');
      const configuredOriginBtn = screen.getByTestId('photo-qr-origin-configured-btn');
      expect(configuredOriginBtn).toHaveAttribute('aria-pressed', 'true');
      expect(activeOriginBtn).toHaveAttribute('aria-pressed', 'false');

      fireEvent.click(activeOriginBtn);
      expect(activeOriginBtn).toHaveAttribute('aria-pressed', 'true');
      expect(configuredOriginBtn).toHaveAttribute('aria-pressed', 'false');
      expect(urlInput.value).toBe(activeUrl);

      fireEvent.click(screen.getByTestId('copy-photo-qr-link-btn'));
      await waitFor(() => {
        expect(writeTextMock).toHaveBeenCalledWith(activeUrl);
      });

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    } finally {
      Object.assign(navigator, { clipboard: originalClipboard });
    }
  });

  it('retains focus inside the active dialog when toggling preview and print modes and exposes tabIndex=0 on qr-print-sheet', () => {
    render(<PhotoUploadQRModal {...defaultProps} />);

    const dialog = screen.getByRole('dialog', { name: /Guest Photo Upload QR/i });
    const switchToPrintBtn = screen.getByTestId('switch-photo-qr-print-view-btn');
    switchToPrintBtn.focus();
    expect(switchToPrintBtn).toHaveFocus();

    fireEvent.click(switchToPrintBtn);
    expect(dialog.contains(document.activeElement)).toBe(true);

    const printSheet = screen.getByTestId('qr-print-sheet');
    expect(printSheet).toHaveAttribute('tabindex', '0');

    const backToPreviewBtn = screen.getByTestId('back-to-photo-qr-preview-btn');
    backToPreviewBtn.focus();
    fireEvent.click(backToPreviewBtn);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});
