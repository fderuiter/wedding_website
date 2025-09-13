import React from 'react';
import { render, screen } from '@testing-library/react';
import PhotosPage from '../page';
import { GalleryImage } from '@/components/Gallery';

// Mock the PhotoGrid component
jest.mock('@/components/PhotoGrid', () => {
  return function DummyPhotoGrid({ images }: { images: GalleryImage[] }) {
    return (
      <div data-testid="photo-grid">
        {images.map((image, index) => (
          <div key={index} data-testid="photo-item">
            {image.alt}
          </div>
        ))}
      </div>
    );
  };
});

describe('PhotosPage', () => {
  it('renders the page title', () => {
    render(<PhotosPage />);
    expect(screen.getByText('Our Photos')).toBeInTheDocument();
  });

  it('renders the PhotoGrid with the correct images', () => {
    render(<PhotosPage />);
    expect(screen.getByTestId('photo-grid')).toBeInTheDocument();

    const photoItems = screen.getAllByTestId('photo-item');
    expect(photoItems).toHaveLength(7);
    expect(photoItems[0]).toHaveTextContent('Abbi and Fred hug on a lakeside path at sunset, framed by twisting bare branches and a glowing orange sky.');
    expect(photoItems[1]).toHaveTextContent('Sweaty but smiling, Abbi and Fred snap a post-run selfie on a sunny sidewalk beside a brick building.');
  });
});
