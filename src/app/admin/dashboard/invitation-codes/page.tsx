'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAdminInvitationCodes } from '@/hooks/admin/useAdminInvitationCodes';
import { useAdminSubEvents } from '@/hooks/admin/useAdminSubEvents';
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
    removeBatch,
    updateBatch,
    fetchAll,
  } = useAdminInvitationCodes();

  useAdminSubEvents();

  const [isCreating, setIsCreating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isBatchDeleteModalOpen, setIsBatchDeleteModalOpen] = useState(false);
  const [bulkHouseholdModalOpen, setBulkHouseholdModalOpen] = useState(false);
  const [bulkHouseholdInput, setBulkHouseholdInput] = useState('');
  const [bulkTagModalOpen, setBulkTagModalOpen] = useState(false);
  const [bulkTagInput, setBulkTagInput] = useState('');
  const [bulkTagAction, setBulkTagAction] = useState<'add' | 'remove'>('add');

  const [newCode, setNewCode] = useState({
    guestName: '',
    code: '',
    email: '',
    plusOneFirstName: '',
    plusOneLastName: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    zipCode: '',
    country: '',
    householdName: '',
    partyGroup: '',
    partyTags: '',
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'redeemed' | 'unused'>('all');
  const [addressFilter, setAddressFilter] = useState<'all' | 'complete' | 'missing'>('all');
  const [dietaryFilter, setDietaryFilter] = useState<string>('all');
  const [attendanceFilter, setAttendanceFilter] = useState<'all' | 'attending' | 'declined' | 'pending'>('all');
  const [partyGroupFilter, setPartyGroupFilter] = useState<string>('all');
  const [selectedTagFilter, setSelectedTagFilter] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [subEvents, setSubEvents] = useState<any[]>([]);
  const [accessMatrix, setAccessMatrix] = useState<Record<string, string[]>>({});
  const [isSubEventModalOpen, setIsSubEventModalOpen] = useState(false);
  const [newSubEvent, setNewSubEvent] = useState({
    title: '',
    description: '',
    locationName: '',
    category: '',
    isPrivate: true,
  });

  const fetchSubEventsAndMatrix = async () => {
    try {
      const res = await fetch('/api/admin/sub-events/access');
      if (res.ok) {
        const json = await res.json();
        const data = json.data || json;
        if (data.subEvents) {
          setSubEvents(data.subEvents);
        }
        if (data.invitationCodes) {
          const map: Record<string, string[]> = {};
          data.invitationCodes.forEach((c: any) => {
            map[c.id] = c.allowedSubEventIds || [];
          });
          setAccessMatrix(map);
        }
      }
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    fetchSubEventsAndMatrix();
  }, []);

  const handleToggleSubEventAccess = async (invitationCodeId: string, subEventId: string, isAllowed: boolean) => {
    const currentAllowed = accessMatrix[invitationCodeId] || [];
    const updated = isAllowed
      ? Array.from(new Set([...currentAllowed, subEventId]))
      : currentAllowed.filter((id) => id !== subEventId);

    setAccessMatrix((prev) => ({ ...prev, [invitationCodeId]: updated }));

    try {
      const res = await fetch('/api/admin/sub-events/access', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invitationCodeId, allowedSubEventIds: updated }),
      });
      if (!res.ok) throw new Error('Failed to update event permissions');
      addToast('Sub-event permissions updated.', 'success');
    } catch (e: any) {
      addToast(e.message || 'Failed to update sub-event permissions.', 'error');
      fetchSubEventsAndMatrix();
    }
  };

  const handleCreateSubEvent = async () => {
    if (!newSubEvent.title.trim()) {
      addToast('Sub-event title is required.', 'error');
      return;
    }
    try {
      const res = await fetch('/api/admin/sub-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newSubEvent.title.trim(),
          description: newSubEvent.description.trim() || undefined,
          locationName: newSubEvent.locationName.trim() || undefined,
          category: newSubEvent.category.trim() || undefined,
          isPrivate: newSubEvent.isPrivate,
        }),
      });
      if (!res.ok) throw new Error('Failed to create sub-event.');
      addToast('Sub-event created successfully.', 'success');
      setNewSubEvent({ title: '', description: '', locationName: '', category: '', isPrivate: true });
      setIsSubEventModalOpen(false);
      fetchSubEventsAndMatrix();
    } catch (e: any) {
      addToast(e.message || 'Failed to create sub-event.', 'error');
    }
  };

  const selectAllRef = useRef<HTMLInputElement>(null);

  // Guardrail: Reset selection state when active search query or filters change
  useEffect(() => {
    setSelectedIds([]);
  }, [searchQuery, statusFilter, attendanceFilter, dietaryFilter, addressFilter, partyGroupFilter, selectedTagFilter]);

  const allUniqueTags = useMemo(() => {
    const set = new Set<string>();
    codes.forEach((c) => {
      (c.partyTags || []).forEach((t) => {
        if (t.trim()) set.add(t.trim());
      });
    });
    return Array.from(set).sort();
  }, [codes]);

  const allUniquePartyGroups = useMemo(() => {
    const set = new Set<string>();
    codes.forEach((c) => {
      if (c.partyGroup?.trim()) set.add(c.partyGroup.trim());
    });
    return Array.from(set).sort();
  }, [codes]);

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

      const hasAddress = isAddressComplete(item);
      if (addressFilter === 'complete' && !hasAddress) return false;
      if (addressFilter === 'missing' && hasAddress) return false;

      if (attendanceFilter !== 'all') {
        const attendanceStatus = getAttendanceStatus(item);
        if (attendanceFilter !== attendanceStatus) return false;
      }

      if (dietaryFilter !== 'all') {
        if (!matchDietaryCategory(item.dietaryNotes, dietaryFilter)) {
          return false;
        }
      }

      if (partyGroupFilter !== 'all') {
        if ((item.partyGroup || '') !== partyGroupFilter) return false;
      }

      if (selectedTagFilter) {
        if (!item.partyTags || !item.partyTags.includes(selectedTagFilter)) return false;
      }

      if (!query) return true;

      const matchesName = item.guestName ? item.guestName.toLowerCase().includes(query) : false;
      const matchesCode = item.code ? item.code.toLowerCase().includes(query) : false;
      const matchesEmail = item.email ? item.email.toLowerCase().includes(query) : false;
      const matchesPlusOneFirstName = item.plusOneFirstName ? item.plusOneFirstName.toLowerCase().includes(query) : false;
      const matchesPlusOneLastName = item.plusOneLastName ? item.plusOneLastName.toLowerCase().includes(query) : false;
      const matchesAddress = [item.addressLine1, item.addressLine2, item.city, item.state, item.zipCode, item.country]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query);
      const matchesDietary = item.dietaryNotes ? item.dietaryNotes.toLowerCase().includes(query) : false;
      const matchesHousehold = item.householdName ? item.householdName.toLowerCase().includes(query) : false;
      const matchesPartyGroup = item.partyGroup ? item.partyGroup.toLowerCase().includes(query) : false;
      const matchesTags = item.partyTags ? item.partyTags.some((t) => t.toLowerCase().includes(query)) : false;

      return (
        matchesName ||
        matchesCode ||
        matchesEmail ||
        matchesPlusOneFirstName ||
        matchesPlusOneLastName ||
        matchesAddress ||
        matchesDietary ||
        matchesHousehold ||
        matchesPartyGroup ||
        matchesTags
      );
    });
  }, [codes, searchQuery, statusFilter, addressFilter, attendanceFilter, dietaryFilter, partyGroupFilter, selectedTagFilter]);

  const allFilteredSelected = useMemo(() => {
    if (filteredCodes.length === 0) return false;
    return filteredCodes.every((item) => selectedIds.includes(item.id));
  }, [filteredCodes, selectedIds]);

  const isIndeterminate = useMemo(() => {
    const selectedFilteredCount = filteredCodes.filter((item) => selectedIds.includes(item.id)).length;
    return selectedFilteredCount > 0 && !allFilteredSelected;
  }, [filteredCodes, selectedIds, allFilteredSelected]);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = isIndeterminate;
    }
  }, [isIndeterminate]);

  const handleToggleSelectAll = () => {
    if (allFilteredSelected) {
      const filteredIdSet = new Set(filteredCodes.map((c) => c.id));
      setSelectedIds((prev) => prev.filter((id) => !filteredIdSet.has(id)));
    } else {
      const filteredIds = filteredCodes.map((c) => c.id);
      setSelectedIds((prev) => Array.from(new Set([...prev, ...filteredIds])));
    }
  };

  const handleToggleSelectRow = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleBatchMarkRedeemed = async () => {
    if (selectedIds.length === 0) return;
    try {
      await updateBatch(selectedIds, { used: true });
      addToast(`Marked ${selectedIds.length} invitation code(s) as redeemed.`, 'success');
      setSelectedIds([]);
    } catch (e: any) {
      addToast(e.message || 'Failed to update invitation codes.', 'error');
    }
  };

  const handleBatchMarkUnused = async () => {
    if (selectedIds.length === 0) return;
    try {
      await updateBatch(selectedIds, { used: false });
      addToast(`Marked ${selectedIds.length} invitation code(s) as unused.`, 'success');
      setSelectedIds([]);
    } catch (e: any) {
      addToast(e.message || 'Failed to update invitation codes.', 'error');
    }
  };

  const handleExportSelectedCsv = () => {
    const selectedCodes = codes.filter((item) => selectedIds.includes(item.id));
    if (selectedCodes.length === 0) {
      addToast('No invitation codes selected for export.', 'info');
      return;
    }

    const exportRecords = selectedCodes.map((item) => ({
      'Guest Name': item.guestName || '',
      'Invitation Code': item.code || '',
      Email: item.email || '',
      'Household Name': item.householdName || '',
      'Party Group': item.partyGroup || '',
      'Party Tags': (item.partyTags || []).join(', '),
      'Dietary Notes': item.dietaryNotes || '',
      'Plus Ones': item.plusOneAllocations ?? 0,
      Status: item.used ? 'Redeemed' : 'Unused',
    }));

    const csvText = generateCsvContent(exportRecords);
    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `selected-invitation-codes-${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    addToast(`Exported ${selectedCodes.length} selected invitation code(s) to CSV.`, 'success');
  };

  const handleConfirmBatchDelete = async () => {
    const count = selectedIds.length;
    try {
      await removeBatch(selectedIds);
      addToast(`Successfully deleted ${count} invitation code(s).`, 'success');
      setSelectedIds([]);
      setIsBatchDeleteModalOpen(false);
    } catch (e: any) {
      addToast(e.message || 'Failed to delete selected invitation codes.', 'error');
    }
  };

  const handleBulkSetHousehold = async () => {
    if (selectedIds.length === 0) return;
    try {
      await updateBatch(selectedIds, { householdName: bulkHouseholdInput.trim() || null } as any);
      addToast(`Updated household name for ${selectedIds.length} code(s).`, 'success');
      setBulkHouseholdModalOpen(false);
      setBulkHouseholdInput('');
      setSelectedIds([]);
    } catch (e: any) {
      addToast(e.message || 'Failed to update household name.', 'error');
    }
  };

  const handleBulkUpdateTags = async () => {
    if (selectedIds.length === 0 || !bulkTagInput.trim()) return;
    const tagToProcess = bulkTagInput.trim();
    try {
      const selectedCodes = codes.filter((c) => selectedIds.includes(c.id));
      await Promise.all(
        selectedCodes.map((c) => {
          let currentTags = c.partyTags || [];
          if (bulkTagAction === 'add') {
            if (!currentTags.includes(tagToProcess)) {
              currentTags = [...currentTags, tagToProcess];
            }
          } else {
            currentTags = currentTags.filter((t) => t !== tagToProcess);
          }
          return updateBatch([c.id], { partyTags: currentTags } as any);
        })
      );
      addToast(`Updated tags for ${selectedIds.length} code(s).`, 'success');
      setBulkTagModalOpen(false);
      setBulkTagInput('');
      setSelectedIds([]);
    } catch (e: any) {
      addToast(e.message || 'Failed to update tags.', 'error');
    }
  };

  const handleSave = async () => {
    if (!newCode.guestName.trim()) {
      addToast('Guest name is required.', 'error');
      return;
    }
    try {
      const payload: any = {
        guestName: newCode.guestName.trim(),
        code: newCode.code ? newCode.code.trim().toUpperCase() : undefined,
        plusOneFirstName: newCode.plusOneFirstName.trim() || undefined,
        plusOneLastName: newCode.plusOneLastName.trim() || undefined,
        householdName: newCode.householdName.trim() || undefined,
        partyGroup: newCode.partyGroup.trim() || undefined,
        partyTags: newCode.partyTags ? newCode.partyTags.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
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
        plusOneFirstName: '',
        plusOneLastName: '',
        addressLine1: '',
        addressLine2: '',
        city: '',
        state: '',
        zipCode: '',
        country: '',
        householdName: '',
        partyGroup: '',
        partyTags: '',
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
      'Plus-One First Name': item.plusOneFirstName || '',
      'Plus-One Last Name': item.plusOneLastName || '',
      'Household Name': item.householdName || '',
      'Party Group': item.partyGroup || '',
      'Party Tags': (item.partyTags || []).join(', '),
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
    <div className="py-10 px-4 sm:px-6 max-w-5xl mx-auto relative pb-28">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-extrabold text-primary">Pre-Authorized Guest Invitation Codes</h1>
        <div className="flex gap-4">
          <Button variant="ghost" onClick={() => router.push('/admin/dashboard')}>Back to Dashboard</Button>
          <Button variant="secondary" onClick={() => setIsSubEventModalOpen(true)}>Manage Sub-Events</Button>
          <Button variant="secondary" onClick={() => setIsImporting(true)}>Import CSV</Button>
          <Button variant="secondary" onClick={handleExportCsv}>Export CSV</Button>
          <Button onClick={() => {
            setNewCode({
              guestName: '',
              code: '',
              email: '',
              plusOneFirstName: '',
              plusOneLastName: '',
              addressLine1: '',
              addressLine2: '',
              city: '',
              state: '',
              zipCode: '',
              country: '',
              householdName: '',
              partyGroup: '',
              partyTags: '',
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
            <FormGroup>
              <Label>Household Name (Optional)</Label>
              <Input
                type="text"
                placeholder="e.g. Smith Household"
                value={newCode.householdName}
                onChange={e => setNewCode({ ...newCode, householdName: e.target.value })}
              />
            </FormGroup>
            <FormGroup>
              <Label>Party Side / Group (Optional)</Label>
              <Input
                type="text"
                placeholder="e.g. Bride, Groom, Joint"
                value={newCode.partyGroup}
                onChange={e => setNewCode({ ...newCode, partyGroup: e.target.value })}
              />
            </FormGroup>
            <FormGroup className="md:col-span-2">
              <Label>Party Tags (Optional - comma-separated)</Label>
              <Input
                type="text"
                placeholder="e.g. VIP, Rehearsal Dinner, Family"
                value={newCode.partyTags}
                onChange={e => setNewCode({ ...newCode, partyTags: e.target.value })}
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
              placeholder="Search by name, code, email, household, tag..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search invitation codes"
              className="w-full"
            />
          </FormGroup>

          <div className="flex flex-wrap gap-3 items-center">
            <FormGroup className="w-full sm:w-auto space-y-0">
              <Select
                id="party-group-filter"
                aria-label="Filter by party side or group"
                value={partyGroupFilter}
                onChange={(e) => setPartyGroupFilter(e.target.value)}
                className="w-full sm:w-auto"
              >
                <option value="all">All Party Groups</option>
                <option value="Bride">Bride</option>
                <option value="Groom">Groom</option>
                <option value="Joint">Joint</option>
                {allUniquePartyGroups
                  .filter((g) => !['Bride', 'Groom', 'Joint'].includes(g))
                  .map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
              </Select>
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
        </div>

        {/* Interactive Tag Filter Pills Bar */}
        {allUniqueTags.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap bg-white dark:bg-gray-800 p-3 rounded-xl border border-gray-200 dark:border-gray-700">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Party Tags:</span>
            <button
              type="button"
              onClick={() => setSelectedTagFilter(null)}
              className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                selectedTagFilter === null
                  ? 'bg-primary text-white font-bold'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200'
              }`}
            >
              All Tags
            </button>
            {allUniqueTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setSelectedTagFilter(selectedTagFilter === tag ? null : tag)}
                className={`px-2.5 py-1 text-xs rounded-full transition-colors font-medium ${
                  selectedTagFilter === tag
                    ? 'bg-blue-600 text-white font-bold ring-2 ring-blue-300'
                    : 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-200 border border-blue-200 dark:border-blue-800 hover:bg-blue-100'
                }`}
              >
                #{tag}
              </button>
            ))}
          </div>
        )}

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
                role="tab"
                aria-selected={statusFilter === 'redeemed'}
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
                role="tab"
                aria-selected={statusFilter === 'unused'}
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
          </div>

          {/* Address Completion Filter */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Address:</span>
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

          {/* RSVP Attendance Status Tab Group */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Attendance:</span>
            <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-1 border border-gray-200 dark:border-gray-700">
              <button
                type="button"
                onClick={() => setAttendanceFilter('all')}
                aria-label={`All attendance (${attendanceCounts.all})`}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
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
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
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
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
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
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
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

      {filteredCodes.length > 0 && (
        <div className="flex items-center gap-3 mb-4 bg-gray-50 dark:bg-gray-800/60 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
          <input
            ref={selectAllRef}
            type="checkbox"
            id="select-all-filtered"
            checked={allFilteredSelected}
            onChange={handleToggleSelectAll}
            aria-label="Select all filtered invitation codes"
            className="rounded border-gray-300 text-primary focus:ring-primary h-4 w-4 cursor-pointer"
          />
          <label htmlFor="select-all-filtered" className="text-sm font-semibold text-gray-700 dark:text-gray-200 cursor-pointer">
            Select All Filtered ({filteredCodes.length})
          </label>
        </div>
      )}

      <div className="grid gap-4 pb-10" ref={containerRef}>
        {filteredCodes.map((item) => {
          const hasAddress = isAddressComplete(item);
          return (
            <div key={item.id} className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow border border-primary flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="flex items-center gap-4 space-y-1">
                <input
                  type="checkbox"
                  aria-label={`Select invitation code for ${item.guestName}`}
                  checked={selectedIds.includes(item.id)}
                  onChange={() => handleToggleSelectRow(item.id)}
                  className="rounded border-gray-300 text-primary focus:ring-primary h-5 w-5 cursor-pointer"
                />
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-lg text-gray-900 dark:text-white">{item.guestName}</span>
                    {item.householdName && (
                      <span
                        className="px-2 py-0.5 rounded text-xs bg-purple-50 text-purple-800 dark:bg-purple-950/50 dark:text-purple-200 font-semibold border border-purple-200 dark:border-purple-800"
                        data-testid="household-badge"
                      >
                        🏠 {item.householdName}
                      </span>
                    )}
                    {item.partyGroup && (
                      <span
                        className="px-2 py-0.5 rounded text-xs bg-indigo-50 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200 font-semibold border border-indigo-200 dark:border-indigo-800"
                        data-testid="party-group-badge"
                      >
                        👥 {item.partyGroup}
                      </span>
                    )}
                  </div>
                  {(item.plusOneFirstName || item.plusOneLastName) && (
                    <div className="text-sm text-gray-600 dark:text-gray-300">
                      Plus-One: {[item.plusOneFirstName, item.plusOneLastName].filter(Boolean).join(' ')}
                    </div>
                  )}
                  <div className="text-sm font-semibold text-secondary uppercase tracking-wider">
                    Code: <code className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-sm font-mono text-red-600 dark:text-red-400">{item.code}</code>
                  </div>

                  {/* Party Tags Display */}
                  {item.partyTags && item.partyTags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {item.partyTags.map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 rounded-full text-[11px] bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-200 border border-blue-200 dark:border-blue-800 font-medium"
                          data-testid="party-tag-pill"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}

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

                  <div className="text-xs text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-4 pt-1">
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

                  {/* Private Sub-Event Access Matrix Toggles */}
                  <div className="mt-3 pt-2 border-t border-gray-100 dark:border-gray-700/60" data-testid={`sub-event-access-${item.id}`}>
                    <span className="text-xs font-bold text-gray-700 dark:text-gray-300 block mb-1">
                      Private Sub-Event Permissions:
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {subEvents.length === 0 ? (
                        <span className="text-xs text-gray-400 italic">No sub-events created yet</span>
                      ) : (
                        subEvents.map((evt) => {
                          const isAllowed = (accessMatrix[item.id] || []).includes(evt.id);
                          return (
                            <label
                              key={evt.id}
                              className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border transition-colors cursor-pointer ${
                                isAllowed
                                  ? 'bg-red-50 dark:bg-red-950/40 text-primary dark:text-red-300 border-red-200 dark:border-red-800'
                                  : 'bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isAllowed}
                                aria-label={`Toggle access for ${evt.title} on ${item.guestName}`}
                                onChange={(e) => handleToggleSubEventAccess(item.id, evt.id, e.target.checked)}
                                className="rounded border-gray-300 text-primary focus:ring-primary h-3.5 w-3.5 cursor-pointer"
                              />
                              <span>
                                {evt.title} {evt.isPrivate ? '(Private)' : '(Public)'}
                              </span>
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
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

      {selectedIds.length > 0 && (
        <div
          role="region"
          aria-label="Batch actions toolbar"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-11/12 max-w-3xl bg-gray-900 text-white dark:bg-gray-800 dark:text-white p-4 rounded-2xl shadow-2xl border border-gray-700 flex flex-wrap items-center justify-between gap-3 text-sm animate-fade-in"
        >
          <div className="flex items-center gap-2">
            <span className="font-bold px-2.5 py-1 bg-primary text-white rounded-lg text-xs tracking-wide uppercase">
              {selectedIds.length} Selected
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setBulkHouseholdModalOpen(true)}>
              Set Household
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setBulkTagModalOpen(true)}>
              Manage Tags
            </Button>
            <Button size="sm" variant="secondary" onClick={handleBatchMarkRedeemed}>
              Mark as Redeemed
            </Button>
            <Button size="sm" variant="secondary" onClick={handleBatchMarkUnused}>
              Mark as Unused
            </Button>
            <Button size="sm" variant="secondary" onClick={handleExportSelectedCsv}>
              Export Selected CSV
            </Button>
            <Button size="sm" variant="danger" onClick={() => setIsBatchDeleteModalOpen(true)}>
              Delete Selected
            </Button>
            <Button size="sm" variant="ghost" className="text-gray-300 hover:text-white" onClick={() => setSelectedIds([])}>
              Deselect All
            </Button>
          </div>
        </div>
      )}

      {bulkHouseholdModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="bg-white dark:bg-gray-800 rounded-xl max-w-md w-full p-6 shadow-2xl border border-gray-200 dark:border-gray-700 space-y-4">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              Set Household Name ({selectedIds.length} Selected)
            </h2>
            <FormGroup>
              <Label>Household Name</Label>
              <Input
                type="text"
                placeholder="e.g. Smith Household"
                value={bulkHouseholdInput}
                onChange={(e) => setBulkHouseholdInput(e.target.value)}
              />
            </FormGroup>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" onClick={() => setBulkHouseholdModalOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleBulkSetHousehold}>
                Apply Household Name
              </Button>
            </div>
          </div>
        </div>
      )}

      {bulkTagModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="bg-white dark:bg-gray-800 rounded-xl max-w-md w-full p-6 shadow-2xl border border-gray-200 dark:border-gray-700 space-y-4">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              Manage Party Tags ({selectedIds.length} Selected)
            </h2>
            <div className="flex gap-4">
              <label className="inline-flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="radio"
                  name="tagAction"
                  checked={bulkTagAction === 'add'}
                  onChange={() => setBulkTagAction('add')}
                />
                <span>Add Tag</span>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="radio"
                  name="tagAction"
                  checked={bulkTagAction === 'remove'}
                  onChange={() => setBulkTagAction('remove')}
                />
                <span>Remove Tag</span>
              </label>
            </div>
            <FormGroup>
              <Label>Tag Name</Label>
              <Input
                type="text"
                placeholder="e.g. VIP"
                value={bulkTagInput}
                onChange={(e) => setBulkTagInput(e.target.value)}
              />
            </FormGroup>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" onClick={() => setBulkTagModalOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleBulkUpdateTags}>
                Apply Tag Changes
              </Button>
            </div>
          </div>
        </div>
      )}

      {isBatchDeleteModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="batch-delete-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="bg-white dark:bg-gray-800 rounded-xl max-w-lg w-full p-6 shadow-2xl border border-gray-200 dark:border-gray-700 space-y-4">
            <h2 id="batch-delete-modal-title" className="text-xl font-bold text-gray-900 dark:text-white">
              Confirm Batch Deletion
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Are you sure you want to delete <span className="font-bold text-red-600 dark:text-red-400">{selectedIds.length}</span> selected invitation code(s)? This action cannot be undone.
            </p>
            <div className="bg-gray-50 dark:bg-gray-700/50 p-3 rounded-lg border border-gray-200 dark:border-gray-600 max-h-48 overflow-y-auto">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                Selected Guests:
              </p>
              <ul className="space-y-1 text-sm text-gray-800 dark:text-gray-200">
                {codes
                  .filter((c) => selectedIds.includes(c.id))
                  .map((c) => (
                    <li key={c.id} className="flex justify-between items-center py-1 border-b border-gray-100 dark:border-gray-700 last:border-0">
                      <span className="font-medium">{c.guestName}</span>
                      <code className="text-xs font-mono text-gray-500 dark:text-gray-400">{c.code}</code>
                    </li>
                  ))}
              </ul>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" onClick={() => setIsBatchDeleteModalOpen(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={handleConfirmBatchDelete}>
                Delete {selectedIds.length} Code(s)
              </Button>
            </div>
          </div>
        </div>
      )}

      {isSubEventModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="sub-event-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="bg-white dark:bg-gray-800 rounded-xl max-w-lg w-full p-6 shadow-2xl border border-gray-200 dark:border-gray-700 space-y-4">
            <h2 id="sub-event-modal-title" className="text-xl font-bold text-gray-900 dark:text-white">
              Create Timeline Sub-Event
            </h2>
            <div className="space-y-3">
              <FormGroup>
                <Label>Event Title</Label>
                <Input
                  type="text"
                  placeholder="e.g. Rehearsal Dinner"
                  value={newSubEvent.title}
                  onChange={(e) => setNewSubEvent({ ...newSubEvent, title: e.target.value })}
                />
              </FormGroup>
              <FormGroup>
                <Label>Description / Notes</Label>
                <Input
                  type="text"
                  placeholder="e.g. Invitation only dinner for bridal party"
                  value={newSubEvent.description}
                  onChange={(e) => setNewSubEvent({ ...newSubEvent, description: e.target.value })}
                />
              </FormGroup>
              <FormGroup>
                <Label>Location</Label>
                <Input
                  type="text"
                  placeholder="e.g. Sunset Bistro"
                  value={newSubEvent.locationName}
                  onChange={(e) => setNewSubEvent({ ...newSubEvent, locationName: e.target.value })}
                />
              </FormGroup>
              <FormGroup>
                <Label>Privacy Setting</Label>
                <div className="flex items-center gap-4 pt-1">
                  <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200 cursor-pointer">
                    <input
                      type="radio"
                      name="isPrivate"
                      checked={newSubEvent.isPrivate}
                      onChange={() => setNewSubEvent({ ...newSubEvent, isPrivate: true })}
                      className="text-primary focus:ring-primary"
                    />
                    <span className="font-semibold text-red-600 dark:text-red-400">Private Event</span> (Restricted)
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200 cursor-pointer">
                    <input
                      type="radio"
                      name="isPrivate"
                      checked={!newSubEvent.isPrivate}
                      onChange={() => setNewSubEvent({ ...newSubEvent, isPrivate: false })}
                      className="text-primary focus:ring-primary"
                    />
                    <span className="font-semibold text-green-600 dark:text-green-400">Public Event</span> (Visible to all)
                  </label>
                </div>
              </FormGroup>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" onClick={() => setIsSubEventModalOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateSubEvent}>
                Create Event
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
