import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { axe } from 'jest-axe';
import { AddressLookupInput, type AddressLookupCandidate } from '../AddressLookupInput';

const sampleCandidates: AddressLookupCandidate[] = [
  {
    displayName: 'The Glasshouse, 660 12th Ave, New York, NY 10019, USA',
    name: 'The Glasshouse',
    streetAddress: '660 12th Ave',
    city: 'New York',
    state: 'NY',
    zip: '10019',
    country: 'USA',
    latitude: 40.7654,
    longitude: -73.9965,
  },
  {
    displayName: 'Brooklyn Botanic Garden, 990 Washington Ave, Brooklyn, NY 11225, USA',
    name: 'Brooklyn Botanic Garden',
    streetAddress: '990 Washington Ave',
    city: 'Brooklyn',
    state: 'NY',
    zip: '11225',
    country: 'USA',
    latitude: 40.6694,
    longitude: -73.9624,
  },
];

describe('AddressLookupInput', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: sampleCandidates }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('supports debounced search, keyboard combobox navigation, selection, clear, and passes jest-axe', async () => {
    const handleSelect = jest.fn();

    const { container } = render(
      <AddressLookupInput
        id="test-address-lookup"
        label="Search Venue Address"
        helperText="Search a venue to auto-fill address and coordinates."
        verifiedCoordinates={{ latitude: 40.7654, longitude: -73.9965 }}
        debounceMs={10}
        onSelect={handleSelect}
      />
    );

    // Closed state passes axe and displays verified coordinates badge
    expect(screen.getByTestId('test-address-lookup-verified-badge')).toHaveTextContent(
      'Verified pin (40.7654, -73.9965)'
    );
    expect(await axe(container)).toHaveNoViolations();

    const combobox = screen.getByRole('combobox', { name: 'Search Venue Address' });
    expect(combobox).toHaveClass('min-h-11');
    const lookupBtn = screen.getByRole('button', { name: 'Lookup' });
    expect(lookupBtn).toHaveClass('min-h-11', 'min-w-11');

    fireEvent.change(combobox, { target: { value: 'Glasshouse' } });

    const listbox = await screen.findByRole('listbox', { name: 'Search Venue Address suggestions' });
    expect(listbox).toBeInTheDocument();

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveClass('min-h-11');

    // Open listbox state passes axe
    expect(await axe(container)).toHaveNoViolations();

    // Initial lookup highlights first option automatically; ArrowDown moves to option 1 -> Home -> End -> Enter
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(combobox).toHaveAttribute('aria-activedescendant', 'test-address-lookup-option-0');

    fireEvent.keyDown(combobox, { key: 'ArrowDown' });
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    expect(combobox).toHaveAttribute('aria-activedescendant', 'test-address-lookup-option-1');

    fireEvent.keyDown(combobox, { key: 'Home' });
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(combobox, { key: 'End' });
    expect(options[1]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(combobox, { key: 'ArrowUp' });
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(combobox, { key: 'ArrowDown' });
    expect(options[1]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(combobox, { key: 'Enter' });
    expect(handleSelect).toHaveBeenCalledWith(sampleCandidates[1]);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    // Clear button resets query
    const clearBtn = screen.getByRole('button', { name: 'Clear address search' });
    expect(clearBtn).toHaveClass('min-h-11', 'min-w-11');
    fireEvent.click(clearBtn);
    expect(combobox).toHaveValue('');
  });

  it('closes suggestions on Escape and omits verified badge when coordinates are (0, 0)', async () => {
    render(
      <AddressLookupInput
        id="zero-coord-lookup"
        label="Search Place"
        verifiedCoordinates={{ latitude: 0, longitude: 0 }}
        debounceMs={10}
        onSelect={jest.fn()}
      />
    );

    expect(screen.queryByTestId('zero-coord-lookup-verified-badge')).not.toBeInTheDocument();

    const combobox = screen.getByRole('combobox', { name: 'Search Place' });
    fireEvent.change(combobox, { target: { value: 'Glasshouse' } });

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    fireEvent.keyDown(combobox, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
