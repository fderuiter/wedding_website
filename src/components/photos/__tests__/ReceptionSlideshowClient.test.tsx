import { render, screen, act, fireEvent, createEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import { ReceptionSlideshowClient } from '../ReceptionSlideshowClient';

expect.extend(toHaveNoViolations);

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

    // Click 5s button (accessible name begins with visible "5s")
    const btn5s = screen.getByRole('button', {
      name: '5s cycle photo every 5 seconds',
    });
    expect(
      screen.getByRole('button', { name: '8s cycle photo every 8 seconds' })
    ).toHaveAttribute('aria-pressed', 'true');
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
    const btn10s = screen.getByRole('button', {
      name: '10s cycle photo every 10 seconds',
    });
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

  it('hides secondary controls, header, and stage cursor after 3 seconds of user inactivity while keeping pause accessible', () => {
    render(
      <ReceptionSlideshowClient
        initialPhotos={samplePhotos}
        uploadUrl="https://wedding.example.com/photos"
      />
    );

    const container = screen.getByTestId('slideshow-container');
    const header = screen.getByTestId('slideshow-top-header');
    const controls = screen.getByTestId('slideshow-controls');
    const secondaryControls = screen.getByTestId('slideshow-secondary-controls');
    const playPauseBtn = screen.getByTestId('slideshow-play-pause-btn');

    const expectPauseOutsideHiddenWrappers = () => {
      let current: HTMLElement | null = playPauseBtn;
      while (current) {
        expect(current).not.toHaveClass('opacity-0');
        expect(current).not.toHaveClass('pointer-events-none');
        current = current.parentElement;
      }
      expect(playPauseBtn).toHaveClass('cursor-pointer');
    };

    // Initially visible
    expect(container).toHaveClass('cursor-default');
    expect(header).toHaveClass('opacity-100');
    expect(secondaryControls).toHaveClass('opacity-100');
    expect(controls).not.toHaveClass('opacity-0');
    expectPauseOutsideHiddenWrappers();

    // Advance 3 seconds of inactivity during auto-play
    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(container).toHaveClass('cursor-none');
    expect(header).toHaveClass('opacity-0', 'pointer-events-none');
    expect(secondaryControls).toHaveClass('opacity-0', 'pointer-events-none');
    expectPauseOutsideHiddenWrappers();

    // Mouse movement activity reveals header and secondary controls immediately
    act(() => {
      fireEvent.mouseMove(window);
    });

    expect(container).toHaveClass('cursor-default');
    expect(header).toHaveClass('opacity-100');
    expect(secondaryControls).toHaveClass('opacity-100');

    // Inactivity hides secondary controls again after 3 seconds while pause stays accessible
    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(container).toHaveClass('cursor-none');
    expect(header).toHaveClass('opacity-0', 'pointer-events-none');
    expect(secondaryControls).toHaveClass('opacity-0', 'pointer-events-none');
    expectPauseOutsideHiddenWrappers();
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

  it('skips broken photos automatically and advances immediately to the next slide on image error', () => {
    render(
      <ReceptionSlideshowClient
        initialPhotos={samplePhotos}
        uploadUrl="https://wedding.example.com/photos"
      />
    );

    // Initial image is photo 1
    const img = screen.getByTestId('slideshow-image');
    expect(img).toHaveAttribute('src', 'https://example.com/photo1.jpg');
    expect(screen.getByText('First Dance')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();

    // Trigger image error on active slide
    fireEvent.error(img);

    // Immediately advances to photo 2 without waiting for duration timer
    const updatedImg = screen.getByTestId('slideshow-image');
    expect(updatedImg).toHaveAttribute('src', 'https://example.com/photo2.jpg');
    expect(screen.getByText('Cake Cutting')).toBeInTheDocument();

    // Broken photo is removed from the queue: total count is now 2
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders empty state when initialPhotos is empty instead of third-party sample images', () => {
    render(
      <ReceptionSlideshowClient
        initialPhotos={[]}
        uploadUrl="https://wedding.example.com/photos"
      />
    );

    expect(screen.getByTestId('slideshow-empty-state')).toBeInTheDocument();
    expect(screen.getByText('No photos published yet')).toBeInTheDocument();
    expect(screen.queryByTestId('slideshow-image')).not.toBeInTheDocument();
  });

  it('transitions cleanly to empty state when all active photos fail to load without infinite loops', () => {
    const brokenPhotos = [
      { id: 'b1', url: 'https://broken.example.com/1.jpg', title: 'Broken Photo 1' },
      { id: 'b2', url: 'https://broken.example.com/2.jpg', title: 'Broken Photo 2' },
    ];

    render(
      <ReceptionSlideshowClient
        initialPhotos={brokenPhotos}
        uploadUrl="https://wedding.example.com/photos"
      />
    );

    expect(screen.getByTestId('slideshow-image')).toHaveAttribute(
      'src',
      'https://broken.example.com/1.jpg'
    );

    fireEvent.error(screen.getByTestId('slideshow-image'));
    expect(screen.getByTestId('slideshow-image')).toHaveAttribute(
      'src',
      'https://broken.example.com/2.jpg'
    );

    fireEvent.error(screen.getByTestId('slideshow-image'));

    expect(screen.queryByTestId('slideshow-image')).not.toBeInTheDocument();
    expect(screen.getByTestId('slideshow-empty-state')).toBeInTheDocument();
  });

  it('ignores broken photo URLs during periodic polling so failed photos are not re-added', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        photos: [
          {
            id: '1',
            url: 'https://example.com/photo1.jpg',
            title: 'First Dance',
          },
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

    // Initial image is photo 1
    const img = screen.getByTestId('slideshow-image');
    expect(img).toHaveAttribute('src', 'https://example.com/photo1.jpg');

    // Trigger error on photo 1 -> photo 1 is marked as failed and skipped
    fireEvent.error(img);
    expect(screen.getByTestId('slideshow-image')).toHaveAttribute(
      'src',
      'https://example.com/photo2.jpg'
    );
    // Queue now has 2 photos (photo2, photo3)
    expect(screen.getByText('2')).toBeInTheDocument();

    // Trigger polling interval (30s)
    await act(async () => {
      jest.advanceTimersByTime(30000);
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/photos');

    // Queue should now have 3 photos: photo2, photo3, and newly approved photo4.
    // The failed photo1 was ignored and NOT re-added to the queue!
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('keeps controls visible after 3 seconds when a toolbar button holds keyboard focus', () => {
    render(
      <ReceptionSlideshowClient
        initialPhotos={samplePhotos}
        uploadUrl="https://wedding.example.com/photos"
      />
    );

    const container = screen.getByTestId('slideshow-container');
    const secondaryControls = screen.getByTestId('slideshow-secondary-controls');
    const header = screen.getByTestId('slideshow-top-header');
    const playPauseBtn = screen.getByTestId('slideshow-play-pause-btn');

    // Header and secondary controls have focus-within classes
    expect(header).toHaveClass('focus-within:opacity-100');
    expect(header).toHaveClass('focus-within:pointer-events-auto');
    expect(secondaryControls).toHaveClass('focus-within:opacity-100');
    expect(secondaryControls).toHaveClass('focus-within:pointer-events-auto');
    expect(secondaryControls).toHaveClass('group-focus-within:opacity-100');
    expect(secondaryControls).toHaveClass('group-focus-within:pointer-events-auto');

    // Focus play/pause button
    act(() => {
      playPauseBtn.focus();
    });

    // Advance 3 seconds of inactivity
    act(() => {
      jest.advanceTimersByTime(3000);
    });

    // Controls remain visible and cursor default
    expect(container).toHaveClass('cursor-default');
    expect(header).toHaveClass('opacity-100');
    expect(secondaryControls).toHaveClass('opacity-100');

    // Advance another 5 seconds
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(container).toHaveClass('cursor-default');
    expect(header).toHaveClass('opacity-100');
    expect(secondaryControls).toHaveClass('opacity-100');
  });

  it('hides secondary controls after 3 seconds only when focus moves outside the controls', () => {
    render(
      <ReceptionSlideshowClient
        initialPhotos={samplePhotos}
        uploadUrl="https://wedding.example.com/photos"
      />
    );

    const container = screen.getByTestId('slideshow-container');
    const secondaryControls = screen.getByTestId('slideshow-secondary-controls');
    const playPauseBtn = screen.getByTestId('slideshow-play-pause-btn');
    const prevBtn = screen.getByTestId('slideshow-prev-btn');

    // Focus previous button
    act(() => {
      prevBtn.focus();
    });

    // Advance 3 seconds - still visible because focus is retained
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(secondaryControls).toHaveClass('opacity-100');
    expect(container).toHaveClass('cursor-default');

    // Blur the button (focus moves outside)
    act(() => {
      prevBtn.blur();
    });

    // Controls are still visible immediately after blur
    expect(secondaryControls).toHaveClass('opacity-100');

    // Advance 3 seconds after focus left
    act(() => {
      jest.advanceTimersByTime(3000);
    });

    // Secondary controls and cursor hide while pause remains accessible
    expect(secondaryControls).toHaveClass('opacity-0', 'pointer-events-none');
    expect(container).toHaveClass('cursor-none');
    expect(playPauseBtn).not.toHaveClass('opacity-0');
    expect(playPauseBtn).not.toHaveClass('pointer-events-none');
  });

  it('restarts inactivity timer when tabbing outside the slideshow container', () => {
    render(
      <ReceptionSlideshowClient
        initialPhotos={samplePhotos}
        uploadUrl="https://wedding.example.com/photos"
      />
    );

    const container = screen.getByTestId('slideshow-container');
    const secondaryControls = screen.getByTestId('slideshow-secondary-controls');
    const playPauseBtn = screen.getByTestId('slideshow-play-pause-btn');
    const nextBtn = screen.getByTestId('slideshow-next-btn');

    const outsideButton = document.createElement('button');
    outsideButton.setAttribute('data-testid', 'outside-button');
    document.body.appendChild(outsideButton);

    try {
      // Focus toolbar button
      act(() => {
        nextBtn.focus();
      });

      act(() => {
        jest.advanceTimersByTime(3000);
      });
      expect(secondaryControls).toHaveClass('opacity-100');

      // Tab/focus outside container
      act(() => {
        outsideButton.focus();
      });

      // Still visible before timer elapses
      act(() => {
        jest.advanceTimersByTime(1500);
      });
      expect(secondaryControls).toHaveClass('opacity-100');

      // Hides secondary controls after full 3 seconds while pause stays accessible
      act(() => {
        jest.advanceTimersByTime(1500);
      });
      expect(secondaryControls).toHaveClass('opacity-0', 'pointer-events-none');
      expect(container).toHaveClass('cursor-none');
      expect(playPauseBtn).not.toHaveClass('opacity-0');
    } finally {
      outsideButton.remove();
    }
  });

  it('maintains focus and controls visibility during fullscreen toggle without premature fading', () => {
    render(
      <ReceptionSlideshowClient
        initialPhotos={samplePhotos}
        uploadUrl="https://wedding.example.com/photos"
      />
    );

    const container = screen.getByTestId('slideshow-container');
    const secondaryControls = screen.getByTestId('slideshow-secondary-controls');
    const fullscreenBtn = screen.getByTestId('slideshow-fullscreen-btn');

    // Focus fullscreen toggle
    act(() => {
      fullscreenBtn.focus();
    });

    // Click toggle to trigger fullscreen transition
    act(() => {
      fireEvent.click(fullscreenBtn);
    });

    // Verify focus is maintained and controls don't prematurely fade after 3 seconds
    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(secondaryControls).toHaveClass('opacity-100');
    expect(container).toHaveClass('cursor-default');
  });

  it('maintains controls visibility when moving focus between toolbar buttons', () => {
    render(
      <ReceptionSlideshowClient
        initialPhotos={samplePhotos}
        uploadUrl="https://wedding.example.com/photos"
      />
    );

    const container = screen.getByTestId('slideshow-container');
    const secondaryControls = screen.getByTestId('slideshow-secondary-controls');
    const prevBtn = screen.getByTestId('slideshow-prev-btn');
    const nextBtn = screen.getByTestId('slideshow-next-btn');

    // Focus previous button
    act(() => {
      prevBtn.focus();
    });

    // Advance 2 seconds
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(secondaryControls).toHaveClass('opacity-100');

    // Focus next button
    act(() => {
      nextBtn.focus();
    });

    // Advance 2 more seconds (total 4 seconds since initial focus)
    act(() => {
      jest.advanceTimersByTime(2000);
    });

    // Controls remain visible
    expect(secondaryControls).toHaveClass('opacity-100');
    expect(container).toHaveClass('cursor-default');
  });

  it('reveals faded header and secondary toolbar controls when focus moves into a faded secondary button', () => {
    render(
      <ReceptionSlideshowClient
        initialPhotos={samplePhotos}
        uploadUrl="https://wedding.example.com/photos"
      />
    );

    const header = screen.getByTestId('slideshow-top-header');
    const secondaryControls = screen.getByTestId('slideshow-secondary-controls');
    const nextBtn = screen.getByTestId('slideshow-next-btn');

    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(header).toHaveClass('opacity-0', 'pointer-events-none');
    expect(secondaryControls).toHaveClass('opacity-0', 'pointer-events-none');

    act(() => {
      nextBtn.focus();
    });

    expect(header).toHaveClass('opacity-100', 'pointer-events-auto');
    expect(secondaryControls).toHaveClass('opacity-100', 'pointer-events-auto');
  });

  it('keeps all toolbar controls and header visible whenever playback is paused', () => {
    render(
      <ReceptionSlideshowClient
        initialPhotos={samplePhotos}
        uploadUrl="https://wedding.example.com/photos"
      />
    );

    const container = screen.getByTestId('slideshow-container');
    const header = screen.getByTestId('slideshow-top-header');
    const secondaryControls = screen.getByTestId('slideshow-secondary-controls');
    const playPauseBtn = screen.getByTestId('slideshow-play-pause-btn');

    // Pause playback
    fireEvent.click(playPauseBtn);
    expect(playPauseBtn).toHaveAttribute('aria-label', 'Play slideshow');

    // Advance well past 3-second inactivity threshold while paused
    act(() => {
      jest.advanceTimersByTime(10000);
    });

    expect(container).toHaveClass('cursor-default');
    expect(header).toHaveClass('opacity-100', 'pointer-events-auto');
    expect(secondaryControls).toHaveClass('opacity-100', 'pointer-events-auto');

    // Resume playback -> controls remain visible initially, then fade after 3 seconds
    fireEvent.click(playPauseBtn);
    expect(playPauseBtn).toHaveAttribute('aria-label', 'Pause slideshow');
    expect(secondaryControls).toHaveClass('opacity-100');

    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(secondaryControls).toHaveClass('opacity-0', 'pointer-events-none');
  });

  it('preserves native Space activation on focused buttons without double-toggling playback', () => {
    render(
      <ReceptionSlideshowClient
        initialPhotos={samplePhotos}
        uploadUrl="https://wedding.example.com/photos"
      />
    );

    const playPauseBtn = screen.getByTestId('slideshow-play-pause-btn');
    const nextBtn = screen.getByTestId('slideshow-next-btn');
    const backLink = screen.getByTestId('slideshow-back-link');

    // Pressing Space on focused play/pause button must not preventDefault or pre-toggle state
    act(() => {
      playPauseBtn.focus();
    });
    const spaceOnPlayPause = createEvent.keyDown(playPauseBtn, { key: ' ', code: 'Space' });
    fireEvent(playPauseBtn, spaceOnPlayPause);
    expect(spaceOnPlayPause.defaultPrevented).toBe(false);
    expect(playPauseBtn).toHaveAttribute('aria-label', 'Pause slideshow');

    // Native button click resulting from Space toggles playback once
    fireEvent.click(playPauseBtn);
    expect(playPauseBtn).toHaveAttribute('aria-label', 'Play slideshow');

    // Resume playback
    fireEvent.click(playPauseBtn);
    expect(playPauseBtn).toHaveAttribute('aria-label', 'Pause slideshow');

    // Pressing Space, f, or q on another focused button or link does not trigger global shortcuts
    act(() => {
      nextBtn.focus();
    });
    const spaceOnNext = createEvent.keyDown(nextBtn, { key: ' ', code: 'Space' });
    fireEvent(nextBtn, spaceOnNext);
    expect(spaceOnNext.defaultPrevented).toBe(false);
    expect(playPauseBtn).toHaveAttribute('aria-label', 'Pause slideshow');

    const qOnNext = createEvent.keyDown(nextBtn, { key: 'q' });
    fireEvent(nextBtn, qOnNext);
    expect(qOnNext.defaultPrevented).toBe(false);
    expect(screen.getByTestId('slideshow-qr-overlay')).toBeInTheDocument();

    act(() => {
      backLink.focus();
    });
    const qOnLink = createEvent.keyDown(backLink, { key: 'q' });
    fireEvent(backLink, qOnLink);
    expect(qOnLink.defaultPrevented).toBe(false);
    expect(screen.getByTestId('slideshow-qr-overlay')).toBeInTheDocument();

    // Editable elements also skip shortcuts
    const editableDiv = document.createElement('div');
    editableDiv.setAttribute('contenteditable', 'true');
    document.body.appendChild(editableDiv);
    try {
      const qOnEditable = createEvent.keyDown(editableDiv, { key: 'q' });
      fireEvent(editableDiv, qOnEditable);
      expect(qOnEditable.defaultPrevented).toBe(false);
      expect(screen.getByTestId('slideshow-qr-overlay')).toBeInTheDocument();
    } finally {
      editableDiv.remove();
    }
  });

  it('passes through modified key combinations such as Ctrl+F, Meta+F, Alt+Q, and Ctrl+Space', () => {
    const requestFullscreenMock = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      writable: true,
      value: requestFullscreenMock,
    });

    render(
      <ReceptionSlideshowClient
        initialPhotos={samplePhotos}
        uploadUrl="https://wedding.example.com/photos"
      />
    );

    const playPauseBtn = screen.getByTestId('slideshow-play-pause-btn');

    const ctrlF = createEvent.keyDown(window, { key: 'f', ctrlKey: true });
    fireEvent(window, ctrlF);
    expect(ctrlF.defaultPrevented).toBe(false);
    expect(requestFullscreenMock).not.toHaveBeenCalled();

    const metaF = createEvent.keyDown(window, { key: 'f', metaKey: true });
    fireEvent(window, metaF);
    expect(metaF.defaultPrevented).toBe(false);
    expect(requestFullscreenMock).not.toHaveBeenCalled();

    const altQ = createEvent.keyDown(window, { key: 'q', altKey: true });
    fireEvent(window, altQ);
    expect(altQ.defaultPrevented).toBe(false);
    expect(screen.getByTestId('slideshow-qr-overlay')).toBeInTheDocument();

    const ctrlSpace = createEvent.keyDown(window, { key: ' ', code: 'Space', ctrlKey: true });
    fireEvent(window, ctrlSpace);
    expect(ctrlSpace.defaultPrevented).toBe(false);
    expect(playPauseBtn).toHaveAttribute('aria-label', 'Pause slideshow');
  });

  it('allows turning off Space, f, and q shortcuts via the toolbar toggle while preserving Arrow and Escape keys', () => {
    const requestFullscreenMock = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      writable: true,
      value: requestFullscreenMock,
    });

    render(
      <ReceptionSlideshowClient
        initialPhotos={samplePhotos}
        uploadUrl="https://wedding.example.com/photos"
      />
    );

    const shortcutsBtn = screen.getByTestId('slideshow-shortcuts-toggle-btn');
    const playPauseBtn = screen.getByTestId('slideshow-play-pause-btn');

    expect(shortcutsBtn.tagName).toBe('BUTTON');
    expect(shortcutsBtn).toHaveAttribute('type', 'button');
    expect(shortcutsBtn).toHaveAttribute('aria-pressed', 'true');
    expect(shortcutsBtn).toHaveAttribute('aria-label', 'Keyboard shortcuts (Space, F, Q)');

    // Turn off single-key shortcuts
    fireEvent.click(shortcutsBtn);
    expect(shortcutsBtn).toHaveAttribute('aria-pressed', 'false');

    // Unmodified Space, f, and q are now ignored
    const spaceEvt = createEvent.keyDown(window, { key: ' ', code: 'Space' });
    fireEvent(window, spaceEvt);
    expect(spaceEvt.defaultPrevented).toBe(false);
    expect(playPauseBtn).toHaveAttribute('aria-label', 'Pause slideshow');

    const fEvt = createEvent.keyDown(window, { key: 'f' });
    fireEvent(window, fEvt);
    expect(fEvt.defaultPrevented).toBe(false);
    expect(requestFullscreenMock).not.toHaveBeenCalled();

    const qEvt = createEvent.keyDown(window, { key: 'q' });
    fireEvent(window, qEvt);
    expect(qEvt.defaultPrevented).toBe(false);
    expect(screen.getByTestId('slideshow-qr-overlay')).toBeInTheDocument();

    // ArrowRight, ArrowLeft, and Escape still work when character shortcuts are disabled
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByTestId('slideshow-image')).toHaveAttribute(
      'src',
      'https://example.com/photo2.jpg'
    );

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByTestId('slideshow-image')).toHaveAttribute(
      'src',
      'https://example.com/photo1.jpg'
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('slideshow-qr-overlay')).not.toBeInTheDocument();

    // Re-enable single-key shortcuts and verify they work again
    fireEvent.click(shortcutsBtn);
    expect(shortcutsBtn).toHaveAttribute('aria-pressed', 'true');

    fireEvent.keyDown(window, { key: 'q' });
    expect(screen.getByTestId('slideshow-qr-overlay')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: ' ', code: 'Space' });
    expect(playPauseBtn).toHaveAttribute('aria-label', 'Play slideshow');
  });

  it('sets aria-live to off during automatic playback and restores polite when paused', () => {
    render(
      <ReceptionSlideshowClient
        initialPhotos={samplePhotos}
        uploadUrl="https://wedding.example.com/photos"
      />
    );

    const liveRegion = screen.getByTestId('slideshow-live-region');
    const playPauseBtn = screen.getByTestId('slideshow-play-pause-btn');
    const nextBtn = screen.getByTestId('slideshow-next-btn');

    // Silenced during auto-play
    expect(liveRegion).toHaveAttribute('aria-live', 'off');
    expect(liveRegion).toHaveTextContent('Photo 1 of 3: First Dance');

    // Pause restores polite announcements for manual navigation
    fireEvent.click(playPauseBtn);
    expect(liveRegion).toHaveAttribute('aria-live', 'polite');

    fireEvent.click(nextBtn);
    expect(liveRegion).toHaveTextContent('Photo 2 of 3: Cake Cutting');

    // Resuming playback silences automatic live announcements again
    fireEvent.click(playPauseBtn);
    expect(liveRegion).toHaveAttribute('aria-live', 'off');
  });

  it('has no automated axe accessibility violations on slideshow controls in playing or paused states', async () => {
    const { container } = render(
      <ReceptionSlideshowClient
        initialPhotos={samplePhotos}
        uploadUrl="https://wedding.example.com/photos"
      />
    );

    act(() => {
      jest.advanceTimersByTime(50);
    });
    jest.useRealTimers();

    const secondaryControls = screen.getByTestId('slideshow-secondary-controls');
    const playPauseBtn = screen.getByTestId('slideshow-play-pause-btn');
    const speed5Btn = screen.getByTestId('slideshow-duration-5s-btn');
    const speed8Btn = screen.getByTestId('slideshow-duration-8s-btn');
    const speed10Btn = screen.getByTestId('slideshow-duration-10s-btn');

    expect(speed5Btn).toHaveAccessibleName(/^5s\b/i);
    expect(speed8Btn).toHaveAccessibleName(/^8s\b/i);
    expect(speed10Btn).toHaveAccessibleName(/^10s\b/i);
    expect(speed8Btn).toHaveAttribute('aria-pressed', 'true');
    expect(speed5Btn).toHaveAttribute('aria-pressed', 'false');
    expect(speed10Btn).toHaveAttribute('aria-pressed', 'false');

    const axeRules = { rules: { 'label-content-name-mismatch': { enabled: true } } };
    expect(await axe(container, axeRules)).toHaveNoViolations();
    expect(await axe(secondaryControls, axeRules)).toHaveNoViolations();
    expect(await axe(playPauseBtn, axeRules)).toHaveNoViolations();

    fireEvent.click(speed5Btn);
    expect(speed5Btn).toHaveAttribute('aria-pressed', 'true');
    expect(speed8Btn).toHaveAttribute('aria-pressed', 'false');
    expect(await axe(secondaryControls, axeRules)).toHaveNoViolations();

    fireEvent.click(playPauseBtn);
    expect(await axe(container, axeRules)).toHaveNoViolations();
    expect(await axe(secondaryControls, axeRules)).toHaveNoViolations();
    expect(await axe(playPauseBtn, axeRules)).toHaveNoViolations();
  });

  it('displays guest caption and uploaderName attribution on initial photos and newly polled photos', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        photos: [
          {
            id: 'polled-guest-1',
            url: 'https://example.com/polled-guest.jpg',
            title: 'Late Night Tacos',
            caption: 'Late Night Tacos',
            uploaderName: 'Cousin Leo',
            isGuestUpload: true,
            createdAt: '2026-06-20T22:00:00.000Z',
          },
        ],
      }),
    });

    render(
      <ReceptionSlideshowClient
        initialPhotos={[
          {
            id: 'guest-init-1',
            url: 'https://example.com/sparklers.jpg',
            title: 'Sparkler exit!',
            caption: 'Sparkler exit!',
            uploaderName: 'Aunt Clara',
            isGuestUpload: true,
            createdAt: '2026-06-20T21:00:00.000Z',
          },
        ]}
        uploadUrl="https://wedding.example.com/photos"
      />
    );

    expect(screen.getByTestId('slideshow-photo-title')).toHaveTextContent('Sparkler exit!');
    expect(screen.getByTestId('slideshow-photo-attribution')).toHaveTextContent('Shared by Aunt Clara');

    await act(async () => {
      jest.advanceTimersByTime(30000);
    });

    fireEvent.click(screen.getByTestId('slideshow-next-btn'));
    expect(screen.getByTestId('slideshow-photo-title')).toHaveTextContent('Late Night Tacos');
    expect(screen.getByTestId('slideshow-photo-attribution')).toHaveTextContent('Shared by Cousin Leo');
  });

  it('defaults QR code link to /photos?tab=guest when uploadUrl is omitted, advances cursor using updatedAt on out-of-order approvals, and refreshes existing slide captions in-place', async () => {
    const mockFetch = jest
      .fn()
      // First poll: returns an out-of-order approved photo (createdAt BEFORE initial updatedAt, updatedAt AFTER)
      // plus an updated caption on existing slide 'slide-1'
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          photos: [
            {
              id: 'slide-1',
              url: 'https://example.com/sparklers.jpg',
              title: 'Polished Sparkler Send-Off',
              caption: 'Polished Sparkler Send-Off',
              uploaderName: 'Clara & Joe',
              isGuestUpload: true,
              createdAt: '2026-06-20T20:00:00.000Z',
              updatedAt: '2026-06-20T21:10:00.000Z',
            },
            {
              id: 'slide-early-upload',
              url: 'https://example.com/early-upload.jpg',
              title: 'Cocktail Hour Candid',
              caption: 'Cocktail Hour Candid',
              uploaderName: 'Uncle Bob',
              isGuestUpload: true,
              createdAt: '2026-06-20T19:00:00.000Z',
              updatedAt: '2026-06-20T21:20:00.000Z',
            },
          ],
        }),
      })
      // Second poll: clears caption and uploaderName on slide-1
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          photos: [
            {
              id: 'slide-1',
              url: 'https://example.com/sparklers.jpg',
              title: 'Guest Photo',
              isGuestUpload: true,
              createdAt: '2026-06-20T20:00:00.000Z',
              updatedAt: '2026-06-20T21:25:00.000Z',
            },
          ],
        }),
      });
    global.fetch = mockFetch;

    render(
      <ReceptionSlideshowClient
        initialPhotos={[
          {
            id: 'slide-1',
            url: 'https://example.com/sparklers.jpg',
            title: 'Raw typo caption',
            caption: 'Raw typo caption',
            uploaderName: 'Aunt Clara',
            isGuestUpload: true,
            createdAt: '2026-06-20T20:00:00.000Z',
            updatedAt: '2026-06-20T21:00:00.000Z',
          },
        ]}
      />
    );

    // Pause slide rotation so slide-1 stays active while 30s polling intervals run
    fireEvent.click(screen.getByTestId('slideshow-play-pause-btn'));

    // Default fallback QR URL includes ?tab=guest
    expect(screen.getByTestId('themed-qr-code').getAttribute('data-value')).toMatch(
      /\/photos\?tab=guest$/
    );
    expect(screen.getByTestId('slideshow-photo-title')).toHaveTextContent('Raw typo caption');

    // First 30s poll uses initial updatedAt (21:00:00)
    await act(async () => {
      jest.advanceTimersByTime(30000);
    });
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      '/api/photos?since=2026-06-20T21%3A00%3A00.000Z'
    );

    // Existing slide-1 refreshed in-place without duplicating, and out-of-order slide appended (total = 2)
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByTestId('slideshow-photo-title')).toHaveTextContent(
      'Polished Sparkler Send-Off'
    );
    expect(screen.getByTestId('slideshow-photo-attribution')).toHaveTextContent(
      'Shared by Clara & Joe'
    );

    // Second 30s poll uses advanced updatedAt cursor (21:20:00) and clears attribution in-place
    await act(async () => {
      jest.advanceTimersByTime(30000);
    });
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      '/api/photos?since=2026-06-20T21%3A20%3A00.000Z'
    );
    expect(screen.getByTestId('slideshow-photo-title')).toHaveTextContent('Guest Photo');
    expect(screen.queryByTestId('slideshow-photo-attribution')).not.toBeInTheDocument();
  });
});
