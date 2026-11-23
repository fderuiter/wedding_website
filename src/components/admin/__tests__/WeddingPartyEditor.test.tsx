import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { WeddingPartyMemberDTO } from '@/features/wedding-party';
import { WeddingPartyEditorForm, WeddingPartyCard } from '../WeddingPartyEditor';

const createMockMember = (overrides: Partial<WeddingPartyMemberDTO> = {}): WeddingPartyMemberDTO => ({
  id: 'wp-1',
  name: 'Jordan Taylor',
  role: 'Best Person',
  bio: 'College roommate and lifelong friend',
  side: 'GROOM',
  link: 'https://instagram.com/jordan',
  order: 1,
  isSample: false,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  photo: {
    id: 'photo-1',
    url: 'https://example.com/jordan.jpg',
    altText: 'Jordan smiling',
    isDecorative: false,
    isSample: false,
  },
  ...overrides,
});

describe('WeddingPartyEditorForm', () => {
  it('renders all 9 party member fields and propagates controlled updates', () => {
    const handleChange = jest.fn();
    render(
      <WeddingPartyEditorForm
        values={{ name: 'Alex', role: 'Maid of Honor', order: 2 }}
        onChange={handleChange}
        onSubmit={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    expect(screen.getByLabelText('Name')).toHaveValue('Alex');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Alexis' } });
    expect(handleChange).toHaveBeenCalledWith({ name: 'Alexis' });

    expect(screen.getByLabelText('Role')).toHaveValue('Maid of Honor');
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'Matron of Honor' } });
    expect(handleChange).toHaveBeenCalledWith({ role: 'Matron of Honor' });

    fireEvent.change(screen.getByLabelText('Side'), { target: { value: 'BRIDE' } });
    expect(handleChange).toHaveBeenCalledWith({ side: 'BRIDE' });

    fireEvent.change(screen.getByLabelText('Bio'), { target: { value: 'Sister of the bride' } });
    expect(handleChange).toHaveBeenCalledWith({ bio: 'Sister of the bride' });

    fireEvent.change(screen.getByLabelText('Photo URL'), { target: { value: 'https://example.com/alex.jpg' } });
    expect(handleChange).toHaveBeenCalledWith({ photoUrl: 'https://example.com/alex.jpg' });

    fireEvent.change(screen.getByLabelText('Photo Alt Text'), { target: { value: 'Alex portrait' } });
    expect(handleChange).toHaveBeenCalledWith({ photoAlt: 'Alex portrait' });

    expect(screen.getByLabelText('Decorative (no alt text)')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Social Link'), { target: { value: 'https://instagram.com/alex' } });
    expect(handleChange).toHaveBeenCalledWith({ link: 'https://instagram.com/alex' });

    expect(screen.getByLabelText('Display Order')).toHaveValue(2);
    fireEvent.change(screen.getByLabelText('Display Order'), { target: { value: '5' } });
    expect(handleChange).toHaveBeenCalledWith({ order: 5 });
  });

  it('disables Photo Alt Text input when photo is marked decorative', () => {
    const handleChange = jest.fn();
    const { rerender } = render(
      <WeddingPartyEditorForm
        values={{ photoAlt: 'Portrait', photoDecorative: false }}
        onChange={handleChange}
        onSubmit={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    expect(screen.getByLabelText('Photo Alt Text')).not.toBeDisabled();

    fireEvent.click(screen.getByLabelText('Decorative (no alt text)'));
    expect(handleChange).toHaveBeenCalledWith({ photoDecorative: true });

    rerender(
      <WeddingPartyEditorForm
        values={{ photoAlt: 'Portrait', photoDecorative: true }}
        onChange={handleChange}
        onSubmit={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    expect(screen.getByLabelText('Photo Alt Text')).toBeDisabled();
  });

  it('supports modal variant props (bindFieldIds, requireFields, submitLabel, saving, onCancel)', () => {
    const handleSubmit = jest.fn();
    const handleCancel = jest.fn();

    const { rerender } = render(
      <WeddingPartyEditorForm
        values={{ name: 'Jordan', role: 'Best Person' }}
        onChange={jest.fn()}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
        bindFieldIds
        requireFields
        submitLabel="Save Member"
        saving={false}
        actionsAlign="end"
        heading="Add New Member"
      />
    );

    expect(screen.getByText('Add New Member')).toBeInTheDocument();
    const nameInput = screen.getByLabelText('Name');
    const roleInput = screen.getByLabelText('Role');
    expect(nameInput).toHaveAttribute('id', 'memberName');
    expect(roleInput).toHaveAttribute('id', 'memberRole');
    expect(nameInput).toBeRequired();
    expect(roleInput).toBeRequired();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(handleCancel).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Save Member' }));
    expect(handleSubmit).toHaveBeenCalledTimes(1);

    rerender(
      <WeddingPartyEditorForm
        values={{ name: 'Jordan', role: 'Best Person' }}
        onChange={jest.fn()}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
        bindFieldIds
        requireFields
        submitLabel="Save Member"
        saving
        actionsAlign="end"
      />
    );

    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
  });

  it('supports studio variant defaults without required attributes or static IDs', () => {
    const formRef = React.createRef<HTMLFormElement>();
    render(
      <WeddingPartyEditorForm
        ref={formRef}
        values={{ name: '', role: '' }}
        onChange={jest.fn()}
        onSubmit={jest.fn()}
        onCancel={jest.fn()}
        submitLabel="Save"
      />
    );

    expect(formRef.current).toBeInstanceOf(HTMLFormElement);
    const nameInput = screen.getByLabelText('Name');
    const roleInput = screen.getByLabelText('Role');
    expect(nameInput).not.toBeRequired();
    expect(roleInput).not.toBeRequired();
    expect(nameInput).not.toHaveAttribute('id', 'memberName');
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('allows clearing existing nested photo URL/alt text and safely handles cleared Display Order without NaN', () => {
    const handleChange = jest.fn();
    const existing = createMockMember();

    const { rerender } = render(
      <WeddingPartyEditorForm
        values={existing}
        onChange={handleChange}
        onSubmit={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    expect(screen.getByLabelText('Photo URL')).toHaveValue('https://example.com/jordan.jpg');
    expect(screen.getByLabelText('Photo Alt Text')).toHaveValue('Jordan smiling');

    rerender(
      <WeddingPartyEditorForm
        values={{ ...existing, photoUrl: '', photoAlt: '' }}
        onChange={handleChange}
        onSubmit={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    expect(screen.getByLabelText('Photo URL')).toHaveValue('');
    expect(screen.getByLabelText('Photo Alt Text')).toHaveValue('');

    fireEvent.change(screen.getByLabelText('Display Order'), { target: { value: '' } });
    expect(handleChange).toHaveBeenCalledWith({ order: 0 });
  });

  it('renders partner-named Side options when partner1Name and partner2Name are provided', () => {
    const { rerender } = render(
      <WeddingPartyEditorForm
        values={{ name: 'Alex', role: 'Attendant' }}
        onChange={jest.fn()}
        onSubmit={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    expect(screen.getByRole('option', { name: "Partner 1's Side" })).toHaveValue('BRIDE');
    expect(screen.getByRole('option', { name: "Partner 2's Side" })).toHaveValue('GROOM');

    rerender(
      <WeddingPartyEditorForm
        values={{ name: 'Alex', role: 'Attendant' }}
        partner1Name="Elena"
        partner2Name="Marcus"
        onChange={jest.fn()}
        onSubmit={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    expect(screen.getByRole('option', { name: "Elena's Side" })).toHaveValue('BRIDE');
    expect(screen.getByRole('option', { name: "Marcus's Side" })).toHaveValue('GROOM');
    expect(screen.getByRole('option', { name: 'Joint' })).toHaveValue('JOINT');
    expect(screen.getByRole('option', { name: 'None / Joint' })).toHaveValue('');
  });
});

describe('WeddingPartyCard', () => {
  it('renders modal card variant without Sample badge or reorder buttons and forwards ref', () => {
    const member = createMockMember({ isSample: true });
    const handleEdit = jest.fn();
    const handleDelete = jest.fn();
    const cardRef = React.createRef<HTMLDivElement>();

    const { container } = render(
      <WeddingPartyCard
        ref={cardRef}
        member={member}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />
    );

    expect(cardRef.current).toBeInstanceOf(HTMLDivElement);

    expect(container.querySelector('.bg-white')).toBeInTheDocument();
    expect(screen.getByAltText('Jordan smiling')).toHaveAttribute('src', 'https://example.com/jordan.jpg');
    expect(screen.getByText('Jordan Taylor')).toBeInTheDocument();
    expect(screen.getByText('Best Person')).toBeInTheDocument();
    expect(screen.getByText('College roommate and lifelong friend')).toBeInTheDocument();
    expect(screen.queryByText('Sample')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /move .* up/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /move .* down/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit wedding party member: Jordan Taylor' }));
    expect(handleEdit).toHaveBeenCalledWith(member);

    fireEvent.click(screen.getByRole('button', { name: 'Delete wedding party member: Jordan Taylor' }));
    expect(handleDelete).toHaveBeenCalledWith('wp-1', expect.any(Object));
  });

  it('renders studio card variant with Sample badge, unnamed fallbacks, and reorder buttons', () => {
    const handleMove = jest.fn();
    const member = createMockMember({ name: '', isSample: true });

    const { rerender } = render(
      <WeddingPartyCard
        member={member}
        showSampleBadge
        unnamedAriaFallback
        onMove={handleMove}
        disableMoveUp
        disableMoveDown={false}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />
    );

    expect(screen.getByText('Sample')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit unnamed item' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete unnamed item' })).toBeInTheDocument();

    const moveUpBtn = screen.getByRole('button', { name: 'Move member up' });
    const moveDownBtn = screen.getByRole('button', { name: 'Move member down' });
    expect(moveUpBtn).toBeDisabled();
    expect(moveDownBtn).not.toBeDisabled();

    fireEvent.click(moveDownBtn);
    expect(handleMove).toHaveBeenCalledWith('down');

    rerender(
      <WeddingPartyCard
        member={member}
        showSampleBadge
        unnamedAriaFallback
        onMove={handleMove}
        disableMoveUp={false}
        disableMoveDown
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Move member up' }));
    expect(handleMove).toHaveBeenCalledWith('up');
    expect(screen.getByRole('button', { name: 'Move member down' })).toBeDisabled();
  });
});
