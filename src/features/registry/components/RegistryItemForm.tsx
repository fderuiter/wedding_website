import React, { useState } from 'react';
import { RegistryItem } from '@/features/registry/types';
import { Loader2 } from 'lucide-react';

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
      const res = await fetch('/api/registry/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: scrapeUrl }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to scrape URL');
      }
      const data = await res.json();
      setValues((prev) => ({ ...prev, ...data }));
    } catch (err: unknown) { // Changed 'any' to 'unknown'
      // Type guard for Error object
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
    // Basic validation
    if (!values.name || !values.price || !values.quantity || !values.category) {
      setFormError('Name, price, quantity, and category are required.');
      return;
    }
    if (isNaN(Number(values.price)) || isNaN(Number(values.quantity))) {
      setFormError('Price and Quantity must be valid numbers.');
      return;
    }
    await onSubmit({
      ...values,
      price: Number(values.price),
      quantity: Number(values.quantity),
      isGroupGift: !!values.isGroupGift,
    });
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
              className="flex-1 rounded border-gray-300 dark:border-gray-600 p-2 border bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2"
              disabled={scrapeLoading}
            />
            <button
              type="button"
              onClick={handleScrape}
              className={`bg-rose-600 hover:bg-rose-700 text-white px-3 py-1 rounded flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 ${scrapeLoading ? 'opacity-75 cursor-not-allowed' : ''}`}
              disabled={scrapeLoading || !scrapeUrl}
              aria-busy={scrapeLoading}
            >
              {scrapeLoading ? (
                <>
                  <Loader2 className="animate-spin mr-2 h-4 w-4" />
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
        <input type="text" id="name" name="name" value={values.name || ''} onChange={handleChange} required aria-required="true" className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 sm:text-sm p-2 border bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
      </div>
      <div>
        <label htmlFor="description" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Description:</label>
        <textarea id="description" name="description" value={values.description || ''} onChange={handleChange} rows={3} className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 sm:text-sm p-2 border bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"></textarea>
      </div>
      <div>
        <label htmlFor="price" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Price ($) <span className="text-red-500">*</span></label>
        <input type="number" id="price" name="price" value={values.price ?? ''} onChange={handleChange} step="0.01" required aria-required="true" className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 sm:text-sm p-2 border bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
      </div>
      <div>
        <label htmlFor="quantity" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Quantity <span className="text-red-500">*</span></label>
        <input type="number" id="quantity" name="quantity" value={values.quantity ?? 1} onChange={handleChange} required aria-required="true" className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 sm:text-sm p-2 border bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
      </div>
      <div>
        <label htmlFor="category" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Category <span className="text-red-500">*</span></label>
        <input type="text" id="category" name="category" value={values.category || ''} onChange={handleChange} required aria-required="true" className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 sm:text-sm p-2 border bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
      </div>
      <div>
        <label htmlFor="image" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Image URL:</label>
        <input type="url" id="image" name="image" value={values.image || ''} onChange={handleChange} placeholder="https://..." className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 sm:text-sm p-2 border bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
      </div>
      <div>
        <label htmlFor="vendorUrl" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Vendor/Product URL:</label>
        <input type="url" id="vendorUrl" name="vendorUrl" value={values.vendorUrl || ''} onChange={handleChange} placeholder="https://..." className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 sm:text-sm p-2 border bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
      </div>
      <div className="flex items-center">
        <input type="checkbox" id="isGroupGift" name="isGroupGift" checked={!!values.isGroupGift} onChange={handleChange} className="h-4 w-4 text-rose-600 border-gray-300 dark:border-gray-600 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2" />
        <label htmlFor="isGroupGift" className="ml-2 block text-sm text-gray-900 dark:text-gray-100">Allow Group Gifting?</label>
      </div>
      {formError && <p className="text-red-500 text-sm mt-2">{formError}</p>}
      <button type="submit" className={`inline-flex justify-center items-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-rose-600 hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-rose-500 ${isSubmitting ? 'opacity-75 cursor-not-allowed' : ''}`} disabled={isSubmitting} aria-busy={isSubmitting}>
        {isSubmitting && <Loader2 className="animate-spin mr-2 h-4 w-4" />}
        {submitLabel || (mode === 'add' ? 'Add Item' : 'Save Changes')}
      </button>
    </form>
  );
};

export default RegistryItemForm;
