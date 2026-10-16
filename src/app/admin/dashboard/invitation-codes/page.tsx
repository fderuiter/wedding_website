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

function parsePlusOneResponses(val: unknown): Array<{ name?: string; attending?: boolean; rsvpStatus?: string; mealSelection?: string; dietaryNotes?: string }> {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return [];
    }
  }
  return [];
}

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
  const [newCode, setNewCode] = useState({ guestName: '', code: '' });
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'redeemed' | 'unused'>('all');

  const counts = useMemo(() => {
    return {
      all: codes.length,
      redeemed: codes.filter((c) => c.used).length,
      unused: codes.filter((c) => !c.used).length,
    };
  }, [codes]);

  const rsvpMetrics = useMemo(() => {
    let attendingPrimary = 0;
    let declinedPrimary = 0;
    let pendingPrimary = 0;
    let attendingPlusOnes = 0;

    const mealCounts: Record<string, number> = {};

    codes.forEach((item) => {
      const status = item.rsvpStatus || 'pending';
      if (status === 'attending') {
        attendingPrimary++;
        if (item.mealSelection) {
          mealCounts[item.mealSelection] = (mealCounts[item.mealSelection] || 0) + 1;
        } else {
          mealCounts['Unspecified'] = (mealCounts['Unspecified'] || 0) + 1;
        }
      } else if (status === 'declined') {
        declinedPrimary++;
      } else {
        pendingPrimary++;
      }

      if (status === 'attending') {
        const plusOnes = parsePlusOneResponses(item.plusOneResponses);
        plusOnes.forEach((p) => {
          if (p.attending !== false && p.rsvpStatus !== 'declined') {
            attendingPlusOnes++;
            if (p.mealSelection) {
              mealCounts[p.mealSelection] = (mealCounts[p.mealSelection] || 0) + 1;
            } else {
              mealCounts['Unspecified'] = (mealCounts['Unspecified'] || 0) + 1;
            }
          }
        });
      }
    });

    const totalAttending = attendingPrimary + attendingPlusOnes;

    return {
      attendingPrimary,
      declinedPrimary,
      pendingPrimary,
      attendingPlusOnes,
      totalAttending,
      mealCounts,
    };
  }, [codes]);

  const filteredCodes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return codes.filter((item) => {
      if (statusFilter === 'redeemed' && !item.used) return false;
      if (statusFilter === 'unused' && item.used) return false;

      if (!query) return true;

      const matchesName = item.guestName ? item.guestName.toLowerCase().includes(query) : false;
      const matchesCode = item.code ? item.code.toLowerCase().includes(query) : false;
      const matchesEmail = item.email ? item.email.toLowerCase().includes(query) : false;

      return matchesName || matchesCode || matchesEmail;
    });
  }, [codes, searchQuery, statusFilter]);

  const handleSave = async () => {
    if (!newCode.guestName.trim()) {
      addToast('Guest name is required.', 'error');
      return;
    }
    try {
      await create({
        guestName: newCode.guestName.trim(),
        code: newCode.code ? newCode.code.trim().toUpperCase() : undefined,
        used: false,
      });
      setNewCode({ guestName: '', code: '' });
      setIsCreating(false);
      addToast('Invitation code created successfully.', 'success');
    } catch (e: unknown) {
      addToast(e instanceof Error ? e.message : 'Failed to create invitation code.', 'error');
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent<HTMLButtonElement>) => {
    const card = e.currentTarget.closest('.bg-white');
    const isConfirmed = await confirm('Are you sure you want to delete this invitation code?');
    if (!isConfirmed) return;
    if (card) {
      captureFocusTarget(card as HTMLElement);
    }
    try {
      await remove(id);
      addToast('Invitation code deleted successfully.', 'success');
    } catch {
      addToast('Failed to delete invitation code.', 'error');
    }
  };

  const handleExportCsv = () => {
    if (codes.length === 0) {
      addToast('No invitation codes to export.', 'info');
      return;
    }

    const exportRecords = codes.map((item) => {
      const plusOnes = parsePlusOneResponses(item.plusOneResponses);
      const plusOneSummary = plusOnes.length > 0
        ? plusOnes.map((p) => {
          const status = p.attending === false || p.rsvpStatus === 'declined' ? 'Declined' : 'Attending';
          const meal = p.mealSelection ? ` (${p.mealSelection})` : '';
          const diet = p.dietaryNotes ? ` [Notes: ${p.dietaryNotes}]` : '';
          return `${p.name || 'Plus One'}: ${status}${meal}${diet}`;
        }).join('; ')
        : 'None';

      return {
        'Guest Name': item.guestName || '',
        'Invitation Code': item.code || '',
        Email: item.email || '',
        'Code Status': item.used ? 'Redeemed' : 'Unused',
        'RSVP Status': item.rsvpStatus ? (item.rsvpStatus.charAt(0).toUpperCase() + item.rsvpStatus.slice(1)) : 'Pending',
        'Meal Selection': item.mealSelection || 'Not Specified',
        'Dietary Notes': item.dietaryNotes || 'None',
        'Plus Ones Allocated': item.plusOneAllocations ?? 0,
        'Plus-One Responses': plusOneSummary,
      };
    });

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
            setNewCode({ guestName: '', code: '' });
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
          </div>
          <div className="flex gap-4 mt-6">
            <Button onClick={handleSave} variant="primary">Generate</Button>
            <Button variant="secondary" onClick={() => setIsCreating(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* RSVP & Meal Overview Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="bg-white dark:bg-gray-800 p-5 rounded-xl shadow border border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-bold mb-3 text-gray-900 dark:text-gray-100 flex items-center justify-between">
            <span>RSVP Summary</span>
            <span className="text-xs font-normal text-gray-500">
              Total Attending: <strong className="text-green-600 dark:text-green-400">{rsvpMetrics.totalAttending}</strong>
            </span>
          </h2>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-green-50 dark:bg-green-950/40 p-3 rounded-lg border border-green-200 dark:border-green-900/60">
              <p className="text-2xl font-bold text-green-700 dark:text-green-300">{rsvpMetrics.attendingPrimary}</p>
              <p className="text-xs text-green-800 dark:text-green-400 font-medium">Attending ({rsvpMetrics.attendingPlusOnes} +1s)</p>
            </div>
            <div className="bg-red-50 dark:bg-red-950/40 p-3 rounded-lg border border-red-200 dark:border-red-900/60">
              <p className="text-2xl font-bold text-red-700 dark:text-red-300">{rsvpMetrics.declinedPrimary}</p>
              <p className="text-xs text-red-800 dark:text-red-400 font-medium">Declined</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700/50 p-3 rounded-lg border border-gray-200 dark:border-gray-600">
              <p className="text-2xl font-bold text-gray-700 dark:text-gray-300">{rsvpMetrics.pendingPrimary}</p>
              <p className="text-xs text-gray-600 dark:text-gray-400 font-medium">Pending</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-5 rounded-xl shadow border border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-bold mb-3 text-gray-900 dark:text-gray-100">Meal Selection Totals</h2>
          {Object.keys(rsvpMetrics.mealCounts).length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {Object.entries(rsvpMetrics.mealCounts).map(([meal, count]) => (
                <div
                  key={meal}
                  className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 px-3 py-2 rounded-lg text-xs flex items-center justify-between gap-3 min-w-[120px]"
                >
                  <span className="font-medium text-amber-900 dark:text-amber-200">{meal}</span>
                  <span className="font-bold text-amber-700 dark:text-amber-400 bg-amber-200 dark:bg-amber-900/80 px-2 py-0.5 rounded-full">
                    {count}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-500 dark:text-gray-400 py-2">
              No meal choices recorded yet.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 mb-6 items-stretch sm:items-center justify-between">
        <FormGroup className="relative flex-1 max-w-md space-y-0">
          <Input
            type="text"
            placeholder="Search by name, code, or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search invitation codes"
            className="w-full"
          />
        </FormGroup>
        <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-1 border border-gray-200 dark:border-gray-700 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
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
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
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
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              statusFilter === 'unused'
                ? 'bg-white dark:bg-gray-700 text-primary dark:text-white shadow-sm font-semibold'
                : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            Unused ({counts.unused})
          </button>
        </div>
      </div>

      <div className="grid gap-4 pb-10" ref={containerRef}>
        {filteredCodes.map((item) => {
          const status = item.rsvpStatus || 'pending';
          const plusOnes = parsePlusOneResponses(item.plusOneResponses);

          return (
            <div key={item.id} className="bg-white dark:bg-gray-800 p-5 rounded-xl shadow border border-gray-200 dark:border-gray-700 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-2 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-lg text-gray-900 dark:text-gray-100">{item.guestName}</span>
                  
                  {status === 'attending' && (
                    <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300">
                      Attending
                    </span>
                  )}
                  {status === 'declined' && (
                    <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300">
                      Declined
                    </span>
                  )}
                  {status === 'pending' && (
                    <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
                      RSVP Pending
                    </span>
                  )}
                </div>

                <div className="text-xs text-gray-500 dark:text-gray-400 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span>
                    Code: <code className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded font-mono text-rose-600 dark:text-rose-400 font-bold">{item.code}</code>
                  </span>
                  {item.email && <span>Email: {item.email}</span>}
                  <span>Access: <span className={item.used ? 'text-amber-600 font-medium' : 'text-green-600 font-medium'}>{item.used ? 'Redeemed' : 'Unused'}</span></span>
                </div>

                {status === 'attending' && (
                  <div className="bg-gray-50 dark:bg-gray-900/50 p-3 rounded-lg text-xs space-y-1.5 border border-gray-100 dark:border-gray-800 mt-2">
                    <div className="font-medium text-gray-800 dark:text-gray-200">
                      Entrée: <span className="font-semibold text-rose-600 dark:text-rose-400">{item.mealSelection || 'Not specified'}</span>
                    </div>
                    {item.dietaryNotes && (
                      <div className="text-gray-600 dark:text-gray-400">
                        Dietary Notes: <span className="italic">{item.dietaryNotes}</span>
                      </div>
                    )}

                    {(item.plusOneAllocations ?? 0) > 0 && (
                      <div className="pt-1.5 border-t border-gray-200 dark:border-gray-800">
                        <span className="font-medium text-gray-700 dark:text-gray-300">
                          Plus-Ones ({plusOnes.length}/{item.plusOneAllocations}):
                        </span>
                        {plusOnes.length > 0 ? (
                          <div className="mt-1 space-y-1 pl-2">
                            {plusOnes.map((p, idx) => (
                              <div key={idx} className="text-gray-600 dark:text-gray-400">
                                • <strong className="text-gray-800 dark:text-gray-200">{p.name || `Plus One ${idx + 1}`}</strong>:{' '}
                                {p.attending === false || p.rsvpStatus === 'declined' ? (
                                  <span className="text-red-500 font-medium">Declined</span>
                                ) : (
                                  <>
                                    <span className="text-green-600 dark:text-green-400 font-medium">Attending</span>
                                    {p.mealSelection ? ` — ${p.mealSelection}` : ''}
                                    {p.dietaryNotes ? ` (${p.dietaryNotes})` : ''}
                                  </>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-gray-400 italic ml-1">No responses yet</span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex md:flex-col items-center justify-end gap-2">
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
