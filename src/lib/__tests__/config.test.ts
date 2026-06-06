import { toPublicAppConfig } from '../config';
import { AppConfig } from '@prisma/client';

describe('Configuration DTO Architecture', () => {
  it('toPublicAppConfig should remove adminPassword from the configuration object', () => {
    const mockConfig: AppConfig = {
      id: 'global',
      brideName: 'Abbi',
      groomName: 'Fred',
      weddingDate: new Date('2025-10-10'),
      baseUrl: 'http://localhost:3000',
      venueName: 'The Venue',
      venueAddress: '123 Venue St',
      venueCity: 'City',
      venueState: 'State',
      venueZip: '12345',
      latitude: 40.7128,
      longitude: -74.0060,
      storyText: 'Our story...',
      venueDescription: 'A lovely place...',
      travelAdvice: 'Fly here...',
      heroTitle: 'Welcome',
      heroSubtitle: 'Join us',
      seoTitle: 'Wedding',
      seoDescription: 'Wedding site',
      adminPassword: 'super_secret_password_hash',
      themePrimary: '#f43f5e',
      themeSecondary: '#fbbf24',
      themeAccent: '#e11d48',
      features: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const publicConfig = toPublicAppConfig(mockConfig);

    // Assert adminPassword is removed
    expect(publicConfig).not.toHaveProperty('adminPassword');
    
    // Assert other fields remain intact
    expect(publicConfig.brideName).toBe('Abbi');
    expect(publicConfig.groomName).toBe('Fred');
    expect(publicConfig.themePrimary).toBe('#f43f5e');
    expect(publicConfig.themeSecondary).toBe('#fbbf24');
    expect(publicConfig.themeAccent).toBe('#e11d48');
  });
});
