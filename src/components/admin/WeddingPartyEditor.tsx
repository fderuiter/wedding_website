'use client';

import React from 'react';
import type { WeddingPartyMemberDTO, WeddingPartySide } from '@/features/wedding-party';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { FormGroup, Label, Input, Textarea, Checkbox, Select } from '@/components/ui/forms';
import { cn } from '@/utils/cn';

interface WeddingPartyEditorFormProps {
  values: Partial<WeddingPartyMemberDTO>;
  onChange: (_updatedFields: Partial<WeddingPartyMemberDTO>) => void;
  onSubmit: (_e: React.SubmitEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  partner1Name?: string;
  partner2Name?: string;
  bindFieldIds?: boolean;
  requireFields?: boolean;
  submitLabel?: string;
  saving?: boolean;
  actionsAlign?: 'start' | 'end';
  heading?: string;
  className?: string;
  ref?: React.Ref<HTMLFormElement>;
}

function parseOrderInput(rawValue: string): number {
  const parsed = parseInt(rawValue, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function WeddingPartyEditorForm({
  values,
  onChange,
  onSubmit,
  onCancel,
  partner1Name,
  partner2Name,
  bindFieldIds = false,
  requireFields = false,
  submitLabel = 'Save',
  saving = false,
  actionsAlign = 'start',
  heading,
  className,
  ref,
}: WeddingPartyEditorFormProps) {
  const labelIdProps = (fieldId: string) => (bindFieldIds ? { htmlFor: fieldId } : {});
  const inputIdProps = (fieldId: string) => (bindFieldIds ? { id: fieldId } : {});

  const p1 = partner1Name?.trim() || '';
  const p2 = partner2Name?.trim() || '';
  const partner1SideLabel = p1 ? `${p1}'s Side` : "Partner 1's Side";
  const partner2SideLabel = p2 ? `${p2}'s Side` : "Partner 2's Side";

  const isDecorative = Boolean(values.photoDecorative ?? values.photo?.isDecorative ?? false);
  const resolvedPhotoUrl = values.photoUrl ?? values.photo?.url ?? '';
  const resolvedPhotoAlt = values.photoAlt ?? values.photo?.altText ?? '';
  const resolvedOrder =
    values.order !== undefined && !Number.isNaN(values.order) ? values.order : 0;

  const handleFormSubmit = (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSubmit(e);
  };

  return (
    <form ref={ref} onSubmit={handleFormSubmit} className={className}>
      {heading && (
        <h3 className="font-semibold text-lg">
          {heading}
        </h3>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormGroup>
          <Label {...labelIdProps('memberName')}>Name</Label>
          <Input
            {...inputIdProps('memberName')}
            type="text"
            value={values.name ?? ''}
            onChange={(e) => onChange({ name: e.target.value })}
            required={requireFields}
          />
        </FormGroup>
        <FormGroup>
          <Label {...labelIdProps('memberRole')}>Role</Label>
          <Input
            {...inputIdProps('memberRole')}
            type="text"
            value={values.role ?? ''}
            onChange={(e) => onChange({ role: e.target.value })}
            required={requireFields}
          />
        </FormGroup>
        <FormGroup>
          <Label {...labelIdProps('memberSide')}>Side</Label>
          <Select
            {...inputIdProps('memberSide')}
            value={values.side ?? ''}
            onChange={(e) => onChange({ side: (e.target.value || null) as WeddingPartySide | null })}
          >
            <option value="">None / Joint</option>
            <option value="BRIDE">{partner1SideLabel}</option>
            <option value="GROOM">{partner2SideLabel}</option>
            <option value="JOINT">Joint</option>
          </Select>
        </FormGroup>
        <FormGroup className="md:col-span-2">
          <Label {...labelIdProps('memberBio')}>Bio</Label>
          <Textarea
            {...inputIdProps('memberBio')}
            value={values.bio ?? ''}
            onChange={(e) => onChange({ bio: e.target.value })}
          />
        </FormGroup>
        <FormGroup>
          <Label {...labelIdProps('memberPhotoUrl')}>Photo URL</Label>
          <Input
            {...inputIdProps('memberPhotoUrl')}
            type="text"
            value={resolvedPhotoUrl}
            onChange={(e) => onChange({ photoUrl: e.target.value })}
          />
        </FormGroup>
        <FormGroup>
          <Label {...labelIdProps('memberPhotoAlt')}>Photo Alt Text</Label>
          <Input
            {...inputIdProps('memberPhotoAlt')}
            type="text"
            value={resolvedPhotoAlt}
            onChange={(e) => onChange({ photoAlt: e.target.value })}
            disabled={isDecorative}
          />
        </FormGroup>
        <FormGroup className="md:col-span-2">
          <div className="flex items-center">
            <Checkbox
              {...inputIdProps('memberPhotoDecorative')}
              checked={isDecorative}
              onChange={(e) => onChange({ photoDecorative: e.target.checked })}
              className="mr-2"
            />
            <Label {...labelIdProps('memberPhotoDecorative')} className="mb-0">
              Decorative (no alt text)
            </Label>
          </div>
        </FormGroup>
        <FormGroup>
          <Label {...labelIdProps('memberLink')}>Social Link</Label>
          <Input
            {...inputIdProps('memberLink')}
            type="text"
            value={values.link ?? ''}
            onChange={(e) => onChange({ link: e.target.value })}
          />
        </FormGroup>
        <FormGroup>
          <Label {...labelIdProps('memberOrder')}>Display Order</Label>
          <Input
            {...inputIdProps('memberOrder')}
            type="number"
            value={resolvedOrder}
            onChange={(e) => onChange({ order: parseOrderInput(e.target.value) })}
          />
        </FormGroup>
      </div>
      {actionsAlign === 'end' ? (
        <div className="flex gap-3 justify-end pt-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving...' : submitLabel}
          </Button>
        </div>
      ) : (
        <div className="flex gap-4 mt-6">
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving...' : submitLabel}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}
    </form>
  );
}

interface WeddingPartyCardProps {
  member: WeddingPartyMemberDTO;
  onEdit: (_member: WeddingPartyMemberDTO) => void;
  onDelete: (_id: string, _e: React.MouseEvent<HTMLButtonElement>) => void;
  showSampleBadge?: boolean;
  unnamedAriaFallback?: boolean;
  onMove?: (_direction: 'up' | 'down') => void;
  disableMoveUp?: boolean;
  disableMoveDown?: boolean;
  className?: string;
  ref?: React.Ref<HTMLDivElement>;
}

export function WeddingPartyCard({
  member,
  onEdit,
  onDelete,
  showSampleBadge = false,
  unnamedAriaFallback = false,
  onMove,
  disableMoveUp = false,
  disableMoveDown = false,
  className,
  ref,
}: WeddingPartyCardProps) {
  const isTemp = member.id.startsWith('temp-');
  const editAriaLabel = unnamedAriaFallback
    ? (member.name ? `Edit wedding party member: ${member.name}` : 'Edit unnamed item')
    : `Edit wedding party member: ${member.name}`;
  const deleteAriaLabel = unnamedAriaFallback
    ? (member.name ? `Delete wedding party member: ${member.name}` : 'Delete unnamed item')
    : `Delete wedding party member: ${member.name}`;

  return (
    <div
      ref={ref}
      className={cn(
        'bg-white dark:bg-zinc-800 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-zinc-700 flex justify-between items-center gap-4',
        className
      )}
    >
      <div className="flex items-center gap-3">
        {member.photo && (
        // eslint-disable-next-line @next/next/no-img-element
          <img
            src={member.photo.url || '/images/placeholder.png'}
            alt={member.photo.isDecorative ? '' : (member.photo.altText || member.name)}
            className="w-12 h-12 rounded-full object-cover bg-gray-100"
          />
        )}
        <div>
          <div className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <span>{member.name}</span>
            {showSampleBadge && member.isSample && (
              <span className="px-2 py-0.5 rounded text-xs bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200 font-semibold border border-amber-300 dark:border-amber-700">
                Sample
              </span>
            )}
          </div>
          <div className="text-xs text-primary font-medium">{member.role}</div>
          {member.bio && (
            <div className="text-xs text-gray-600 dark:text-gray-400 line-clamp-1 mt-0.5">
              {member.bio}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {onMove && (
          <>
            <Button
              variant="outline"
              size="sm"
              srContext={member.name || 'member'}
              disabled={disableMoveUp || isTemp}
              onClick={() => onMove('up')}
            >
              <Icon name="ArrowUp" className="h-4 w-4 mr-1 sm:inline" /> Move Up
            </Button>
            <Button
              variant="outline"
              size="sm"
              srContext={member.name || 'member'}
              disabled={disableMoveDown || isTemp}
              onClick={() => onMove('down')}
            >
              <Icon name="ArrowDown" className="h-4 w-4 mr-1 sm:inline" /> Move Down
            </Button>
          </>
        )}
        <Button
          variant="secondary"
          size="sm"
          aria-label={editAriaLabel}
          disabled={isTemp}
          onClick={() => onEdit(member)}
        >
          Edit
        </Button>
        <Button
          variant="danger"
          size="sm"
          aria-label={deleteAriaLabel}
          disabled={isTemp}
          onClick={(e) => onDelete(member.id, e)}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}
