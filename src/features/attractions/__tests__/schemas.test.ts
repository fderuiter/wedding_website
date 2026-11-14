import { AttractionSchema } from '../schemas';
import { AttractionAdminService } from '../admin.service';

describe('AttractionSchema', () => {
  it('validates a basic attraction without hotel block fields', () => {
    const validData = {
      id: 'attr-1',
      name: 'Downtown Museum',
      description: 'A great art museum',
      category: 'museum',
      website: 'https://museum.example.com',
      directions: 'https://maps.example.com/directions',
      latitude: 40.7128,
      longitude: -74.006,
      isVisible: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const parsed = AttractionSchema.safeParse(validData);
    expect(parsed.success).toBe(true);
  });

  it('validates an attraction with structured hotel block fields', () => {
    const hotelData = {
      id: 'hotel-1',
      name: 'Grand Hyatt Hotel',
      description: 'Official wedding room block hotel',
      category: 'hotel',
      website: 'https://hyatt.example.com',
      directions: 'https://maps.example.com/hyatt',
      latitude: 40.7128,
      longitude: -74.006,
      isVisible: true,
      promoCode: 'WED2026',
      bookingUrl: 'https://hyatt.example.com/group/WED2026',
      roomRate: '$149/night',
      cutoffDate: '2026-10-15',
      shuttleInfo: 'Shuttle leaves every 30 minutes from main lobby',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const parsed = AttractionSchema.safeParse(hotelData);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.promoCode).toBe('WED2026');
      expect(parsed.data.bookingUrl).toBe('https://hyatt.example.com/group/WED2026');
      expect(parsed.data.roomRate).toBe('$149/night');
      expect(parsed.data.cutoffDate).toBe('2026-10-15');
      expect(parsed.data.shuttleInfo).toBe('Shuttle leaves every 30 minutes from main lobby');
    }
  });

  it('allows null or empty hotel block fields', () => {
    const hotelDataWithNulls = {
      id: 'hotel-2',
      name: 'Boutique Inn',
      description: 'Charming local inn',
      category: 'hotel',
      website: '',
      directions: 'https://maps.example.com/inn',
      latitude: 40.7128,
      longitude: -74.006,
      isVisible: true,
      promoCode: null,
      bookingUrl: '',
      roomRate: null,
      cutoffDate: null,
      shuttleInfo: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const parsed = AttractionSchema.safeParse(hotelDataWithNulls);
    expect(parsed.success).toBe(true);
  });

  describe('AttractionAdminService Input Validation', () => {
    let adminService: AttractionAdminService;

    beforeEach(() => {
      adminService = new AttractionAdminService();
    });

    it('validates valid attraction input payloads', async () => {
      const validData = {
        name: 'Downtown Museum',
        description: 'A great art museum',
        category: 'museum',
        directions: 'https://maps.example.com',
        latitude: 40.7128,
        longitude: -74.006,
        isVisible: true,
      };
      await expect(adminService['validate'](validData)).resolves.not.toThrow();
    });

    it('rejects invalid attraction input payloads and throws clear validation error', async () => {
      const invalidData = {
        name: 12345,
        website: 'javascript:alert(1)',
      };
      await expect(adminService['validate'](invalidData)).rejects.toThrow(/Validation Error/);
    });
  });
});
