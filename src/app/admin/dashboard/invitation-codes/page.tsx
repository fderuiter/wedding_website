'use client';

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAdminInvitationCodes } from '@/hooks/admin/useAdminInvitationCodes';
import { FormGroup, Label, Input, Select } from '@/components/ui/forms';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/ToastProvider';
import { useFocusSuccessor } from '@/hooks/useFocusSuccessor';
import { CsvImportWizardModal } from '@/components/admin/CsvImportWizardModal';
import { generateCsvContent } from '@/utils/csv';

export function matchDietaryCategory(notes: string | null | undefined, category: string): boolean {
  if (!notes || !notes.trim()) return false;
  const lower = notes.trim().toLowerCase();

  const isGlutenFree = /\b(gf|gluten[- ]free|gluten)\b/i.test(lower);
  const isVegan = /\b(vegan)\b/i.test(lower);
  const isVegetarian = /\b(vegetarian|veg)\b/i.test(lower) && !isVegan;
  const isDairyFree = /\b(df|dairy[- ]free|dairy|lactose)\b/i.test(lower);
  const isNutFree = /\b(nut[- ]free|nut|nuts|peanut|allergy|allergies)\b/i.test(lower);

  switch (category) {
    case 'gluten-free':
      return isGlutenFree;
    case 'vegetarian':
      return isVegetarian;
    case 'vegan':
      return isVegan;
    case 'dairy-free':
      return isDairyFree;
    case 'nut-free':
      return isNutFree;
    case 'other':
      return !isGlutenFree && !isVegan && !isVegetarian && !isDairyFree && !isNutFree;
    case 'has_restriction':
      return true;
    case 'all':
    default:
      return true;
  }
}

