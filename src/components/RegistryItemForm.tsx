import React, { useState } from 'react';
import { RegistryItem } from '@/types/registry';

export interface RegistryItemFormProps {
  mode: 'add' | 'edit';
  initialValues?: Partial<RegistryItem>;
  onSubmit: (values: Partial<RegistryItem>) => Promise<void> | void;
  isSubmitting?: boolean;
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
    } catch (err: any) {
      setScrapeError(err.message || 'Scraping failed');
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
    <form onSubmit={handleSubmit} className="space-y-4 max-w-lg mx-auto bg-white p-6 rounded shadow" data-testid="form">
      {mode === 'add' && (
        <div className="mb-4">
          <label htmlFor="scrapeUrl" className="block text-sm font-medium text-gray-700">Import from Product URL:</label>
          <div className="flex gap-2 mt-1">
            <input
              type="url"
              id="scrapeUrl"
              name="scrapeUrl"
              value={scrapeUrl}
              onChange={e => setScrapeUrl(e.target.value)}
              placeholder="https://..."
              className="flex-1 rounded border-gray-300 p-2 border"
              disabled={scrapeLoading}
            />
            <button
              type="button"
              onClick={handleScrape}
              className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded"
              disabled={scrapeLoading || !scrapeUrl}
            >
              {scrapeLoading ? 'Importing...' : 'Import'}
            </button>
          </div>
          {scrapeError && <p className="text-red-500 text-sm mt-1">{scrapeError}</p>}
        </div>
      )}
      <div>
        <label htmlFor="name" className="block text-sm font-medium text-gray-700">Item Name:</label>
        <input type="text" id="name" name="name" value={values.name || ''} onChange={handleChange} required className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border" />
      </div>
      <div>
        <label htmlFor="description" className="block text-sm font-medium text-gray-700">Description:</label>
        <textarea id="description" name="description" value={values.description || ''} onChange={handleChange} rows={3} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border"></textarea>
      </div>
      <div>
        <label htmlFor="price" className="block text-sm font-medium text-gray-700">Price ($):</label>
        <input type="number" id="price" name="price" value={values.price ?? ''} onChange={handleChange} step="0.01" required className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border" />
      </div>
      <div>
        <label htmlFor="quantity" className="block text-sm font-medium text-gray-700">Quantity:</label>
        <input type="number" id="quantity" name="quantity" value={values.quantity ?? 1} onChange={handleChange} required className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border" />
      </div>
      <div>
        <label htmlFor="category" className="block text-sm font-medium text-gray-700">Category:</label>
        <input type="text" id="category" name="category" value={values.category || ''} onChange={handleChange} required className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border" />
      </div>
      <div>
        <label htmlFor="image" className="block text-sm font-medium text-gray-700">Image URL:</label>
        <input type="url" id="image" name="image" value={values.image || ''} onChange={handleChange} placeholder="https://..." className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border" />
      </div>
      <div>
        <label htmlFor="vendorUrl" className="block text-sm font-medium text-gray-700">Vendor/Product URL:</label>
        <input type="url" id="vendorUrl" name="vendorUrl" value={values.vendorUrl || ''} onChange={handleChange} placeholder="https://..." className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border" />
      </div>
      <div className="flex items-center">
        <input type="checkbox" id="isGroupGift" name="isGroupGift" checked={!!values.isGroupGift} onChange={handleChange} className="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500" />
        <label htmlFor="isGroupGift" className="ml-2 block text-sm text-gray-900">Allow Group Gifting?</label>
      </div>
      {formError && <p className="text-red-500 text-sm mt-2">{formError}</p>}
      <button type="submit" className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500" disabled={isSubmitting}>
        {submitLabel || (mode === 'add' ? 'Add Item' : 'Save Changes')}
      </button>
    </form>
  );
};

export default RegistryItemForm;
