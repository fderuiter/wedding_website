'use client';

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAdminInvitationCodes } from '@/hooks/admin/useAdminInvitationCodes';
import { FormGroup, Label, Input } from '@/components/ui/forms';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/ToastProvider';
import { useFocusSuccessor } from '@/hooks/useFocusSuccessor';
import { CsvImportWizardModal } from '@/components/admin/CsvImportWizardModal';
import { generateCsvContent } from '@/utils/csv';

export default function InvitationCodesDashboardPage() {
  const router = useRouter();
  const { confirm, addToast } = useToast();
  const { containerRef, captureFocusTarget } = useFocusSuccessor<HTMLDivElement>();

  const {
    data: codes = [],
    isLoading,
    error,
    create,
    remove,
    fetchAll,
  } = useAdminInvitationCodes();

  const [isCreating, setIsCreating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [newCode, setNewCode] = useState({
    guestName: '',
    code: '',
    email: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    zipCode: '',
    country: '',
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'redeemed' | 'unused'>('all');
  const [addressFilter, setAddressFilter] = useState<'all' | 'complete' | 'missing'>('all');

  const isAddressComplete = (item: any) => {
    return Boolean(item.addressLine1?.trim() && item.city?.trim() && item.zipCode?.trim());
  };

  const counts = useMemo(() => {
    const complete = codes.filter((c) => isAddressComplete(c)).length;
    return {
      all: codes.length,
      redeemed: codes.filter((c) => c.used).length,
      unused: codes.filter((c) => !c.used).length,
      addressComplete: complete,
      addressMissing: codes.length - complete,
    };
  }, [codes]);

  const filteredCodes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return codes.filter((item) => {
      if (statusFilter === 'redeemed' && !item.used) return false;
      if (statusFilter === 'unused' && item.used) return false;

      const hasAddress = isAddressComplete(item);
      if (addressFilter === 'complete' && !hasAddress) return false;
      if (addressFilter === 'missing' && hasAddress) return false;

      if (!query) return true;

      const matchesName = item.guestName ? item.guestName.toLowerCase().includes(query) : false;
      const matchesCode = item.code ? item.code.toLowerCase().includes(query) : false;
      const matchesEmail = item.email ? item.email.toLowerCase().includes(query) : false;
      const matchesAddress = [item.addressLine1, item.addressLine2, item.city, item.state, item.zipCode, item.country]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query);

      return matchesName || matchesCode || matchesEmail || matchesAddress;
    });
  }, [codes, searchQuery, statusFilter, addressFilter]);

  const handleSave = async () => {
    if (!newCode.guestName.trim()) {
      addToast('Guest name is required.', 'error');
      return;
    }
    try {
      const payload: any = {
        guestName: newCode.guestName.trim(),
        code: newCode.code ? newCode.code.trim().toUpperCase() : undefined,
        used: false,
      };
      if (newCode.email.trim()) payload.email = newCode.email.trim();
      if (newCode.addressLine1.trim()) payload.addressLine1 = newCode.addressLine1.trim();
      if (newCode.addressLine2.trim()) payload.addressLine2 = newCode.addressLine2.trim();
      if (newCode.city.trim()) payload.city = newCode.city.trim();
      if (newCode.state.trim()) payload.state = newCode.state.trim();
      if (newCode.zipCode.trim()) payload.zipCode = newCode.zipCode.trim();
      if (newCode.country.trim()) payload.country = newCode.country.trim();

      await create(payload);
      setNewCode({
        guestName: '',
        code: '',
        email: '',
        addressLine1: '',
        addressLine2: '',
        city: '',
        state: '',
        zipCode: '',
        country: '',
      });
      setIsCreating(false);
      addToast('Invitation code created successfully.', 'success');
    } catch (e: any) {
      addToast(e.message || 'Failed to create invitation code.', 'error');
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent<HTMLButtonElement>) => {
    const card = e.currentTarget.closest('.bg-white, .dark\\:bg-gray-800');
    const isConfirmed = await confirm('Are you sure you want to delete this invitation code?');
    if (!isConfirmed) return;
    if (card) {
      captureFocusTarget(card as HTMLElement);
    }
    try {
      await remove(id);
      addToast('Invitation code deleted successfully.', 'success');
    } catch (e: any) {
      addToast('Failed to delete invitation code.', 'error');
    }
  };

  const handleExportCsv = () => {
    if (codes.length === 0) {
      addToast('No invitation codes to export.', 'info');
      return;
    }

    const exportRecords = codes.map((item) => ({
      'Guest Name': item.guestName || '',
      'Invitation Code': item.code || '',
      Email: item.email || '',
      'Address Line 1': item.addressLine1 || '',
      'Address Line 2': item.addressLine2 || '',
      City: item.city || '',
      State: item.state || '',
      'ZIP Code': item.zipCode || '',
      Country: item.country || '',
      'Dietary Notes': item.dietaryNotes || '',
      'Plus Ones': item.plusOneAllocations ?? 0,
      Status: item.used ? 'Redeemed' : 'Unused',
    }));

    const csvText = generateCsvContent(exportRecords);
    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `invitation-codes-${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    addToast('Invitation codes exported successfully.', 'success');
  };

  if (isLoading) return <div className="min-h-screen flex items-center justify-center"><p>Loading...</p></div>;
  if (error) return <div className="min-h-screen flex items-center justify-center"><p className="text-red-500">Error: {error.message}</p></div>;

  return (
    <div className="py-10 px-4 sm:px-6 max-w-5xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-extrabold text-primary">Pre-Authorized Guest Invitation Codes</h1>
        <div className="flex gap-4">
          <Button variant="ghost" onClick={() => router.push('/admin/dashboard')}>Back to Dashboard</Button>
          <Button variant="secondary" onClick={() => setIsImporting(true)}>Import CSV</Button>
          <Button variant="secondary" onClick={handleExportCsv}>Export CSV</Button>
          <Button onClick={() => {
            setNewCode({
              guestName: '',
              code: '',
              email: '',
              addressLine1: '',
              addressLine2: '',
              city: '',
              state: '',
              zipCode: '',
              country: '',
            });
            setIsCreating(true);
          }}>Generate New Code</Button>
        </div>
      </div>

      <CsvImportWizardModal
        isOpen={isImporting}
        onClose={() => setIsImporting(false)}
        onImportComplete={() => fetchAll()}
        existingCodes={codes.map((item) => item.code)}
      />

      {isCreating && (
        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow border border-primary mb-8 max-w-2xl">
          <h2 className="text-xl font-bold mb-4 text-primary">Generate Invitation Code</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <FormGroup>
              <Label>Guest Name</Label>
              <Input
                type="text"
                placeholder="e.g. John Doe"
                value={newCode.guestName}
                onChange={e => setNewCode({ ...newCode, guestName: e.target.value })}
              />
            </FormGroup>
            <FormGroup>
              <Label>Code (Optional - auto-generated if blank)</Label>
              <Input
                type="text"
                placeholder="e.g. JOHN123"
                value={newCode.code}
                onChange={e => setNewCode({ ...newCode, code: e.target.value })}
              />
            </FormGroup>
            <FormGroup>
              <Label>Email (Optional)</Label>
              <Input
                type="email"
                placeholder="guest@example.com"
                value={newCode.email}
                onChange={e => setNewCode({ ...newCode, email: e.target.value })}
              />
            </FormGroup>
            <FormGroup>
              <Label>Address Line 1 (Optional)</Label>
              <Input
                type="text"
                placeholder="123 Main St"
                value={newCode.addressLine1}
                onChange={e => setNewCode({ ...newCode, addressLine1: e.target.value })}
              />
            </FormGroup>
            <FormGroup>
              <Label>Address Line 2 (Optional)</Label>
              <Input
                type="text"
                placeholder="Apt 4B"
                value={newCode.addressLine2}
                onChange={e => setNewCode({ ...newCode, addressLine2: e.target.value })}
              />
            </FormGroup>
            <FormGroup>
              <Label>City (Optional)</Label>
              <Input
                type="text"
                placeholder="San Francisco"
                value={newCode.city}
                onChange={e => setNewCode({ ...newCode, city: e.target.value })}
              />
            </FormGroup>
            <FormGroup>
              <Label>State / Province (Optional)</Label>
              <Input
                type="text"
                placeholder="CA"
                value={newCode.state}
                onChange={e => setNewCode({ ...newCode, state: e.target.value })}
              />
            </FormGroup>
            <FormGroup>
              <Label>ZIP / Postal Code (Optional)</Label>
              <Input
                type="text"
                placeholder="94102"
                value={newCode.zipCode}
                onChange={e => setNewCode({ ...newCode, zipCode: e.target.value })}
              />
            </FormGroup>
            <FormGroup>
              <Label>Country (Optional)</Label>
              <Input
                type="text"
                placeholder="United States"
                value={newCode.country}
                onChange={e => setNewCode({ ...newCode, country: e.target.value })}
              />
            </FormGroup>
          </div>
          <div className="flex gap-4 mt-6">
            <Button onClick={handleSave} variant="primary">Generate</Button>
            <Button variant="secondary" onClick={() => setIsCreating(false)}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-4 mb-6 items-stretch sm:items-center justify-between">
        <FormGroup className="relative flex-1 max-w-md space-y-0">
          <Input
            type="text"
            placeholder="Search by name, code, email, or address..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search invitation codes"
            className="w-full"
          />
        </FormGroup>

        <div className="flex flex-wrap gap-2">
          {/* Status Filter */}
          <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-1 border border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                statusFilter === 'all'
                  ? 'bg-white dark:bg-gray-700 text-primary dark:text-white shadow-sm font-semibold'
                  : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              All ({counts.all})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('redeemed')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                statusFilter === 'redeemed'
                  ? 'bg-white dark:bg-gray-700 text-primary dark:text-white shadow-sm font-semibold'
                  : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              Redeemed ({counts.redeemed})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('unused')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                statusFilter === 'unused'
                  ? 'bg-white dark:bg-gray-700 text-primary dark:text-white shadow-sm font-semibold'
                  : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              Unused ({counts.unused})
            </button>
          </div>

          {/* Address Completion Filter */}
          <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-1 border border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={() => setAddressFilter('all')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                addressFilter === 'all'
                  ? 'bg-white dark:bg-gray-700 text-primary dark:text-white shadow-sm font-semibold'
                  : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              All Addresses
            </button>
            <button
              type="button"
              onClick={() => setAddressFilter('complete')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                addressFilter === 'complete'
                  ? 'bg-white dark:bg-gray-700 text-primary dark:text-white shadow-sm font-semibold'
                  : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              Address Complete ({counts.addressComplete})
            </button>
            <button
              type="button"
              onClick={() => setAddressFilter('missing')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                addressFilter === 'missing'
                  ? 'bg-white dark:bg-gray-700 text-primary dark:text-white shadow-sm font-semibold'
                  : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              Address Missing ({counts.addressMissing})
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 pb-10" ref={containerRef}>
        {filteredCodes.map(item => {
          const hasAddress = isAddressComplete(item);
          return (
            <div key={item.id} className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow border border-primary flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="space-y-1">
                <div className="font-bold text-lg text-gray-900 dark:text-white">{item.guestName}</div>
                <div className="text-sm font-semibold text-secondary uppercase tracking-wider">
                  Code: <code className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-sm font-mono text-red-600 dark:text-red-400">{item.code}</code>
                </div>
                
                {/* Mailing Address Display */}
                <div className="text-xs text-gray-600 dark:text-gray-300 pt-1">
                  <span className="font-bold">Mailing Address: </span>
                  {hasAddress ? (
                    <span className="inline-block bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 px-2 py-0.5 rounded text-xs">
                      {[item.addressLine1, item.addressLine2, item.city, item.state, item.zipCode, item.country].filter(Boolean).join(', ')}
                    </span>
                  ) : item.addressLine1 ? (
                    <span className="inline-block bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 px-2 py-0.5 rounded text-xs">
                      Incomplete: {[item.addressLine1, item.addressLine2, item.city, item.state, item.zipCode, item.country].filter(Boolean).join(', ')}
                    </span>
                  ) : (
                    <span className="text-gray-400 dark:text-gray-500 italic">No address provided</span>
                  )}
                </div>

                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Status: <span className={item.used ? 'text-red-500 font-semibold' : 'text-green-500 font-semibold'}>{item.used ? 'Redeemed/Used' : 'Active/Unused'}</span>
                </div>
              </div>

              <div>
                <Button
                  variant="danger"
                  size="sm"
                  aria-label={`Delete code for ${item.guestName}`}
                  onClick={(e) => handleDelete(item.id, e)}
                >
                  Delete
                </Button>
              </div>
            </div>
          );
        })}
        {codes.length === 0 && <p className="text-gray-500 dark:text-gray-400">No invitation codes found.</p>}
        {codes.length > 0 && filteredCodes.length === 0 && (
          <p className="text-gray-500 dark:text-gray-400">No invitation codes match your search or filter criteria.</p>
        )}
      </div>
    </div>
  );
}
