'use client';

import React from 'react';
import type { AttractionDTO } from '@/features/attractions';
import { Button } from '@/components/ui/Button';
import { FormGroup, Label, Input, Textarea, Select, Checkbox } from '@/components/ui/forms';
import { cn } from '@/utils/cn';
import { withBasePath } from '@/utils/basePath';

interface AttractionEditorFormProps {
  values: Partial<AttractionDTO>;
  onChange: (_updatedFields: Partial<AttractionDTO>) => void;
  onSubmit: (_e: React.SubmitEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  bindFieldIds?: boolean;
  requireName?: boolean;
  submitLabel?: string;
  saving?: boolean;
  cancelVariant?: 'ghost' | 'secondary';
  actionsAlign?: 'start' | 'end';
  heading?: string;
  className?: string;
  ref?: React.Ref<HTMLFormElement>;
}

function parseCoordinateInput(rawValue: string): number {
  const parsed = parseFloat(rawValue);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function AttractionEditorForm({
  values,
  onChange,
  onSubmit,
  onCancel,
  bindFieldIds = false,
  requireName = false,
  submitLabel = 'Save',
  saving = false,
  cancelVariant = 'secondary',
  actionsAlign = 'start',
  heading,
  className,
  ref,
}: AttractionEditorFormProps) {
  const labelIdProps = (fieldId: string) => (bindFieldIds ? { htmlFor: fieldId } : {});
  const inputIdProps = (fieldId: string) => (bindFieldIds ? { id: fieldId } : {});

  const isDecorative = Boolean(values.imageDecorative ?? values.image?.isDecorative ?? false);
  const resolvedImageUrl = values.imageUrl ?? values.image?.url ?? '';
  const resolvedImageAlt = values.imageAlt ?? values.image?.altText ?? '';
  const resolvedLatitude =
    values.latitude !== undefined && !Number.isNaN(values.latitude) ? values.latitude : 0;
  const resolvedLongitude =
    values.longitude !== undefined && !Number.isNaN(values.longitude) ? values.longitude : 0;

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
          <Label {...labelIdProps('attractionName')}>Name</Label>
          <Input
            {...inputIdProps('attractionName')}
            type="text"
            value={values.name ?? ''}
            onChange={(e) => onChange({ name: e.target.value })}
            required={requireName}
          />
        </FormGroup>
        <FormGroup>
          <Label {...labelIdProps('attractionCategory')}>Category</Label>
          <Select
            {...inputIdProps('attractionCategory')}
            value={values.category || 'food'}
            onChange={(e) => onChange({ category: e.target.value })}
          >
            <option value="food">Food</option>
            <option value="coffee">Coffee</option>
            <option value="park">Park</option>
            <option value="museum">Museum</option>
            <option value="hotel">Hotel</option>
            <option value="venue">Venue</option>
          </Select>
        </FormGroup>
        <FormGroup className="md:col-span-2">
          <Label {...labelIdProps('attractionDescription')}>Description</Label>
          <Textarea
            {...inputIdProps('attractionDescription')}
            value={values.description ?? ''}
            onChange={(e) => onChange({ description: e.target.value })}
          />
        </FormGroup>
        <FormGroup>
          <Label {...labelIdProps('attractionImageUrl')}>Image URL</Label>
          <Input
            {...inputIdProps('attractionImageUrl')}
            type="text"
            value={resolvedImageUrl}
            onChange={(e) => onChange({ imageUrl: e.target.value })}
          />
        </FormGroup>
        <FormGroup>
          <Label {...labelIdProps('attractionImageAlt')}>Image Alt Text</Label>
          <Input
            {...inputIdProps('attractionImageAlt')}
            type="text"
            value={resolvedImageAlt}
            onChange={(e) => onChange({ imageAlt: e.target.value })}
            disabled={isDecorative}
          />
        </FormGroup>
        <FormGroup className="md:col-span-2">
          <div className="flex items-center">
            <Checkbox
              {...inputIdProps('attractionImageDecorative')}
              checked={isDecorative}
              onChange={(e) => onChange({ imageDecorative: e.target.checked })}
              className="mr-2"
            />
            <Label {...labelIdProps('attractionImageDecorative')} className="mb-0">
              Decorative (no alt text)
            </Label>
          </div>
        </FormGroup>
        <FormGroup>
          <Label {...labelIdProps('attractionWebsite')}>Website URL</Label>
          <Input
            {...inputIdProps('attractionWebsite')}
            type="text"
            value={values.website ?? ''}
            onChange={(e) => onChange({ website: e.target.value })}
          />
        </FormGroup>
        <FormGroup>
          <Label {...labelIdProps('attractionDirections')}>Directions URL</Label>
          <Input
            {...inputIdProps('attractionDirections')}
            type="text"
            value={values.directions ?? ''}
            onChange={(e) => onChange({ directions: e.target.value })}
          />
        </FormGroup>
        <FormGroup className="md:col-span-2">
          <div className="flex items-center">
            <Checkbox
              {...inputIdProps('attractionIsVisible')}
              checked={values.isVisible !== false}
              onChange={(e) => onChange({ isVisible: e.target.checked })}
              className="mr-2"
            />
            <Label {...labelIdProps('attractionIsVisible')} className="mb-0">
              Visible to public guests
            </Label>
          </div>
        </FormGroup>
        <FormGroup>
          <Label {...labelIdProps('attractionLatitude')}>Latitude</Label>
          <Input
            {...inputIdProps('attractionLatitude')}
            type="number"
            step="any"
            value={resolvedLatitude}
            onChange={(e) => onChange({ latitude: parseCoordinateInput(e.target.value) })}
          />
        </FormGroup>
        <FormGroup>
          <Label {...labelIdProps('attractionLongitude')}>Longitude</Label>
          <Input
            {...inputIdProps('attractionLongitude')}
            type="number"
            step="any"
            value={resolvedLongitude}
            onChange={(e) => onChange({ longitude: parseCoordinateInput(e.target.value) })}
          />
        </FormGroup>

        {values.category === 'hotel' && (
          <div className="md:col-span-2 border-t border-gray-200 dark:border-zinc-700 pt-4 mt-2 grid grid-cols-1 md:grid-cols-2 gap-4">
            <h4 className="md:col-span-2 text-md font-semibold text-gray-900 dark:text-gray-100">
              Hotel Block Details
            </h4>
            <FormGroup>
              <Label {...labelIdProps('promoCode')}>Promo / Group Discount Code</Label>
              <Input
                {...inputIdProps('promoCode')}
                type="text"
                placeholder="e.g. WEDDING2026"
                value={values.promoCode ?? ''}
                onChange={(e) => onChange({ promoCode: e.target.value })}
              />
            </FormGroup>
            <FormGroup>
              <Label {...labelIdProps('roomRate')}>Room Rate</Label>
              <Input
                {...inputIdProps('roomRate')}
                type="text"
                placeholder="e.g. $149/night"
                value={values.roomRate ?? ''}
                onChange={(e) => onChange({ roomRate: e.target.value })}
              />
            </FormGroup>
            <FormGroup>
              <Label {...labelIdProps('cutoffDate')}>Cutoff Date</Label>
              <Input
                {...inputIdProps('cutoffDate')}
                type="text"
                placeholder="e.g. October 15, 2026"
                value={values.cutoffDate ?? ''}
                onChange={(e) => onChange({ cutoffDate: e.target.value })}
              />
            </FormGroup>
            <FormGroup>
              <Label {...labelIdProps('bookingUrl')}>Booking Link</Label>
              <Input
                {...inputIdProps('bookingUrl')}
                type="text"
                placeholder="https://..."
                value={values.bookingUrl ?? ''}
                onChange={(e) => onChange({ bookingUrl: e.target.value })}
              />
            </FormGroup>
            <FormGroup className="md:col-span-2">
              <Label {...labelIdProps('shuttleInfo')}>Shuttle Details</Label>
              <Textarea
                {...inputIdProps('shuttleInfo')}
                placeholder="e.g. Free shuttle running to/from reception every 30 minutes"
                value={values.shuttleInfo ?? ''}
                onChange={(e) => onChange({ shuttleInfo: e.target.value })}
              />
            </FormGroup>
          </div>
        )}
      </div>

      {actionsAlign === 'end' ? (
        <div className="flex gap-3 justify-end pt-2">
          <Button type="button" variant={cancelVariant} onClick={onCancel}>
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
          <Button type="button" variant={cancelVariant} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}
    </form>
  );
}

interface AttractionCardProps {
  attraction: AttractionDTO;
  onEdit: (_attraction: AttractionDTO) => void;
  onDelete: (_id: string, _e: React.MouseEvent<HTMLButtonElement>) => void;
  showSampleBadge?: boolean;
  unnamedAriaFallback?: boolean;
  className?: string;
  ref?: React.Ref<HTMLDivElement>;
}

export function AttractionCard({
  attraction,
  onEdit,
  onDelete,
  showSampleBadge = false,
  unnamedAriaFallback = false,
  className,
  ref,
}: AttractionCardProps) {
  const isTemp = attraction.id.startsWith('temp-');
  const editAriaLabel = unnamedAriaFallback
    ? (attraction.name ? `Edit attraction: ${attraction.name}` : 'Edit unnamed item')
    : `Edit attraction: ${attraction.name}`;
  const deleteAriaLabel = unnamedAriaFallback
    ? (attraction.name ? `Delete attraction: ${attraction.name}` : 'Delete unnamed item')
    : `Delete attraction: ${attraction.name}`;

  return (
    <div
      ref={ref}
      className={cn(
        'bg-white dark:bg-zinc-800 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-zinc-700 flex justify-between items-center gap-4',
        !attraction.isVisible && 'opacity-60',
        className
      )}
    >
      <div className="flex items-center gap-3">
        {attraction.image && (
        // eslint-disable-next-line @next/next/no-img-element
          <img
            src={withBasePath(attraction.image.url || '/images/placeholder.png')}
            alt={attraction.image.isDecorative ? '' : (attraction.image.altText || attraction.name)}
            className="w-12 h-12 rounded-lg object-cover bg-gray-100"
          />
        )}
        <div>
          <div className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <span>{attraction.name}</span>
            {showSampleBadge && attraction.isSample && (
              <span className="px-2 py-0.5 rounded text-xs bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200 font-semibold border border-amber-300 dark:border-amber-700">
                Sample
              </span>
            )}
            {!attraction.isVisible && (
              <span className="text-xs text-red-500 font-normal">(Hidden)</span>
            )}
          </div>
          <div className="text-xs text-secondary font-medium uppercase">{attraction.category}</div>
          {attraction.description && (
            <div className="text-xs text-gray-600 dark:text-gray-400 line-clamp-1 mt-0.5">
              {attraction.description}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          aria-label={editAriaLabel}
          disabled={isTemp}
          onClick={() => onEdit(attraction)}
        >
          Edit
        </Button>
        <Button
          variant="danger"
          size="sm"
          aria-label={deleteAriaLabel}
          disabled={isTemp}
          onClick={(e) => onDelete(attraction.id, e)}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}
