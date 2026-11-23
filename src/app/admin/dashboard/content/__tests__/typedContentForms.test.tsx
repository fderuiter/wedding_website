import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ToastProvider } from '@/components/ui/ToastProvider';
import { ThemeProvider } from '@/components/ThemeProvider';
import { ContentNodeSchema, ContentService } from '@/features/content';
import type { ContentNodeDTO, IContentRepository } from '@/features/content';
// eslint-disable-next-line no-restricted-imports
import { apiClient } from '@/features/admin/apiClient';
import ContentDashboardPage from '../page';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockRemove = jest.fn();
let mockNodesData: ContentNodeDTO[] = [];

jest.mock('@/hooks/admin/useAdminContent', () => ({
  useAdminContent: () => ({
    data: mockNodesData,
    isLoading: false,
    error: null,
    fetchAll: jest.fn(),
    create: mockCreate,
    update: mockUpdate,
    remove: mockRemove,
  }),
}));

jest.mock('@/features/admin/apiClient', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

const validateSavedNodePayload = (payload: Partial<ContentNodeDTO>) => {
  return ContentNodeSchema.safeParse({
    id: 'test-node-id',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...payload,
  });
};

describe('Content Hub Typed Forms, URL Import & Readable Previews', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNodesData = [
      {
        id: 'faq-existing',
        type: 'FAQ',
        tags: ['Homepage'],
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        data: {
          question: 'Where should we park?',
          answer: 'Valet parking is complimentary at the north entrance.',
          category: 'Travel',
          keywords: ['parking', 'valet'],
        },
      },
      {
        id: 'schedule-existing',
        type: 'Schedule',
        tags: ['Schedule'],
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        data: {
          title: 'Welcome Toast',
          startTime: '2026-09-18T18:00:00.000Z',
          endTime: '2026-09-18T20:00:00.000Z',
          locationName: 'Garden Terrace',
          category: 'Celebration',
          categoryTags: ['Friday', 'All Guests'],
          attireRules: 'Smart Casual',
          description: 'Join us for drinks and light bites.',
        },
      },
      {
        id: 'photo-existing',
        type: 'Photo',
        tags: ['Gallery'],
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        data: {
          url: 'https://example.com/engagement.jpg',
          title: 'Lakeside Portrait',
          description: 'Taken during autumn.',
          altText: 'Couple standing by the lake',
          status: 'APPROVED',
          isVisible: true,
        },
      },
    ];
    mockCreate.mockImplementation(async (payload) => ({ id: 'created-1', ...payload }));
    mockUpdate.mockImplementation(async (id, payload) => ({ id, ...payload }));
  });

  it('displays readable card previews without JSON.stringify output and navigates Back to Dashboard', () => {
    render(
      <ToastProvider>
        <ContentDashboardPage />
      </ToastProvider>
    );

    expect(screen.queryByRole('button', { name: /back to registry/i })).not.toBeInTheDocument();
    const backBtn = screen.getByRole('button', { name: /back to dashboard/i });
    fireEvent.click(backBtn);
    expect(mockPush).toHaveBeenCalledWith('/admin/dashboard');

    expect(screen.getByText('Where should we park?')).toBeInTheDocument();
    expect(screen.getByText(/Valet parking is complimentary/i)).toBeInTheDocument();
    expect(screen.getByText('Welcome Toast')).toBeInTheDocument();
    expect(screen.getByText('Lakeside Portrait')).toBeInTheDocument();
    expect(screen.getByText('Visible in Gallery')).toBeInTheDocument();
    expect(screen.queryByText(/\{"question":/)).not.toBeInTheDocument();
  });

  it('creates valid Schedule and Logistics payloads with array categoryTags and ISO timestamps', async () => {
    render(
      <ToastProvider>
        <ContentDashboardPage />
      </ToastProvider>
    );

    // Create a Schedule item
    fireEvent.click(screen.getByRole('button', { name: /add new content/i }));
    fireEvent.change(screen.getByLabelText(/content type/i), { target: { value: 'Schedule' } });

    fireEvent.change(screen.getByLabelText(/event title/i), { target: { value: 'Ceremony & Vows' } });
    fireEvent.change(screen.getByLabelText(/start time/i), { target: { value: '2026-09-19T16:00' } });
    fireEvent.change(screen.getByLabelText(/end time/i), { target: { value: '2026-09-19T17:00' } });
    fireEvent.change(screen.getByLabelText(/location name/i), { target: { value: 'Conservatory Lawn' } });
    fireEvent.change(screen.getByLabelText(/category tags/i), { target: { value: 'Saturday, Main Event' } });
    fireEvent.change(screen.getByLabelText(/event description/i), { target: { value: 'Outdoor garden ceremony.' } });

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    const schedulePayload = mockCreate.mock.calls[0][0];
    expect(schedulePayload.type).toBe('Schedule');
    expect(Array.isArray(schedulePayload.data.categoryTags)).toBe(true);
    expect(schedulePayload.data.categoryTags).toEqual(['Saturday', 'Main Event']);
    expect(validateSavedNodePayload(schedulePayload).success).toBe(true);

    // Edit an existing Schedule item and verify array tags & timestamps stay valid
    fireEvent.click(screen.getByRole('button', { name: 'Edit content: Schedule' }));
    fireEvent.change(screen.getByLabelText(/event title/i), { target: { value: 'Updated Welcome Toast' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledTimes(1);
    });
    const updatedSchedulePayload = mockUpdate.mock.calls[0][1];
    expect(Array.isArray(updatedSchedulePayload.data.categoryTags)).toBe(true);
    expect(updatedSchedulePayload.data.categoryTags).toEqual(['Friday', 'All Guests']);
    expect(validateSavedNodePayload(updatedSchedulePayload).success).toBe(true);

    // Create a Logistics item
    fireEvent.click(screen.getByRole('button', { name: /add new content/i }));
    fireEvent.change(screen.getByLabelText(/content type/i), { target: { value: 'Logistics' } });
    fireEvent.change(screen.getByLabelText(/section title/i), { target: { value: 'Downtown Hotel Block' } });
    fireEvent.change(screen.getByLabelText(/^description$/i), { target: { value: 'Mention our names for group rates.' } });
    fireEvent.change(screen.getByLabelText(/category tags/i), { target: { value: 'Lodging, Shuttle' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });
    const logisticsPayload = mockCreate.mock.calls[1][0];
    expect(logisticsPayload.type).toBe('Logistics');
    expect(logisticsPayload.data.categoryTags).toEqual(['Lodging', 'Shuttle']);
    expect(validateSavedNodePayload(logisticsPayload).success).toBe(true);
  });

  it('imports photo URL metadata from /api/registry/scrape and defaults admin photos to approved public visibility', async () => {
    (apiClient.post as jest.Mock).mockResolvedValueOnce({
      name: 'Golden Hour Harbor Walk',
      description: 'Captured along the waterfront boardwalk.',
      imageUrl: 'https://cdn.example.com/photos/golden-hour.jpg',
      imageAlt: 'Couple walking along harbor boardwalk at sunset',
    });

    render(
      <ToastProvider>
        <ContentDashboardPage />
      </ToastProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /add new content/i }));
    fireEvent.change(screen.getByLabelText(/content type/i), { target: { value: 'Photo' } });

    const urlInput = screen.getByLabelText(/photo url/i);
    const visibilityCheckbox = screen.getByLabelText(/visible on public photo gallery/i) as HTMLInputElement;
    expect(visibilityCheckbox.checked).toBe(true);

    fireEvent.change(urlInput, { target: { value: 'https://photographer.example.com/gallery/123' } });
    fireEvent.click(screen.getByRole('button', { name: /import details from url/i }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/api/registry/scrape', {
        url: 'https://photographer.example.com/gallery/123',
      });
      expect(screen.getByLabelText(/photo url/i)).toHaveValue('https://cdn.example.com/photos/golden-hour.jpg');
    });

    expect(screen.getByLabelText(/photo title/i)).toHaveValue('Golden Hour Harbor Walk');
    expect(screen.getByLabelText(/photo description/i)).toHaveValue('Captured along the waterfront boardwalk.');
    expect(screen.getByLabelText(/alt text/i)).toHaveValue('Couple walking along harbor boardwalk at sunset');

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    const createdPhotoPayload = mockCreate.mock.calls[0][0];
    expect(createdPhotoPayload.type).toBe('Photo');
    expect(createdPhotoPayload.data).toEqual({
      url: 'https://cdn.example.com/photos/golden-hour.jpg',
      title: 'Golden Hour Harbor Walk',
      description: 'Captured along the waterfront boardwalk.',
      altText: 'Couple walking along harbor boardwalk at sunset',
      isVisible: true,
      status: 'APPROVED',
    });

    const parsedPhoto = validateSavedNodePayload(createdPhotoPayload);
    expect(parsedPhoto.success).toBe(true);

    // Verify ContentService.getPublicPhotos immediately includes this admin-created photo
    const fakeRepo: IContentRepository = {
      getFeatures: jest.fn(),
      updateFeatures: jest.fn(),
      getNodesByType: jest.fn().mockResolvedValue([
        {
          id: 'new-admin-photo',
          ...createdPhotoPayload,
          createdAt: new Date('2026-10-01T12:00:00Z'),
          updatedAt: new Date('2026-10-01T12:00:00Z'),
        },
      ]),
    };
    const contentSvc = new ContentService(fakeRepo);
    const publicPhotos = await contentSvc.getPublicPhotos();
    expect(publicPhotos).toHaveLength(1);
    expect((publicPhotos[0].data as Record<string, unknown>).url).toBe('https://cdn.example.com/photos/golden-hour.jpg');

    // Also verify unchecking visibility preserves boolean false and hides from public gallery
    fireEvent.click(screen.getByRole('button', { name: 'Edit content: Photo' }));
    const editVisibleCheckbox = screen.getByLabelText(/visible on public photo gallery/i);
    fireEvent.click(editVisibleCheckbox);
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledTimes(1);
    });
    const hiddenPhotoPayload = mockUpdate.mock.calls[0][1];
    expect(typeof hiddenPhotoPayload.data.isVisible).toBe('boolean');
    expect(hiddenPhotoPayload.data.isVisible).toBe(false);
    expect(validateSavedNodePayload(hiddenPhotoPayload).success).toBe(true);

    (fakeRepo.getNodesByType as jest.Mock).mockResolvedValueOnce([
      {
        id: 'hidden-admin-photo',
        ...hiddenPhotoPayload,
        createdAt: new Date('2026-10-01T12:00:00Z'),
        updatedAt: new Date('2026-10-01T12:00:00Z'),
      },
    ]);
    const afterHiding = await contentSvc.getPublicPhotos();
    expect(afterHiding).toHaveLength(0);
  });

  it('converts Schedule datetime-local fields using AppConfig venue timezone', async () => {
    render(
      <ThemeProvider config={{ timezone: 'America/Los_Angeles' } as any}>
        <ToastProvider>
          <ContentDashboardPage />
        </ToastProvider>
      </ThemeProvider>
    );

    // Edit existing Schedule item: 2026-09-18T18:00:00.000Z -> 2026-09-18T11:00 PDT
    fireEvent.click(screen.getByRole('button', { name: 'Edit content: Schedule' }));
    const startInput = screen.getByLabelText(/start time/i) as HTMLInputElement;
    expect(startInput.value).toBe('2026-09-18T11:00');

    // Update to 16:00 PDT -> 2026-09-18T23:00:00.000Z
    fireEvent.change(startInput, { target: { value: '2026-09-18T16:00' } });
    fireEvent.change(screen.getByLabelText(/end time/i), { target: { value: '2026-09-18T18:00' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledTimes(1);
    });
    const updatedPayload = mockUpdate.mock.calls[0][1];
    expect(updatedPayload.data.startTime).toBe('2026-09-18T23:00:00.000Z');
    expect(updatedPayload.data.endTime).toBe('2026-09-19T01:00:00.000Z');
  });

  it('edits and clears Photo caption and uploaderName without retaining stale extraData keys, and sets Schedule preview iframe to /?preview=true#schedule', async () => {
    mockNodesData = [
      {
        id: 'guest-photo-node',
        type: 'Photo',
        tags: ['gallery', 'guest-upload'],
        createdAt: new Date('2026-06-20T20:00:00.000Z'),
        updatedAt: new Date('2026-06-20T20:05:00.000Z'),
        data: {
          url: '/uploads/photos/sparklers.jpg',
          title: 'Sparkler exit!',
          caption: 'Typo in caption',
          uploaderName: 'Aunt Clara',
          altText: 'Sparklers',
          status: 'APPROVED',
          isVisible: true,
        },
      },
      {
        id: 'sched-node-1',
        type: 'Schedule',
        tags: ['Schedule'],
        createdAt: new Date('2026-06-20T12:00:00.000Z'),
        updatedAt: new Date('2026-06-20T12:00:00.000Z'),
        data: {
          title: 'Cocktail Hour',
          startTime: '2026-09-19T17:00:00.000Z',
          endTime: '2026-09-19T18:00:00.000Z',
          locationName: 'Courtyard',
        },
      },
    ];

    render(
      <ToastProvider>
        <ContentDashboardPage />
      </ToastProvider>
    );

    // Edit guest photo caption & uploaderName
    fireEvent.click(screen.getByRole('button', { name: 'Edit content: Photo' }));
    const captionInput = screen.getByLabelText(/^caption$/i) as HTMLInputElement;
    const uploaderInput = screen.getByLabelText(/^uploader name$/i) as HTMLInputElement;
    expect(captionInput.value).toBe('Typo in caption');
    expect(uploaderInput.value).toBe('Aunt Clara');

    // Clear caption and update uploaderName
    fireEvent.change(captionInput, { target: { value: '   ' } });
    fireEvent.change(uploaderInput, { target: { value: 'Aunt Clara & Uncle Joe' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledTimes(1);
    });

    const savedPayload = mockUpdate.mock.calls[0][1];
    expect(savedPayload.data.caption).toBeUndefined();
    expect('caption' in savedPayload.data).toBe(false);
    expect(savedPayload.data.uploaderName).toBe('Aunt Clara & Uncle Joe');

    // Verify Schedule editor configures live preview iframe src as /?preview=true#schedule
    fireEvent.click(screen.getByRole('button', { name: 'Edit content: Schedule' }));
    const previewIframe = screen.getByTitle('Live Preview') as HTMLIFrameElement;
    expect(previewIframe.getAttribute('src')).toBe('/?preview=true#schedule');
  });
});