export function getAttendanceStatus(item: { used: boolean; extraFields?: Record<string, any> | null }): 'attending' | 'declined' | 'pending' {
  const rawVal = item.extraFields?.attendanceStatus ??
    item.extraFields?.rsvpStatus ??
    item.extraFields?.attendance ??
    item.extraFields?.rsvp ??
    item.extraFields?.attending ??
    item.extraFields?.status;

  if (rawVal !== undefined && rawVal !== null) {
    if (typeof rawVal === 'boolean') {
      return rawVal ? 'attending' : 'declined';
    }
    if (typeof rawVal === 'string') {
      const val = rawVal.trim().toLowerCase();
      if (['attending', 'accepted', 'yes', 'confirmed', 'true'].includes(val)) {
        return 'attending';
      }
      if (['declined', 'no', 'rejected', 'false'].includes(val)) {
        return 'declined';
      }
      if (['pending'].includes(val)) {
        return 'pending';
      }
    }
  }

  return item.used ? 'attending' : 'pending';
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
  const [newCode, setNewCode] = useState({ guestName: '', code: '', plusOneFirstName: '', plusOneLastName: '' });
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'redeemed' | 'unused'>('all');
  const [dietaryFilter, setDietaryFilter] = useState<string>('all');
  const [attendanceFilter, setAttendanceFilter] = useState<'all' | 'attending' | 'declined' | 'pending'>('all');

  const counts = useMemo(() => {
    return {
      all: codes.length,
      redeemed: codes.filter((c) => c.used).length,
      unused: codes.filter((c) => !c.used).length,
    };
  }, [codes]);

  const attendanceCounts = useMemo(() => {
    return {
      all: codes.length,
      attending: codes.filter((c) => getAttendanceStatus(c) === 'attending').length,
      declined: codes.filter((c) => getAttendanceStatus(c) === 'declined').length,
      pending: codes.filter((c) => getAttendanceStatus(c) === 'pending').length,
    };
  }, [codes]);

  const cateringSummary = useMemo(() => {
    let totalWithRestrictions = 0;
    let glutenFree = 0;
    let vegetarian = 0;
    let vegan = 0;
    let dairyFree = 0;
    let nutFree = 0;
    let other = 0;

    for (const item of codes) {
      if (!item.dietaryNotes || !item.dietaryNotes.trim()) continue;
      totalWithRestrictions++;
      const notes = item.dietaryNotes.trim();

      const gf = matchDietaryCategory(notes, 'gluten-free');
      const veg = matchDietaryCategory(notes, 'vegetarian');
      const vgn = matchDietaryCategory(notes, 'vegan');
      const df = matchDietaryCategory(notes, 'dairy-free');
      const nut = matchDietaryCategory(notes, 'nut-free');
      const oth = matchDietaryCategory(notes, 'other');

      if (gf) glutenFree++;
      if (veg) vegetarian++;
      if (vgn) vegan++;
      if (df) dairyFree++;
      if (nut) nutFree++;
      if (oth) other++;
    }

    return {
      totalWithRestrictions,
      glutenFree,
      vegetarian,
      vegan,
      dairyFree,
      nutFree,
      other,
    };
  }, [codes]);

  const filteredCodes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return codes.filter((item) => {
      if (statusFilter === 'redeemed' && !item.used) return false;
      if (statusFilter === 'unused' && item.used) return false;

      if (attendanceFilter !== 'all') {
        const attendanceStatus = getAttendanceStatus(item);
        if (attendanceFilter !== attendanceStatus) return false;
      }

      if (dietaryFilter !== 'all') {
        if (!matchDietaryCategory(item.dietaryNotes, dietaryFilter)) {
          return false;
        }
      }

      if (!query) return true;

      const matchesName = item.guestName ? item.guestName.toLowerCase().includes(query) : false;
      const matchesCode = item.code ? item.code.toLowerCase().includes(query) : false;
      const matchesEmail = item.email ? item.email.toLowerCase().includes(query) : false;
      const matchesPlusOneFirstName = item.plusOneFirstName ? item.plusOneFirstName.toLowerCase().includes(query) : false;
      const matchesPlusOneLastName = item.plusOneLastName ? item.plusOneLastName.toLowerCase().includes(query) : false;
      const matchesDietary = item.dietaryNotes ? item.dietaryNotes.toLowerCase().includes(query) : false;

      return matchesName || matchesCode || matchesEmail || matchesPlusOneFirstName || matchesPlusOneLastName || matchesDietary;
    });
  }, [codes, searchQuery, statusFilter, attendanceFilter, dietaryFilter]);

  const handleSave = async () => {
    if (!newCode.guestName.trim()) {
      addToast('Guest name is required.', 'error');
      return;
    }
    try {
      await create({
        guestName: newCode.guestName.trim(),
        code: newCode.code ? newCode.code.trim().toUpperCase() : undefined,
        plusOneFirstName: newCode.plusOneFirstName.trim() || undefined,
        plusOneLastName: newCode.plusOneLastName.trim() || undefined,
        used: false,
      });
      setNewCode({ guestName: '', code: '', plusOneFirstName: '', plusOneLastName: '' });
      setIsCreating(false);
      addToast('Invitation code created successfully.', 'success');
    } catch (e: any) {
      addToast(e.message || 'Failed to create invitation code.', 'error');
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
      'Plus-One First Name': item.plusOneFirstName || '',
      'Plus-One Last Name': item.plusOneLastName || '',
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
            setNewCode({ guestName: '', code: '', plusOneFirstName: '', plusOneLastName: '' });
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
              <Label>Plus-One First Name (Optional)</Label>
              <Input
                type="text"
                placeholder="e.g. Jane"
                value={newCode.plusOneFirstName}
                onChange={e => setNewCode({ ...newCode, plusOneFirstName: e.target.value })}
              />
            </FormGroup>
            <FormGroup>
              <Label>Plus-One Last Name (Optional)</Label>
              <Input
                type="text"
                placeholder="e.g. Smith"
                value={newCode.plusOneLastName}
                onChange={e => setNewCode({ ...newCode, plusOneLastName: e.target.value })}
              />
            </FormGroup>
          </div>
          <div className="flex gap-4 mt-6">
            <Button onClick={handleSave} variant="primary">Generate</Button>
            <Button variant="secondary" onClick={() => setIsCreating(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Catering & Dietary Summary Widget */}
      <div className="bg-white dark:bg-gray-800 p-5 rounded-xl shadow border border-gray-200 dark:border-gray-700 mb-8" data-testid="catering-summary-widget">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 border-b border-gray-100 dark:border-gray-700/60 pb-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <span>🍽️</span> Catering & Dietary Summary
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Overview of guest dietary requirements and restriction counts
            </p>
          </div>
          <div className="text-sm font-semibold text-primary dark:text-red-400 bg-red-50 dark:bg-red-950/40 px-3 py-1 rounded-full self-start sm:self-auto border border-red-200 dark:border-red-800/40">
            {cateringSummary.totalWithRestrictions} {cateringSummary.totalWithRestrictions === 1 ? 'Guest' : 'Guests'} with Dietary Notes
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 text-center">
          <div className="bg-gray-50 dark:bg-gray-700/40 p-3 rounded-lg border border-gray-100 dark:border-gray-700">
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Gluten-Free</div>
            <div className="text-xl font-extrabold text-primary dark:text-white mt-0.5">{cateringSummary.glutenFree}</div>
          </div>
          <div className="bg-gray-50 dark:bg-gray-700/40 p-3 rounded-lg border border-gray-100 dark:border-gray-700">
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Vegetarian</div>
            <div className="text-xl font-extrabold text-primary dark:text-white mt-0.5">{cateringSummary.vegetarian}</div>
          </div>
          <div className="bg-gray-50 dark:bg-gray-700/40 p-3 rounded-lg border border-gray-100 dark:border-gray-700">
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Vegan</div>
            <div className="text-xl font-extrabold text-primary dark:text-white mt-0.5">{cateringSummary.vegan}</div>
          </div>
          <div className="bg-gray-50 dark:bg-gray-700/40 p-3 rounded-lg border border-gray-100 dark:border-gray-700">
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Dairy-Free</div>
            <div className="text-xl font-extrabold text-primary dark:text-white mt-0.5">{cateringSummary.dairyFree}</div>
          </div>
          <div className="bg-gray-50 dark:bg-gray-700/40 p-3 rounded-lg border border-gray-100 dark:border-gray-700">
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Nut / Allergy</div>
            <div className="text-xl font-extrabold text-primary dark:text-white mt-0.5">{cateringSummary.nutFree}</div>
          </div>
          <div className="bg-gray-50 dark:bg-gray-700/40 p-3 rounded-lg border border-gray-100 dark:border-gray-700">
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Other</div>
            <div className="text-xl font-extrabold text-primary dark:text-white mt-0.5">{cateringSummary.other}</div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 mb-6">
        <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center justify-between">
          <FormGroup className="relative flex-1 max-w-md space-y-0">
            <Input
              type="text"
              placeholder="Search by name, code, email, or dietary notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search invitation codes"
              className="w-full"
            />
          </FormGroup>

          <FormGroup className="w-full sm:w-auto space-y-0">
            <Select
              id="dietary-filter"
              aria-label="Filter by dietary category"
              value={dietaryFilter}
              onChange={(e) => setDietaryFilter(e.target.value)}
              className="w-full sm:w-auto"
            >
              <option value="all">All Dietary Categories</option>
              <option value="has_restriction">Has Dietary Restriction</option>
              <option value="gluten-free">Gluten-Free</option>
              <option value="vegetarian">Vegetarian</option>
              <option value="vegan">Vegan</option>
              <option value="dairy-free">Dairy-Free</option>
              <option value="nut-free">Nut-Free / Allergy</option>
              <option value="other">Other Dietary Restrictions</option>
            </Select>
          </FormGroup>
        </div>

        <div className="flex flex-col lg:flex-row gap-4 justify-between items-start lg:items-center bg-gray-50 dark:bg-gray-800/50 p-3 rounded-xl border border-gray-200 dark:border-gray-700">
          {/* Redemption Status Tab Group */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Redemption:</span>
            <div
              role="tablist"
              aria-label="Filter invitation codes by status"
              className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-1 border border-gray-200 dark:border-gray-700"
            >
              <button
                type="button"
                role="tab"
                aria-selected={statusFilter === 'all'}
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
                role="tab"
                aria-selected={statusFilter === 'redeemed'}
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
                role="tab"
                aria-selected={statusFilter === 'unused'}
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

          {/* RSVP Attendance Status Tab Group */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Attendance:</span>
            <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-1 border border-gray-200 dark:border-gray-700">
              <button
                type="button"
                onClick={() => setAttendanceFilter('all')}
                aria-label={`All attendance (${attendanceCounts.all})`}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  attendanceFilter === 'all'
                    ? 'bg-white dark:bg-gray-700 text-primary dark:text-white shadow-sm font-semibold'
                    : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                All ({attendanceCounts.all})
              </button>
              <button
                type="button"
                onClick={() => setAttendanceFilter('attending')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  attendanceFilter === 'attending'
                    ? 'bg-white dark:bg-gray-700 text-primary dark:text-white shadow-sm font-semibold'
                    : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                Attending ({attendanceCounts.attending})
              </button>
              <button
                type="button"
                onClick={() => setAttendanceFilter('declined')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  attendanceFilter === 'declined'
                    ? 'bg-white dark:bg-gray-700 text-primary dark:text-white shadow-sm font-semibold'
                    : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                Declined ({attendanceCounts.declined})
              </button>
              <button
                type="button"
                onClick={() => setAttendanceFilter('pending')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  attendanceFilter === 'pending'
                    ? 'bg-white dark:bg-gray-700 text-primary dark:text-white shadow-sm font-semibold'
                    : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                Pending ({attendanceCounts.pending})
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 pb-10" ref={containerRef}>
        {filteredCodes.map(item => (
          <div key={item.id} className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow border border-primary flex justify-between items-center">
            <div>
              <div className="font-bold text-lg">{item.guestName}</div>
              {(item.plusOneFirstName || item.plusOneLastName) && (
                <div className="text-sm text-gray-600 dark:text-gray-300">
                  Plus-One: {[item.plusOneFirstName, item.plusOneLastName].filter(Boolean).join(' ')}
                </div>
              )}
              <div className="text-sm font-semibold text-secondary uppercase tracking-wider">
                Code: <code className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-sm font-mono text-red-600 dark:text-red-400">{item.code}</code>
              </div>
              <div className="text-xs mt-1 text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-4">
                <span>Status: <span className={item.used ? 'text-red-500 font-semibold' : 'text-green-500 font-semibold'}>{item.used ? 'Redeemed/Used' : 'Active/Unused'}</span></span>
                <span>
                  RSVP:{' '}
                  <span
                    className={
                      getAttendanceStatus(item) === 'attending'
                        ? 'text-green-600 font-semibold'
                        : getAttendanceStatus(item) === 'declined'
                          ? 'text-red-600 font-semibold'
                          : 'text-amber-600 font-semibold'
                    }
                  >
                    {getAttendanceStatus(item).charAt(0).toUpperCase() + getAttendanceStatus(item).slice(1)}
                  </span>
                </span>
              </div>
              {item.dietaryNotes && item.dietaryNotes.trim() && (
                <div className="mt-2 inline-flex items-center gap-1.5 bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-700/50 text-xs px-2.5 py-1 rounded-full font-medium" data-testid="dietary-badge">
                  <span className="font-semibold">Dietary:</span> {item.dietaryNotes.trim()}
                </div>
              )}
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
        ))}
        {codes.length === 0 && <p className="text-gray-500 dark:text-gray-400">No invitation codes found.</p>}
        {codes.length > 0 && filteredCodes.length === 0 && (
          <p className="text-gray-500 dark:text-gray-400">No invitation codes match your search or filter criteria.</p>
        )}
      </div>
    </div>
  );
}
