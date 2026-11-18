// src/app/add-item/page.tsx

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import RegistryItemForm from '../components/RegistryItemForm';
import { BatchUrlScraper } from '../components/BatchUrlScraper';
import { CsvRegistryImport } from '../components/CsvRegistryImport';
import { RegistryItem } from '../types';
import { useAdminRegistry } from '@/hooks/admin/useAdminRegistry';
import { AdminEditorContainer } from '@/components/admin/AdminEditorContainer';
import { useToast } from '@/components/ui/ToastProvider';

export type AddItemTab = 'single' | 'batch' | 'csv';

/**
 * @page AddRegistryItemPage
 * @description A page for administrators to add gifts to the wedding registry.
 * Offers tabs for:
 * 1. Single Item: Manual entry or individual URL scraper.
 * 2. Batch URLs: Ingest up to 20 retail URLs in parallel with concurrency limit of 5.
 * 3. CSV Import: Upload and parse spreadsheet export from external registries (Zola, Joy, etc.).
 *
 * @returns {JSX.Element} The rendered "Add Registry Item" page.
 */
export default function AddRegistryItemPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<AddItemTab>('single');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { create } = useAdminRegistry();
  const { addToast } = useToast();

  const handleAddSingle = async (values: Partial<RegistryItem>) => {
    setIsSubmitting(true);
    try {
      await create(values);
      addToast('Item added successfully!', 'success');
      router.push('/admin/dashboard');
    } catch (error) {
      addToast(`Failed to add item: ${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTabKeyDown = (e: React.KeyboardEvent, currentTab: AddItemTab) => {
    const tabs: AddItemTab[] = ['single', 'batch', 'csv'];
    const currentIndex = tabs.indexOf(currentTab);

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const nextIndex = (currentIndex + 1) % tabs.length;
      setActiveTab(tabs[nextIndex]);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      setActiveTab(tabs[prevIndex]);
    }
  };

  return (
    <AdminEditorContainer title="Add Registry Items">
      {/* Tab Navigation */}
      <div className="mb-6 border-b border-stone-200 dark:border-stone-700">
        <nav
          role="tablist"
          aria-label="Add Registry Item Modes"
          className="-mb-px flex space-x-2 sm:space-x-8"
        >
          <button
            id="tab-single"
            role="tab"
            aria-selected={activeTab === 'single'}
            aria-controls="panel-single"
            tabIndex={activeTab === 'single' ? 0 : -1}
            onClick={() => setActiveTab('single')}
            onKeyDown={(e) => handleTabKeyDown(e, 'single')}
            className={`whitespace-nowrap pb-3 px-3 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === 'single'
                ? 'border-amber-600 text-amber-600 dark:border-amber-500 dark:text-amber-400 font-semibold'
                : 'border-transparent text-stone-500 hover:text-stone-700 hover:border-stone-300 dark:text-stone-400 dark:hover:text-stone-200'
            }`}
          >
            Single Item
          </button>

          <button
            id="tab-batch"
            role="tab"
            aria-selected={activeTab === 'batch'}
            aria-controls="panel-batch"
            tabIndex={activeTab === 'batch' ? 0 : -1}
            onClick={() => setActiveTab('batch')}
            onKeyDown={(e) => handleTabKeyDown(e, 'batch')}
            className={`whitespace-nowrap pb-3 px-3 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === 'batch'
                ? 'border-amber-600 text-amber-600 dark:border-amber-500 dark:text-amber-400 font-semibold'
                : 'border-transparent text-stone-500 hover:text-stone-700 hover:border-stone-300 dark:text-stone-400 dark:hover:text-stone-200'
            }`}
          >
            Batch URLs
          </button>

          <button
            id="tab-csv"
            role="tab"
            aria-selected={activeTab === 'csv'}
            aria-controls="panel-csv"
            tabIndex={activeTab === 'csv' ? 0 : -1}
            onClick={() => setActiveTab('csv')}
            onKeyDown={(e) => handleTabKeyDown(e, 'csv')}
            className={`whitespace-nowrap pb-3 px-3 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === 'csv'
                ? 'border-amber-600 text-amber-600 dark:border-amber-500 dark:text-amber-400 font-semibold'
                : 'border-transparent text-stone-500 hover:text-stone-700 hover:border-stone-300 dark:text-stone-400 dark:hover:text-stone-200'
            }`}
          >
            CSV Import
          </button>
        </nav>
      </div>

      {/* Tab Panels */}
      {activeTab === 'single' && (
        <div
          id="panel-single"
          role="tabpanel"
          aria-labelledby="tab-single"
          tabIndex={0}
        >
          <RegistryItemForm
            mode="add"
            onSubmit={handleAddSingle}
            isSubmitting={isSubmitting}
            submitLabel="Add Item"
          />
        </div>
      )}

      {activeTab === 'batch' && (
        <div
          id="panel-batch"
          role="tabpanel"
          aria-labelledby="tab-batch"
          tabIndex={0}
        >
          <BatchUrlScraper onSuccess={() => router.push('/admin/dashboard')} />
        </div>
      )}

      {activeTab === 'csv' && (
        <div
          id="panel-csv"
          role="tabpanel"
          aria-labelledby="tab-csv"
          tabIndex={0}
        >
          <CsvRegistryImport onSuccess={() => router.push('/admin/dashboard')} />
        </div>
      )}
    </AdminEditorContainer>
  );
}
