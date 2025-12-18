import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import PhotoGrid from '../PhotoGrid';
import Lightbox from '../Lightbox';
import { GalleryImage } from '../Gallery';

const mockImages: GalleryImage[] = [
  { src: '/image1.jpg', alt: 'Image 1' },
  { src: '/image2.jpg', alt: 'Image 2' },
  { src: '/image3.jpg', alt: 'Image 3' },
];

// Removed react-intersection-observer mock since it's no longer used

describe('PhotoGrid', () => {
  it('renders the correct number of images', () => {
    render(<PhotoGrid images={mockImages} />);
    const images = screen.getAllByRole('img');
    expect(images).toHaveLength(mockImages.length);
  });

  it('opens the lightbox when an image is clicked', () => {
    render(<PhotoGrid images={mockImages} />);
    const images = screen.getAllByRole('img');
    fireEvent.click(images[1]);

    const lightbox = screen.getByRole('dialog');
    expect(lightbox).toBeInTheDocument();

    const lightboxImage = within(lightbox).getByAltText('Image 2');
    expect(lightboxImage).toBeInTheDocument();
  });
});

describe('Lightbox', () => {
  const mockOnClose = jest.fn();
  const mockOnNext = jest.fn();
  const mockOnPrev = jest.fn();

  beforeEach(() => {
    mockOnClose.mockClear();
    mockOnNext.mockClear();
    mockOnPrev.mockClear();
  });

  it('displays the correct image', () => {
    render(
      <Lightbox
        images={mockImages}
        currentIndex={1}
        onClose={mockOnClose}
        onNext={mockOnNext}
        onPrev={mockOnPrev}
      />
    );
    const image = screen.getByAltText('Image 2');
    expect(image).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', () => {
    render(
      <Lightbox
        images={mockImages}
        currentIndex={0}
        onClose={mockOnClose}
        onNext={mockOnNext}
        onPrev={mockOnPrev}
      />
    );
    const closeButton = screen.getByLabelText('Close');
    fireEvent.click(closeButton);
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the background is clicked', () => {
    render(
      <Lightbox
        images={mockImages}
        currentIndex={0}
        onClose={mockOnClose}
        onNext={mockOnNext}
        onPrev={mockOnPrev}
      />
    );
    const background = screen.getByRole('dialog');
    fireEvent.click(background);
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('calls onNext when the next button is clicked', () => {
    render(
      <Lightbox
        images={mockImages}
        currentIndex={0}
        onClose={mockOnClose}
        onNext={mockOnNext}
        onPrev={mockOnPrev}
      />
    );
    const nextButton = screen.getByLabelText('Next image');
    fireEvent.click(nextButton);
    expect(mockOnNext).toHaveBeenCalledTimes(1);
  });

  it('calls onPrev when the previous button is clicked', () => {
    render(
      <Lightbox
        images={mockImages}
        currentIndex={0}
        onClose={mockOnClose}
        onNext={mockOnNext}
        onPrev={mockOnPrev}
      />
    );
    const prevButton = screen.getByLabelText('Previous image');
    fireEvent.click(prevButton);
    expect(mockOnPrev).toHaveBeenCalledTimes(1);
  });

  it('responds to keyboard events', () => {
    render(
      <Lightbox
        images={mockImages}
        currentIndex={0}
        onClose={mockOnClose}
        onNext={mockOnNext}
        onPrev={mockOnPrev}
      />
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(mockOnClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(mockOnNext).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(mockOnPrev).toHaveBeenCalledTimes(1);
  });
});
