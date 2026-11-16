import { render, screen, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ReceptionSlideshowClient } from '../ReceptionSlideshowClient';

// Mock ThemedQRCode
jest.mock('@/components/ui/ThemedQRCode', () => ({
  ThemedQRCode: ({ value }: { value: string }) => (
    <div data-testid="themed-qr-code" data-value={value} />
  ),
}));

describe('ReceptionSlideshowClient', () => {
  const samplePhotos = [
    { id: '1', url: 'https://example.com/photo1.jpg', title: 'First Dance' },
    { id: '2', url: 'https://example.com/photo2.jpg', title: 'Cake Cutting' },
    { id: '3', url: 'https://example.com/photo3.jpg', title: 'Bouquet Toss' },
  ];

  beforeEach(() => {
    jest.useFakeTimers();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    act(() => {
      jest.clearAllTimers();
    });
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('renders initial photo presentation and QR code overlay with upload URL', () => {
    render(
      <ReceptionSlideshowClient
        initialPhotos={samplePhotos}
        uploadUrl="https://wedding.example.com/photos"
      />
    );

    // Initial image displayed
    const img = screen.getByTestId('slideshow-image');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'https://example.com/photo1.jpg');
    expect(screen.getByText('First Dance')).toBeInTheDocument();

    // QR code overlay is prominently rendered by default
    const qrOverlay = screen.getByTestId('slideshow-qr-overlay');
    expect(qrOverlay).toBeInTheDocument();

    const qrCode = screen.getByTestId('themed-qr-code');
    expect(qrCode).toHaveAttribute('data-value', 'https://wedding.example.com/photos');
    expect(screen.getByTestId('slideshow-upload-url')).toHaveTextContent(
      'https://wedding.example.com/photos'
    );
  });

  it('cycles images automatically according to configured duration', () => {
    render(
      <ReceptionSlideshowClient
        initialPhotos={samplePhotos}
        uploadUrl="https://wedding.example.com/photos"
      />
    );

    // Default duration is 8 seconds
    expect(screen.getByTestId('slideshow-image')).toHaveAttribute(
      'src',
      'https://example.com/photo1.jpg'
    );

    act(() => {
      jest.advanceTimersByTime(8000);
    });

    expect(screen.getByTestId('slideshow-image')).toHaveAttribute(
      'src',
      'https://example.com/photo2.jpg'
    );
    expect(screen.getByText('Cake Cutting')).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(8000);
    });

    expect(screen.getByTestId('slideshow-image')).toHaveAttribute(
      'src',
      'https://example.com/photo3.jpg'
    );
    expect(screen.getByText('Bouquet Toss')).toBeInTheDocument();

    // Loops back to first
    act(() => {
      jest.advanceTimersByTime(8000);
    });
    expect(screen.getByTestId('slideshow-image')).toHaveAttribute(
      'src',
      'https://example.com/photo1.jpg'
    );
  });

  it('allows switching cycle duration to 5s, 8s, or 10s', () => {
    render(
      <ReceptionSlideshowClient
        initialPhotos={samplePhotos}
        uploadUrl="https://wedding.example.com/photos"
      />
    );

    // Click 5s button
    const btn5s = screen.getByTestId('slideshow-duration-5s-btn');
    fireEvent.click(btn5s);
    expect(btn5s).toHaveAttribute('aria-pressed', 'true');

    expect(screen.getByTestId('slideshow-image')).toHaveAttribute(
      'src',
      'https://example.com/photo1.jpg'
    );

    // 5 seconds advance
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId('slideshow-image')).toHaveAttribute(
      'src',
      'https://example.com/photo2.jpg'
    );

    // Switch to 10s button
    const btn10s = screen.getByTestId('slideshow-duration-10s-btn');
    fireEvent.click(btn10s);
    expect(btn10s).toHaveAttribute('aria-pressed', 'true');

    act(() => {
      jest.advanceTimersByTime(9000);
    });
    // Not yet advanced at 9s
    expect(screen.getByTestId('slideshow-image')).toHaveAttribute(
      'src',
      'https://example.com/photo2.jpg'
    );

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    // Advanced at 10s
    expect(screen.getByTestId('slideshow-image')).toHaveAttribute(
      'src',
      'https://example.com/photo3.jpg'
    );
  });

  it('allows manual navigation with previous and next buttons', () => {
    render(
      <ReceptionSlideshowClient
        initialPhotos={samplePhotos}
        uploadUrl="https://wedding.example.com/photos"
      />
    );

    const nextBtn = screen.getByTestId('slideshow-next-btn');
    const prevBtn = screen.getByTestId('slideshow-prev-btn');

    fireEvent.click(nextBtn);
    expect(screen.getByTestId('slideshow-image')).toHaveAttribute(
      'src',
      'https://example.com/photo2.jpg'
    );

    fireEvent.click(prevBtn);
    expect(screen.getByTestId('slideshow-image')).toHaveAttribute(
      'src',
      'https://example.com/photo1.jpg'
    );

    // Previous from 0 wraps to end
    fireEvent.click(prevBtn);
    expect(screen.getByTestId('slideshow-image')).toHaveAttribute(
      'src',
      'https://example.com/photo3.jpg'
    );
  });

  it('toggles playback with play/pause button', () => {
    render(
      <ReceptionSlideshowClient
        initialPhotos={samplePhotos}
        uploadUrl="https://wedding.example.com/photos"
      />
    );

    const playPauseBtn = screen.getByTestId('slideshow-play-pause-btn');
    expect(playPauseBtn).toHaveAttribute('aria-label', 'Pause slideshow');

    // Pause
    fireEvent.click(playPauseBtn);
    expect(playPauseBtn).toHaveAttribute('aria-label', 'Play slideshow');

    // Time passes while paused; photo should not advance
    act(() => {
      jest.advanceTimersByTime(20000);
    });
    expect(screen.getByTestId('slideshow-image')).toHaveAttribute(
      'src',
      'https://example.com/photo1.jpg'
    );

    // Resume
    fireEvent.click(playPauseBtn);
    expect(playPauseBtn).toHaveAttribute('aria-label', 'Pause slideshow');

    act(() => {
      jest.advanceTimersByTime(8000);
    });
    expect(screen.getByTestId('slideshow-image')).toHaveAttribute(
      'src',
      'https://example.com/photo2.jpg'
    );
  });

  it('toggles QR code overlay visibility', () => {
    render(
      <ReceptionSlideshowClient
        initialPhotos={samplePhotos}
        uploadUrl="https://wedding.example.com/photos"
      />
    );

    expect(screen.getByTestId('slideshow-qr-overlay')).toBeInTheDocument();

    // Click close button on overlay
    const closeBtn = screen.getByTestId('slideshow-qr-close-btn');
    fireEvent.click(closeBtn);
    expect(screen.queryByTestId('slideshow-qr-overlay')).not.toBeInTheDocument();

    // Toggle back on with toolbar button
    const qrToggleBtn = screen.getByTestId('slideshow-qr-toggle-btn');
    fireEvent.click(qrToggleBtn);
    expect(screen.getByTestId('slideshow-qr-overlay')).toBeInTheDocument();
  });

  it('hides controls and cursor after 3 seconds of user inactivity, and reveals on mouse movement', () => {
    render(
      <ReceptionSlideshowClient
        initialPhotos={samplePhotos}
        uploadUrl="https://wedding.example.com/photos"
      />
    );

    const container = screen.getByTestId('slideshow-container');
    const controls = screen.getByTestId('slideshow-controls');

    // Initially visible
    expect(container).toHaveClass('cursor-default');
    expect(controls).toHaveClass('opacity-100');

    // Advance 3 seconds of inactivity
    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(container).toHaveClass('cursor-none');
    expect(controls).toHaveClass('opacity-0');

    // Mouse movement activity reveals controls immediately
    act(() => {
      fireEvent.mouseMove(window);
    });

    expect(container).toHaveClass('cursor-default');
    expect(controls).toHaveClass('opacity-100');

    // Inactivity hides again after 3 seconds
    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(container).toHaveClass('cursor-none');
    expect(controls).toHaveClass('opacity-0');
  });

  it('periodically polls API and appends new approved photos to the presentation queue', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        photos: [
          ...samplePhotos,
          {
            id: '4',
            url: 'https://example.com/photo4-guest.jpg',
            title: 'Guest Group Selfie',
            isGuestUpload: true,
          },
        ],
      }),
    });
    global.fetch = mockFetch;

    render(
      <ReceptionSlideshowClient
        initialPhotos={samplePhotos}
        uploadUrl="https://wedding.example.com/photos"
      />
    );

    // Fast-forward 30 seconds for polling interval
    await act(async () => {
      jest.advanceTimersByTime(30000);
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/photos');

    // Check that queue now has 4 photos
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('passes ?since= in its 30-second polling requests when initialPhotos include createdAt timestamps', async () => {
    const photosWithTimestamps = [
      { id: '1', url: 'https://example.com/photo1.jpg', title: 'First Dance', createdAt: '2026-06-20T18:00:00.000Z' },
      { id: '2', url: 'https://example.com/photo2.jpg', title: 'Cake Cutting', createdAt: '2026-06-20T18:30:00.000Z' },
    ];

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        photos: [],
      }),
    });
    global.fetch = mockFetch;

    render(
      <ReceptionSlideshowClient
        initialPhotos={photosWithTimestamps}
        uploadUrl="https://wedding.example.com/photos"
      />
    );

    await act(async () => {
      jest.advanceTimersByTime(30000);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/photos?since=2026-06-20T18%3A30%3A00.000Z'
    );
  });

  it('updates timestamp cursor upon receiving new incremental photos and queries with new cursor', async () => {
    const photosWithTimestamps = [
      { id: '1', url: 'https://example.com/photo1.jpg', title: 'First Dance', createdAt: '2026-06-20T18:00:00.000Z' },
    ];

    const mockFetch = jest
      .fn()
      // First poll returns a new photo with timestamp 18:45:00
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          photos: [
            {
              id: '2',
              url: 'https://example.com/photo2-guest.jpg',
              title: 'Guest Cheer',
              createdAt: '2026-06-20T18:45:00.000Z',
              isGuestUpload: true,
            },
          ],
        }),
      })
      // Second poll returns empty
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          photos: [],
        }),
      });
    global.fetch = mockFetch;

    render(
      <ReceptionSlideshowClient
        initialPhotos={photosWithTimestamps}
        uploadUrl="https://wedding.example.com/photos"
      />
    );

    // First 30s poll
    await act(async () => {
      jest.advanceTimersByTime(30000);
    });

    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      '/api/photos?since=2026-06-20T18%3A00%3A00.000Z'
    );

    // Second 30s poll uses the updated cursor
    await act(async () => {
      jest.advanceTimersByTime(30000);
    });

    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      '/api/photos?since=2026-06-20T18%3A45%3A00.000Z'
    );
  });

  it('handles empty incremental response without mutating photo queue', async () => {
    const photosWithTimestamps = [
      { id: '1', url: 'https://example.com/photo1.jpg', title: 'First Dance', createdAt: '2026-06-20T18:00:00.000Z' },
    ];

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        photos: [],
      }),
    });
    global.fetch = mockFetch;

    render(
      <ReceptionSlideshowClient
        initialPhotos={photosWithTimestamps}
        uploadUrl="https://wedding.example.com/photos"
      />
    );

    await act(async () => {
      jest.advanceTimersByTime(30000);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/photos?since=2026-06-20T18%3A00%3A00.000Z'
    );
    expect(screen.getByTestId('slideshow-image')).toHaveAttribute(
      'src',
      'https://example.com/photo1.jpg'
    );
  });

  it('handles network disconnection gracefully by continuing to loop cached photos without crashing', async () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const mockFetch = jest.fn().mockRejectedValue(new Error('Network disconnected'));
    global.fetch = mockFetch;

    render(
      <ReceptionSlideshowClient
        initialPhotos={samplePhotos}
        uploadUrl="https://wedding.example.com/photos"
      />
    );

    // Advance 30 seconds to trigger polling failure
    await act(async () => {
      jest.advanceTimersByTime(30000);
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/photos');
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unable to fetch latest photos'),
      expect.any(Error)
    );

    // Presentation is completely unblocked and continues cycling cached photos
    act(() => {
      jest.advanceTimersByTime(8000);
    });

    expect(screen.getByTestId('slideshow-image')).toHaveAttribute(
      'src',
      'https://example.com/photo2.jpg'
    );

    consoleWarnSpy.mockRestore();
  });
});
