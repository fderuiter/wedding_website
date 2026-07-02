import React, { useState } from 'react';
import { RegistryItem } from '@/features/registry/types';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { RegistryItemBaseSchema } from '@/features/registry/schemas';
import { apiClient } from '@/lib/apiClient';
import { FormGroup, Label, Input, FormMessage, Textarea, Checkbox } from '@/components/ui/forms';

/**
 * Props for the RegistryItemForm component.
 */
export interface RegistryItemFormProps {
  /** Specifies whether the form is for adding a new item or editing an existing one. */
  mode: 'add' | 'edit';
  /** Initial values to populate the form fields, used in 'edit' mode. */
  initialValues?: Partial<RegistryItem>;
  /** The function to call when the form is submitted. */
  onSubmit: (values: Partial<RegistryItem>) => Promise<void> | void;
  /** Optional flag to indicate that the form is currently being submitted. */
  isSubmitting?: boolean;
  /** Optional custom label for the submit button. */
  submitLabel?: string;
}

const defaultValues: Partial<RegistryItem> = {
  name: '',
  description: '',
  category: '',
  price: 0,
  image: '',
  vendorUrl: '',
  quantity: 1,
  isGroupGift: false,
};

/**
 * @function RegistryItemForm
 * @description A form for adding or editing a registry item. It includes fields for all
 * item properties and a web scraper to pre-fill data from a URL.
 *
 * @param {RegistryItemFormProps} props - The props for the component.
 * @returns {JSX.Element} The rendered registry item form.
 */
const RegistryItemForm: React.FC<RegistryItemFormProps> = ({
  mode,
  initialValues = {},
  onSubmit,
  isSubmitting = false,
  submitLabel,
}) => {
  const [values, setValues] = useState<Partial<RegistryItem>>({ ...defaultValues, ...initialValues });
  const [scrapeUrl, setScrapeUrl] = useState('');
  const [scrapeLoading, setScrapeLoading] = useState(false);
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value, type, checked } = e.target as HTMLInputElement;
    setValues((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleScrape = async (e: React.FormEvent) => {
    e.preventDefault();
    setScrapeLoading(true);
    setScrapeError(null);
    try {
      const data = await apiClient.post('/api/registry/scrape', { url: scrapeUrl });
      setValues((prev) => ({ ...prev, ...data }));
    } catch (err: unknown) {
      if (err instanceof Error) {
        setScrapeError(err.message || 'Scraping failed');
      } else {
        setScrapeError('An unknown error occurred during scraping.');
      }
    } finally {
      setScrapeLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const dataToValidate = {
      ...values,
      isGroupGift: !!values.isGroupGift,
    };

    const parseResult = RegistryItemBaseSchema.safeParse(dataToValidate);
    if (!parseResult.success) {
      setFormError(parseResult.error.issues[0]?.message || 'Invalid form input.');
      return;
    }

    await onSubmit(parseResult.data as Partial<RegistryItem>);
  };

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-white dark:bg-gray-800 p-6 rounded shadow" data-testid="form">
      {mode === 'add' && (
        <div className="col-span-1 md:col-span-2 mb-2">
          <FormGroup state={scrapeError ? 'error' : 'default'}>
            <Label>Import from Product URL:</Label>
            <div className="flex gap-2 mt-1">
              <Input
                type="url"
                name="scrapeUrl"
                value={scrapeUrl}
                onChange={e => setScrapeUrl(e.target.value)}
                placeholder="https://..."
                className="flex-1"
                disabled={scrapeLoading}
              />
              <Button
                type="button"
                variant="primary"
                onClick={handleScrape}
                className="flex items-center justify-center"
                disabled={scrapeLoading || !scrapeUrl}
                aria-busy={scrapeLoading}
              >
                {scrapeLoading ? (
                  <>
                    <Icon name="Loader2" className="animate-spin mr-2 h-4 w-4" />
                    Importing...
                  </>
                ) : (
                  'Import'
                )}
              </Button>
            </div>
            {scrapeError && <FormMessage>{scrapeError}</FormMessage>}
          </FormGroup>
        </div>
      )}
      <FormGroup>
        <Label>Item Name <span className="text-red-500">*</span></Label>
        <Input type="text" name="name" value={values.name || ''} onChange={handleChange} required aria-required="true" />
      </FormGroup>
      <FormGroup>
        <Label>Category <span className="text-red-500">*</span></Label>
        <Input type="text" name="category" value={values.category || ''} onChange={handleChange} required aria-required="true" />
      </FormGroup>
      <FormGroup>
        <Label>Price ($) <span className="text-red-500">*</span></Label>
        <Input type="number" name="price" value={values.price ?? ''} onChange={handleChange} step="0.01" required aria-required="true" />
      </FormGroup>
      <FormGroup>
        <Label>Quantity <span className="text-red-500">*</span></Label>
        <Input type="number" name="quantity" value={values.quantity ?? 1} onChange={handleChange} required aria-required="true" />
      </FormGroup>
      <FormGroup>
        <Label>Image URL:</Label>
        <Input type="url" name="image" value={values.image || ''} onChange={handleChange} placeholder="https://..." />
      </FormGroup>
      <FormGroup>
        <Label>Vendor/Product URL:</Label>
        <Input type="url" name="vendorUrl" value={values.vendorUrl || ''} onChange={handleChange} placeholder="https://..." />
      </FormGroup>
      <FormGroup className="col-span-1 md:col-span-2">
        <Label>Description:</Label>
        <Textarea name="description" value={values.description || ''} onChange={handleChange} rows={3} />
      </FormGroup>
      <FormGroup className="col-span-1 md:col-span-2">
        <div className="flex items-center">
          <Checkbox name="isGroupGift" checked={!!values.isGroupGift} onChange={handleChange} />
          <Label className="ml-2 font-normal">Allow Group Gifting?</Label>
        </div>
      </FormGroup>
      <div className="col-span-1 md:col-span-2">
        {formError && <FormGroup state="error"><FormMessage>{formError}</FormMessage></FormGroup>}
        <Button type="submit" variant="primary" className="w-full mt-2 flex items-center justify-center" disabled={isSubmitting} aria-busy={isSubmitting}>
          {isSubmitting && <Icon name="Loader2" className="animate-spin mr-2 h-4 w-4" />}
          {submitLabel || (mode === 'add' ? 'Add Item' : 'Save Changes')}
        </Button>
      </div>
    </form>
  );
};

export default RegistryItemForm;
