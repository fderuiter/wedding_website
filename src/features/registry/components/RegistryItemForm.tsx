import React, { useState } from 'react';
import { RegistryItem } from '@/features/registry/types';
import { Icon } from '@/components/ui/Icon';
import { validateAddItemInput } from '@/utils/validation';
import { apiClient } from '@/lib/apiClient';

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
      price: Number(values.price),
      quantity: Number(values.quantity),
      isGroupGift: !!values.isGroupGift,
    };

    const validationError = validateAddItemInput(dataToValidate);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    await onSubmit(dataToValidate);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-lg mx-auto bg-white dark:bg-gray-800 p-6 rounded shadow" data-testid="form">
      {mode === 'add' && (
        <div className="mb-4">
          <label htmlFor="scrapeUrl" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Import from Product URL:</label>
          <div className="flex gap-2 mt-1">
            <input
              type="url"
              id="scrapeUrl"
              name="scrapeUrl"
              value={scrapeUrl}
              onChange={e => setScrapeUrl(e.target.value)}
              placeholder="https://..."
              className="form-input flex-1"
              disabled={scrapeLoading}
            />
            <button
              type="button"
              onClick={handleScrape}
              className="btn-primary"
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
            </button>
          </div>
          {scrapeError && <p className="text-red-500 text-sm mt-1">{scrapeError}</p>}
        </div>
      )}
      <div>
        <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Item Name <span className="text-red-500">*</span></label>
        <input type="text" id="name" name="name" value={values.name || ''} onChange={handleChange} required aria-required="true" className="mt-1 form-input" />
      </div>
      <div>
        <label htmlFor="description" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Description:</label>
        <textarea id="description" name="description" value={values.description || ''} onChange={handleChange} rows={3} className="mt-1 form-input"></textarea>
      </div>
      <div>
        <label htmlFor="price" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Price ($) <span className="text-red-500">*</span></label>
        <input type="number" id="price" name="price" value={values.price ?? ''} onChange={handleChange} step="0.01" required aria-required="true" className="mt-1 form-input" />
      </div>
      <div>
        <label htmlFor="quantity" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Quantity <span className="text-red-500">*</span></label>
        <input type="number" id="quantity" name="quantity" value={values.quantity ?? 1} onChange={handleChange} required aria-required="true" className="mt-1 form-input" />
      </div>
      <div>
        <label htmlFor="category" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Category <span className="text-red-500">*</span></label>
        <input type="text" id="category" name="category" value={values.category || ''} onChange={handleChange} required aria-required="true" className="mt-1 form-input" />
      </div>
      <div>
        <label htmlFor="image" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Image URL:</label>
        <input type="url" id="image" name="image" value={values.image || ''} onChange={handleChange} placeholder="https://..." className="mt-1 form-input" />
      </div>
      <div>
        <label htmlFor="vendorUrl" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Vendor/Product URL:</label>
        <input type="url" id="vendorUrl" name="vendorUrl" value={values.vendorUrl || ''} onChange={handleChange} placeholder="https://..." className="mt-1 form-input" />
      </div>
      <div className="flex items-center">
        <input type="checkbox" id="isGroupGift" name="isGroupGift" checked={!!values.isGroupGift} onChange={handleChange} className="h-4 w-4 text-primary border-gray-300 dark:border-gray-600 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2" />
        <label htmlFor="isGroupGift" className="ml-2 block text-sm text-gray-900 dark:text-gray-100">Allow Group Gifting?</label>
      </div>
      {formError && <p className="text-red-500 text-sm mt-2">{formError}</p>}
      <button type="submit" className="btn-primary w-full" disabled={isSubmitting} aria-busy={isSubmitting}>
        {isSubmitting && <Icon name="Loader2" className="animate-spin mr-2 h-4 w-4" />}
        {submitLabel || (mode === 'add' ? 'Add Item' : 'Save Changes')}
      </button>
    </form>
  );
};

export default RegistryItemForm;
