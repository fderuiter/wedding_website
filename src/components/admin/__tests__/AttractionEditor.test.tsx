import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { AttractionDTO } from '@/features/attractions';
import { AttractionEditorForm, AttractionCard } from '../AttractionEditor';

const createMockAttraction = (overrides: Partial<AttractionDTO> = {}): AttractionDTO => ({
  id: 'attr-1',
  name: 'Art Institute',
  description: 'World-renowned art museum',
  category: 'museum',
  website: 'https://artic.edu',
  directions: 'https://maps.example.com',
  latitude: 41.8796,
  longitude: -87.6237,
  isVisible: true,
  promoCode: null,
  bookingUrl: '',
  roomRate: null,
  cutoffDate: null,
  shuttleInfo: null,
  isSample: false,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  image: {
    id: 'img-1',
    url: 'https://example.com/museum.jpg',
    altText: 'Museum facade',
    isDecorative: false,
    isSample: false,
  },
  ...overrides,
});

describe('AttractionEditorForm', () => {
  it('renders 11 base fields and toggles 5 hotel block fields when category equals hotel', () => {
    const handleChange = jest.fn();
    const { rerender } = render(
      <AttractionEditorForm
        values={{ name: 'Cafe', category: 'food', isVisible: true }}
        onChange={handleChange}
        onSubmit={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    // 11 base controls
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Cafe' } });
    expect(handleChange).toHaveBeenCalledWith({ name: 'New Cafe' });

    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Great espresso' } });
    expect(handleChange).toHaveBeenCalledWith({ description: 'Great espresso' });

    fireEvent.change(screen.getByLabelText('Image URL'), { target: { value: 'https://example.com/cafe.jpg' } });
    expect(handleChange).toHaveBeenCalledWith({ imageUrl: 'https://example.com/cafe.jpg' });

    fireEvent.change(screen.getByLabelText('Image Alt Text'), { target: { value: 'Cafe patio' } });
    expect(handleChange).toHaveBeenCalledWith({ imageAlt: 'Cafe patio' });

    expect(screen.getByLabelText('Decorative (no alt text)')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Website URL'), { target: { value: 'https://cafe.example.com' } });
    expect(handleChange).toHaveBeenCalledWith({ website: 'https://cafe.example.com' });

    fireEvent.change(screen.getByLabelText('Directions URL'), { target: { value: 'https://maps.example.com/cafe' } });
    expect(handleChange).toHaveBeenCalledWith({ directions: 'https://maps.example.com/cafe' });

    fireEvent.click(screen.getByLabelText('Visible to public guests'));
    expect(handleChange).toHaveBeenCalledWith({ isVisible: false });

    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '41.9' } });
    expect(handleChange).toHaveBeenCalledWith({ latitude: 41.9 });

    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '-87.6' } });
    expect(handleChange).toHaveBeenCalledWith({ longitude: -87.6 });

    // Hotel fields hidden when category !== 'hotel'
    expect(screen.queryByText('Hotel Block Details')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Promo / Group Discount Code')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'hotel' } });
    expect(handleChange).toHaveBeenCalledWith({ category: 'hotel' });

    // Rerender with category === 'hotel'
    rerender(
      <AttractionEditorForm
        values={{ name: 'Grand Hotel', category: 'hotel', isVisible: true }}
        onChange={handleChange}
        onSubmit={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    // 5 hotel fields revealed
    expect(screen.getByText('Hotel Block Details')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Promo / Group Discount Code'), {
      target: { value: 'WED2026' },
    });
    expect(handleChange).toHaveBeenCalledWith({ promoCode: 'WED2026' });

    fireEvent.change(screen.getByLabelText('Room Rate'), {
      target: { value: '$149/night' },
    });
    expect(handleChange).toHaveBeenCalledWith({ roomRate: '$149/night' });

    fireEvent.change(screen.getByLabelText('Cutoff Date'), {
      target: { value: 'October 15, 2026' },
    });
    expect(handleChange).toHaveBeenCalledWith({ cutoffDate: 'October 15, 2026' });

    fireEvent.change(screen.getByLabelText('Booking Link'), {
      target: { value: 'https://hotel.example.com/book' },
    });
    expect(handleChange).toHaveBeenCalledWith({ bookingUrl: 'https://hotel.example.com/book' });

    fireEvent.change(screen.getByLabelText('Shuttle Details'), {
      target: { value: 'Every 30 mins' },
    });
    expect(handleChange).toHaveBeenCalledWith({ shuttleInfo: 'Every 30 mins' });
  });

  it('disables Image Alt Text input when photo is marked decorative', () => {
    const handleChange = jest.fn();
    const { rerender } = render(
      <AttractionEditorForm
        values={{ imageAlt: 'Scenic overlook', imageDecorative: false }}
        onChange={handleChange}
        onSubmit={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    expect(screen.getByLabelText('Image Alt Text')).not.toBeDisabled();

    fireEvent.click(screen.getByLabelText('Decorative (no alt text)'));
    expect(handleChange).toHaveBeenCalledWith({ imageDecorative: true });

    rerender(
      <AttractionEditorForm
        values={{ imageAlt: 'Scenic overlook', imageDecorative: true }}
        onChange={handleChange}
        onSubmit={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    expect(screen.getByLabelText('Image Alt Text')).toBeDisabled();
  });

  it('supports modal variant props (bindFieldIds, requireName, submitLabel, saving, onCancel)', () => {
    const handleSubmit = jest.fn();
    const handleCancel = jest.fn();

    const { rerender } = render(
      <AttractionEditorForm
        values={{ name: 'Botanic Garden', category: 'hotel' }}
        onChange={jest.fn()}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
        bindFieldIds
        requireName
        submitLabel="Save Attraction"
        saving={false}
        cancelVariant="ghost"
        actionsAlign="end"
        heading="Add New Attraction"
      />
    );

    expect(screen.getByText('Add New Attraction')).toBeInTheDocument();
    const nameInput = screen.getByLabelText('Name');
    expect(nameInput).toHaveAttribute('id', 'attractionName');
    expect(nameInput).toBeRequired();
    expect(screen.getByLabelText('Promo / Group Discount Code')).toHaveAttribute('id', 'promoCode');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(handleCancel).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Save Attraction' }));
    expect(handleSubmit).toHaveBeenCalledTimes(1);

    rerender(
      <AttractionEditorForm
        values={{ name: 'Botanic Garden', category: 'hotel' }}
        onChange={jest.fn()}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
        bindFieldIds
        requireName
        submitLabel="Save Attraction"
        saving
        cancelVariant="ghost"
        actionsAlign="end"
      />
    );

    const savingBtn = screen.getByRole('button', { name: 'Saving...' });
    expect(savingBtn).toBeDisabled();
  });

  it('supports studio variant defaults without required Name or explicit static IDs', () => {
    const formRef = React.createRef<HTMLFormElement>();
    render(
      <AttractionEditorForm
        ref={formRef}
        values={{ name: '' }}
        onChange={jest.fn()}
        onSubmit={jest.fn()}
        onCancel={jest.fn()}
        submitLabel="Save"
      />
    );

    expect(formRef.current).toBeInstanceOf(HTMLFormElement);
    const nameInput = screen.getByLabelText('Name');
    expect(nameInput).not.toBeRequired();
    expect(nameInput).not.toHaveAttribute('id', 'attractionName');
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('allows clearing existing nested image URL/alt text and safely handles cleared coordinates without NaN', () => {
    const handleChange = jest.fn();
    const existing = createMockAttraction();

    const { rerender } = render(
      <AttractionEditorForm
        values={existing}
        onChange={handleChange}
        onSubmit={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    expect(screen.getByLabelText('Image URL')).toHaveValue('https://example.com/museum.jpg');
    expect(screen.getByLabelText('Image Alt Text')).toHaveValue('Museum facade');

    rerender(
      <AttractionEditorForm
        values={{ ...existing, imageUrl: '', imageAlt: '' }}
        onChange={handleChange}
        onSubmit={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    expect(screen.getByLabelText('Image URL')).toHaveValue('');
    expect(screen.getByLabelText('Image Alt Text')).toHaveValue('');

    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '' } });
    expect(handleChange).toHaveBeenCalledWith({ latitude: 0 });

    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '' } });
    expect(handleChange).toHaveBeenCalledWith({ longitude: 0 });
  });

  it('populates attraction fields from address lookup and places coordinates inside optional disclosure', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: [
          {
            displayName: 'Palmer House Hilton, 17 E Monroe St, Chicago, IL 60603, USA',
            name: 'Palmer House Hilton',
            streetAddress: '17 E Monroe St',
            city: 'Chicago',
            state: 'IL',
            zip: '60603',
            country: 'USA',
            latitude: 41.8807,
            longitude: -87.6271,
          },
        ],
      }),
    }) as unknown as typeof fetch;

    try {
      const handleChange = jest.fn();
      const { container } = render(
        <AttractionEditorForm
          values={{ name: '', category: 'hotel', latitude: 0, longitude: 0 }}
          onChange={handleChange}
          onSubmit={jest.fn()}
          onCancel={jest.fn()}
        />
      );

      const detailsDisclosure = container.querySelector('details');
      expect(detailsDisclosure).toBeInTheDocument();
      expect(detailsDisclosure).not.toHaveAttribute('open');

      const combobox = screen.getByRole('combobox', { name: 'Search Address' });
      fireEvent.change(combobox, { target: { value: 'Palmer House' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lookup' }));

      const listbox = await screen.findByRole('listbox');
      const option = within(listbox).getByRole('option');
      fireEvent.click(option);

      expect(handleChange).toHaveBeenCalledWith({
        latitude: 41.8807,
        longitude: -87.6271,
        name: 'Palmer House Hilton',
        directions: '17 E Monroe St, Chicago, IL 60603',
      });
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('AttractionCard', () => {
  it('renders modal card variant without Sample badge or unnamed fallback and forwards ref', () => {
    const attraction = createMockAttraction({ isSample: true, isVisible: false });
    const handleEdit = jest.fn();
    const handleDelete = jest.fn();
    const cardRef = React.createRef<HTMLDivElement>();

    const { container } = render(
      <AttractionCard
        ref={cardRef}
        attraction={attraction}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />
    );

    expect(cardRef.current).toBeInstanceOf(HTMLDivElement);

    expect(container.querySelector('.bg-white')).toBeInTheDocument();
    expect(screen.getByAltText('Museum facade')).toHaveAttribute('src', 'https://example.com/museum.jpg');
    expect(screen.getByText('Art Institute')).toBeInTheDocument();
    expect(screen.getByText('(Hidden)')).toBeInTheDocument();
    expect(screen.queryByText('Sample')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit attraction: Art Institute' }));
    expect(handleEdit).toHaveBeenCalledWith(attraction);

    fireEvent.click(screen.getByRole('button', { name: 'Delete attraction: Art Institute' }));
    expect(handleDelete).toHaveBeenCalledWith('attr-1', expect.any(Object));
  });

  it('renders studio card variant with Sample badge, unnamed aria-label fallbacks, and temp-* disabling', () => {
    const sampleUnnamed = createMockAttraction({
      id: 'temp-123',
      name: '',
      isSample: true,
    });

    render(
      <AttractionCard
        attraction={sampleUnnamed}
        showSampleBadge
        unnamedAriaFallback
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />
    );

    expect(screen.getByText('Sample')).toBeInTheDocument();
    const editBtn = screen.getByRole('button', { name: 'Edit unnamed item' });
    const deleteBtn = screen.getByRole('button', { name: 'Delete unnamed item' });
    expect(editBtn).toBeDisabled();
    expect(deleteBtn).toBeDisabled();
  });
});
