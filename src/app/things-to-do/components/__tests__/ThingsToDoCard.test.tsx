import { render, screen, fireEvent } from '@testing-library/react';
import ThingsToDoCard from '../ThingsToDoCard';
import { AttractionDTO } from '@/features/attractions';

const mockAttraction: AttractionDTO = {
  id: 'test-1',
  name: 'Test Attraction',
  description: 'A great place to visit.',
  imageUrl: '/images/test.jpg',
  image: null,
  website: 'https://example.com',
  directions: 'https://maps.google.com',
  category: 'museum',
  latitude: 0.0,
  longitude: -92.4679,
  isVisible: true,
  createdAt: new Date(),
  updatedAt: new Date()
};

const mockHotelAttraction: AttractionDTO = {
  ...mockAttraction,
  id: 'hotel-1',
  name: 'Grand Hyatt Hotel',
  category: 'hotel',
  promoCode: 'WEDDING2026',
  roomRate: '$149/night',
  cutoffDate: 'October 15, 2026',
  bookingUrl: 'https://hyatt.example.com/booking',
  shuttleInfo: 'Shuttle leaves every 30 minutes',
};

describe('ThingsToDoCard', () => {
  it('renders the attraction details correctly', () => {
    render(<ThingsToDoCard attraction={mockAttraction} />);

    expect(screen.getByText('Test Attraction')).toBeInTheDocument();
    expect(screen.getByText('A great place to visit.')).toBeInTheDocument();
    expect(screen.getByAltText('Test Attraction')).toBeInTheDocument();
  });

  it('has correct links for website and directions', () => {
    render(<ThingsToDoCard attraction={mockAttraction} />);

    const websiteLink = screen.getByText('Website').closest('a');
    expect(websiteLink).toHaveAttribute('href', 'https://example.com');
    expect(websiteLink).toHaveAttribute('target', '_blank');

    const directionsLink = screen.getByText('Directions').closest('a');
    expect(directionsLink).toHaveAttribute('href', 'https://maps.google.com');
    expect(directionsLink).toHaveAttribute('target', '_blank');
  });

  it('renders a placeholder image if no image is provided', () => {
    const attractionWithoutImage = { ...mockAttraction, image: null, imageUrl: '' };
    render(<ThingsToDoCard attraction={attractionWithoutImage} />);
    const image = screen.getByAltText('Test Attraction') as HTMLImageElement;
    expect(image.src).toContain('/images/placeholder.png');
  });

  it('renders hotel block metadata when present', () => {
    render(<ThingsToDoCard attraction={mockHotelAttraction} />);

    expect(screen.getByText('Grand Hyatt Hotel')).toBeInTheDocument();
    expect(screen.getByText('$149/night')).toBeInTheDocument();
    expect(screen.getByText('WEDDING2026')).toBeInTheDocument();
    expect(screen.getByText('October 15, 2026')).toBeInTheDocument();
    expect(screen.getByText('Shuttle leaves every 30 minutes')).toBeInTheDocument();

    const bookBtn = screen.getByText('Book Hotel Block').closest('a');
    expect(bookBtn).toHaveAttribute('href', 'https://hyatt.example.com/booking');
    expect(bookBtn).toHaveAttribute('target', '_blank');
  });

  it('handles promo code copy interaction', async () => {
    const writeTextMock = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(<ThingsToDoCard attraction={mockHotelAttraction} />);

    const copyBtn = screen.getByRole('button', { name: /Copy promo code WEDDING2026/i });
    expect(copyBtn).toBeInTheDocument();

    fireEvent.click(copyBtn);

    expect(writeTextMock).toHaveBeenCalledWith('WEDDING2026');
    expect(await screen.findByText('Copied!')).toBeInTheDocument();
  });
});
