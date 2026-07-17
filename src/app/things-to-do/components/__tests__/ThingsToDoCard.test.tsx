import { render, screen } from '@testing-library/react';
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
    // The src will be encoded, so we check for the presence of the placeholder filename
    expect(image.src).toContain('/images/placeholder.png');
  });
});
