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
import { SegmentedTabs, SegmentedTabPanel } from '@/components/ui/SegmentedTabs';
import { useToast } from '@/components/ui/ToastProvider';

export type AddItemTab = 'single' | 'batch' | 'csv';

const ADD_ITEM_TABS = [
  {
    value: 'single' as const,
    label: 'Single Item',
    id: 'tab-single',
    panelId: 'panel-single',
  },
  {
    value: 'batch' as const,
    label: 'Batch URLs',
    id: 'tab-batch',
    panelId: 'panel-batch',
  },
  {
    value: 'csv' as const,
    label: 'CSV Import',
    id: 'tab-csv',
    panelId: 'panel-csv',
  },
];

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
      router.push('/admin/dashboard/registry');
    } catch (error) {
      addToast(`Failed to add item: ${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AdminEditorContainer title="Add Registry Items">
      {/* Tab Navigation */}
      <div className="mb-6">
        <SegmentedTabs
          aria-label="Add Registry Item Modes"
          value={activeTab}
          onChange={setActiveTab}
          tabs={ADD_ITEM_TABS}
        />
      </div>

      {/* Tab Panels */}
      {activeTab === 'single' && (
        <SegmentedTabPanel id="panel-single" tabId="tab-single">
          <RegistryItemForm
            mode="add"
            onSubmit={handleAddSingle}
            isSubmitting={isSubmitting}
            submitLabel="Add Item"
          />
        </SegmentedTabPanel>
      )}

      {activeTab === 'batch' && (
        <SegmentedTabPanel id="panel-batch" tabId="tab-batch">
          <BatchUrlScraper onSuccess={() => router.push('/admin/dashboard/registry')} />
        </SegmentedTabPanel>
      )}

      {activeTab === 'csv' && (
        <SegmentedTabPanel id="panel-csv" tabId="tab-csv">
          <CsvRegistryImport onSuccess={() => router.push('/admin/dashboard/registry')} />
        </SegmentedTabPanel>
      )}
    </AdminEditorContainer>
  );
}
