import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RegistryPreviewTable, PreviewRegistryItem } from '../RegistryPreviewTable';

describe('RegistryPreviewTable', () => {
  const sampleItems: PreviewRegistryItem[] = [
    {
      id: 'item-1',
      name: 'Stand Mixer',
      price: 299.99,
      category: 'Kitchen',
      description: 'A great mixer',
      vendorUrl: 'https://example.com/mixer',
      imageUrl: 'https://example.com/mixer.jpg',
      quantity: 1,
      isGroupGift: true,
      isMostWanted: true,
      isValid: true,
      errors: [],
    },
    {
      id: 'item-2',
      name: '',
      price: undefined,
      category: 'Kitchen',
      description: '',
      vendorUrl: 'https://example.com/invalid',
      imageUrl: '',
      quantity: 1,
      isGroupGift: false,
      isMostWanted: false,
      isValid: false,
      errors: ['Product name is required.', 'Price must be a positive number.'],
    },
  ];

  it('renders summary counts and table rows', () => {
    render(
      <RegistryPreviewTable
        items={sampleItems}
        onUpdateItem={jest.fn()}
        onRemoveItem={jest.fn()}
        onImport={jest.fn()}
        isSubmitting={false}
      />
    );

    expect(screen.getByText('Preview Items (2)')).toBeInTheDocument();
    expect(screen.getByText('1 Ready to Import')).toBeInTheDocument();
    expect(screen.getByText('1 Needs Attention')).toBeInTheDocument();
    expect(screen.getByText('Stand Mixer')).toBeInTheDocument();
    expect(screen.getByText('$299.99')).toBeInTheDocument();
    expect(screen.getByText('Valid')).toBeInTheDocument();
    expect(screen.getByText('Invalid')).toBeInTheDocument();
  });

  it('triggers onRemoveItem when Remove button is clicked', () => {
    const onRemoveItem = jest.fn();
    render(
      <RegistryPreviewTable
        items={sampleItems}
        onUpdateItem={jest.fn()}
        onRemoveItem={onRemoveItem}
        onImport={jest.fn()}
        isSubmitting={false}
      />
    );

    const removeButtons = screen.getAllByRole('button', { name: /Remove/i });
    fireEvent.click(removeButtons[0]);

    expect(onRemoveItem).toHaveBeenCalledWith('item-1');
  });

  it('triggers onRemoveInvalid when Remove Invalid Items is clicked', () => {
    const onRemoveInvalid = jest.fn();
    render(
      <RegistryPreviewTable
        items={sampleItems}
        onUpdateItem={jest.fn()}
        onRemoveItem={jest.fn()}
        onRemoveInvalid={onRemoveInvalid}
        onImport={jest.fn()}
        isSubmitting={false}
      />
    );

    const removeInvalidBtn = screen.getByRole('button', { name: /Remove Invalid Items/i });
    fireEvent.click(removeInvalidBtn);

    expect(onRemoveInvalid).toHaveBeenCalledTimes(1);
  });

  it('allows inline editing of an item and updates row', () => {
    const onUpdateItem = jest.fn();
    render(
      <RegistryPreviewTable
        items={sampleItems}
        onUpdateItem={onUpdateItem}
        onRemoveItem={jest.fn()}
        onImport={jest.fn()}
        isSubmitting={false}
      />
    );

    // Click Edit on the second (invalid) item
    const editButtons = screen.getAllByRole('button', { name: /Edit/i });
    fireEvent.click(editButtons[1]);

    const nameInput = screen.getByLabelText(/Edit name for item/i);
    fireEvent.change(nameInput, { target: { value: 'Corrected Blender' } });

    expect(onUpdateItem).toHaveBeenCalledWith(
      'item-2',
      expect.objectContaining({ name: 'Corrected Blender' })
    );
  });

  it('triggers onImport when Import button is clicked', () => {
    const onImport = jest.fn();
    render(
      <RegistryPreviewTable
        items={sampleItems}
        onUpdateItem={jest.fn()}
        onRemoveItem={jest.fn()}
        onImport={onImport}
        isSubmitting={false}
      />
    );

    const importButton = screen.getByRole('button', { name: /Import Valid Items \(1\)/i });
    fireEvent.click(importButton);

    expect(onImport).toHaveBeenCalledTimes(1);
  });
});
