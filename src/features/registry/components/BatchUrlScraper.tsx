'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';
import { useToast } from '@/components/ui/ToastProvider';
import { useFormPersist } from '@/hooks/useFormPersist';
import { RegistryPreviewTable, PreviewRegistryItem } from './RegistryPreviewTable';
import { validateRegistryItemRow } from '../utils/csv';

export interface BatchUrlScraperProps {
  onSuccess?: () => void;
}

interface BatchUrlScraperDraft {
  urlInput: string;
  items: PreviewRegistryItem[];
}

const INITIAL_BATCH_DRAFT: BatchUrlScraperDraft = {
  urlInput: '',
  items: [],
};

export const BatchUrlScraper: React.FC<BatchUrlScraperProps> = ({ onSuccess }) => {
  const router = useRouter();
  const { addToast } = useToast();

  const [draft, setDraft, clearPersistedState] = useFormPersist<BatchUrlScraperDraft>(
    'registry_batch_url_draft',
    INITIAL_BATCH_DRAFT
  );
  const { urlInput, items } = draft;
  const [isScraping, setIsScraping] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const setUrlInput = (nextUrlInput: string) => {
    setDraft((prev) => ({ ...prev, urlInput: nextUrlInput }));
  };

  const setItems = (
    updater: PreviewRegistryItem[] | ((_prev: PreviewRegistryItem[]) => PreviewRegistryItem[])
  ) => {
    setDraft((prev) => ({
      ...prev,
      items: typeof updater === 'function' ? updater(prev.items) : updater,
    }));
  };

  const hasDraft = urlInput.trim().length > 0 || items.length > 0;

  const handleResetDraft = () => {
    setErrorMessage(null);
    setDraft(INITIAL_BATCH_DRAFT);
    clearPersistedState();
  };

  // Extract non-empty lines as candidate URLs
  const candidateUrls = urlInput
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const urlCount = candidateUrls.length;

  const handleScrape = async () => {
    if (urlCount === 0) {
      setErrorMessage('Please enter at least one product URL.');
      return;
    }

    if (urlCount > 20) {
      setErrorMessage('A maximum of 20 URLs can be scraped in a single batch. Please remove extra URLs.');
      return;
    }

    setIsScraping(true);
    setErrorMessage(null);

    try {
      const response: any = await apiClient.post('/api/registry/scrape/batch', {
        urls: candidateUrls,
      });

      const results = response?.results || response?.data?.results || [];

      const newPreviewItems: PreviewRegistryItem[] = results.map(
        (res: any, idx: number) => {
          const rawUrl = res.url || candidateUrls[idx] || '';
          if (res.success && res.data) {
            const data = res.data;
            const validation = validateRegistryItemRow({
              name: data.name,
              price: data.price,
              vendorUrl: data.vendorUrl || rawUrl,
              quantity: data.quantity || 1,
            });

            return {
              id: `scraped-${idx}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
              name: data.name || '',
              price: data.price,
              category: 'Uncategorized',
              description: data.description || '',
              vendorUrl: data.vendorUrl || rawUrl,
              imageUrl: data.imageUrl || '',
              imageAlt: data.imageAlt || '',
              quantity: data.quantity || 1,
              isGroupGift: false,
              isMostWanted: false,
              isValid: validation.isValid,
              errors: validation.errors,
            };
          } else {
            // Failed scrape row: keep URL, set error, allow manual entry or removal
            return {
              id: `scraped-fail-${idx}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
              name: '',
              price: undefined,
              category: 'Uncategorized',
              description: '',
              vendorUrl: rawUrl,
              imageUrl: '',
              quantity: 1,
              isGroupGift: false,
              isMostWanted: false,
              isValid: false,
              errors: [res.error || 'Failed to extract product details from URL'],
            };
          }
        }
      );

      setItems(newPreviewItems);

      const successful = newPreviewItems.filter((it) => it.isValid).length;
      const failed = newPreviewItems.length - successful;

      if (failed > 0 && successful > 0) {
        addToast(
          `Scraped ${successful} items successfully. ${failed} items had issues and can be edited below.`,
          'info'
        );
      } else if (successful > 0) {
        addToast(`Successfully scraped ${successful} items!`, 'success');
      } else {
        addToast('Could not extract details for the provided URLs. You can edit them manually below.', 'error');
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Batch scraping failed. Please try again.');
      addToast(`Batch scraping failed: ${err?.message || 'Unknown error'}`, 'error');
    } finally {
      setIsScraping(false);
    }
  };

  const handleUpdateItem = (id: string, updated: Partial<PreviewRegistryItem>) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updated } : item))
    );
  };

  const handleRemoveItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleRemoveInvalid = () => {
    setItems((prev) => prev.filter((item) => item.isValid));
  };

  const handleImport = async () => {
    const validItems = items.filter((it) => it.isValid);
    if (validItems.length === 0) {
      addToast('No valid items to import.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        items: validItems.map((it) => ({
          name: it.name,
          price: it.price || 0,
          quantity: it.quantity || 1,
          category: it.category || 'Uncategorized',
          description: it.description || '',
          vendorUrl: it.vendorUrl || undefined,
          imageUrl: it.imageUrl || '/images/placeholder.png',
          imageAlt: it.imageAlt || undefined,
          isGroupGift: it.isGroupGift,
          isMostWanted: it.isMostWanted,
        })),
      };

      await apiClient.post('/api/registry/items/batch', payload);

      setDraft(INITIAL_BATCH_DRAFT);
      clearPersistedState();
      addToast(`Successfully added ${validItems.length} items to your registry!`, 'success');
      if (onSuccess) {
        onSuccess();
      } else {
        router.push('/admin/dashboard/registry');
      }
    } catch (err: any) {
      addToast(`Failed to import items: ${err?.message || 'Unknown error'}`, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="batch-url-scraper">
      <div className="bg-white dark:bg-stone-900 p-6 rounded-lg border border-stone-200 dark:border-stone-700 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">
            Paste Retailer Product URLs
          </h2>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
            Add up to 20 product links (one per line) from Target, Amazon, Costco, or other retail stores.
            Our scraper will fetch titles, images, and prices in parallel with up to 5 concurrent connections.
          </p>
        </div>

        <div>
          <textarea
            value={urlInput}
            onChange={(e) => {
              setUrlInput(e.target.value);
              setErrorMessage(null);
            }}
            rows={5}
            placeholder={'https://www.target.com/p/stand-mixer/-/A-12345678\nhttps://www.amazon.com/dp/B00005IFEF\nhttps://www.costco.com/blender.product.100.html'}
            className="w-full rounded-md border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800 p-3 text-sm font-mono text-stone-900 dark:text-stone-100 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
            aria-label="Product URLs textarea"
            disabled={isScraping || isSubmitting}
          />

          <div className="flex items-center justify-between text-xs mt-1.5">
            <span
              className={`font-medium ${
                urlCount > 20
                  ? 'text-rose-600 dark:text-rose-400 font-semibold'
                  : 'text-stone-500 dark:text-stone-400'
              }`}
            >
              {urlCount} / 20 URLs entered
            </span>
            {urlCount > 20 && (
              <span className="text-rose-600 dark:text-rose-400">
                Please reduce your list to 20 or fewer URLs
              </span>
            )}
          </div>
        </div>

        {errorMessage && (
          <div className="p-3 text-xs rounded bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300">
            {errorMessage}
          </div>
        )}

        <div className="flex justify-end gap-3">
          {hasDraft && (
            <button
              type="button"
              onClick={handleResetDraft}
              disabled={isScraping || isSubmitting}
              className="inline-flex items-center px-4 py-2 text-sm font-medium text-stone-700 dark:text-stone-200 bg-white dark:bg-stone-800 border border-stone-300 dark:border-stone-600 hover:bg-stone-50 dark:hover:bg-stone-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-md shadow-sm transition-colors"
            >
              Reset Draft
            </button>
          )}
          <button
            type="button"
            onClick={handleScrape}
            disabled={urlCount === 0 || urlCount > 20 || isScraping || isSubmitting}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 dark:bg-amber-700 dark:hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-md shadow-sm transition-colors"
          >
            {isScraping ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Scraping URLs ({urlCount})...
              </>
            ) : (
              `Scrape Product URLs (${urlCount})`
            )}
          </button>
        </div>
      </div>

      {/* Interactive Preview Table */}
      {items.length > 0 && (
        <RegistryPreviewTable
          items={items}
          onUpdateItem={handleUpdateItem}
          onRemoveItem={handleRemoveItem}
          onRemoveInvalid={handleRemoveInvalid}
          onImport={handleImport}
          isSubmitting={isSubmitting}
          submitLabel="Save All to Registry"
        />
      )}
    </div>
  );
};
