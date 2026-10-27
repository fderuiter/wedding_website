'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useToast } from '@/components/ui/ToastProvider';
import { Button } from '@/components/ui/Button';

interface SubEvent {
  id: string;
  title: string;
  description?: string;
  locationName?: string;
  category?: string;
  isPrivate: boolean;
}

interface InvitationCode {
  id: string;
  code: string;
  guestName: string;
  householdName?: string | null;
  partyGroup?: string | null;
  partyTags?: string[];
  allowedSubEventIds?: string[];
}

export default function SubEventsMatrixPage() {
  const { addToast } = useToast();
  const [subEvents, setSubEvents] = useState<SubEvent[]>([]);
  const [invitationCodes, setInvitationCodes] = useState<InvitationCode[]>([]);
  const [accessMatrix, setAccessMatrix] = useState<Record<string, string[]>>({});
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedTagFilter, setSelectedTagFilter] = useState<string>('all');
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<string>('all');
  const [selectedHouseholdFilter, setSelectedHouseholdFilter] = useState<string>('all');

  // Pagination
  const [pageSize, setPageSize] = useState<number>(25);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalRecords, setTotalRecords] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);

  // Available Filter Options
  const [filterOptions, setFilterOptions] = useState<{
    partyTags: string[];
    partyGroups: string[];
    householdNames: string[];
  }>({ partyTags: [], partyGroups: [], householdNames: [] });

  // Multi-row selection
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);

  // Create Sub-Event Modal
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [newSubEvent, setNewSubEvent] = useState({
    title: '',
    description: '',
    locationName: '',
    category: '',
    isPrivate: true,
  });

  const fetchMatrix = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', currentPage.toString());
      params.set('limit', pageSize.toString());
      if (searchQuery.trim()) params.set('search', searchQuery.trim());
      if (selectedTagFilter !== 'all') params.set('partyTag', selectedTagFilter);
      if (selectedGroupFilter !== 'all') params.set('partyGroup', selectedGroupFilter);
      if (selectedHouseholdFilter !== 'all') params.set('householdName', selectedHouseholdFilter);

      const res = await fetch(`/api/admin/sub-events/access?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load access matrix');
      const json = await res.json();
      const data = json.data || json;

      const events: SubEvent[] = data.subEvents || [];
      const codes: InvitationCode[] = data.invitationCodes || [];
      const pagination = data.pagination || { total: codes.length, page: currentPage, limit: pageSize, totalPages: 1 };
      const opts = data.filterOptions || { partyTags: [], partyGroups: [], householdNames: [] };

      setSubEvents(events);
      setInvitationCodes(codes);
      setTotalRecords(pagination.total ?? codes.length);
      setTotalPages(pagination.totalPages ?? 1);
      setFilterOptions(opts);

      const matrixMap: Record<string, string[]> = {};
      codes.forEach((c) => {
        matrixMap[c.id] = c.allowedSubEventIds || [];
      });
      setAccessMatrix(matrixMap);
    } catch (e: any) {
      addToast(e.message || 'Error fetching access matrix', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
    setSelectedRowIds([]);
  }, [searchQuery, selectedTagFilter, selectedGroupFilter, selectedHouseholdFilter, pageSize]);

  // Fetch matrix when page or filters or pageSize change
  useEffect(() => {
    fetchMatrix();
  }, [currentPage, pageSize, searchQuery, selectedTagFilter, selectedGroupFilter, selectedHouseholdFilter]);

  // Unique filter values
  const allTags = useMemo(() => {
    const set = new Set<string>(filterOptions.partyTags || []);
    invitationCodes.forEach((c) => {
      (c.partyTags || []).forEach((t) => {
        if (t?.trim()) set.add(t.trim());
      });
    });
    return Array.from(set).sort();
  }, [filterOptions.partyTags, invitationCodes]);

  const allGroups = useMemo(() => {
    const set = new Set<string>(filterOptions.partyGroups || []);
    invitationCodes.forEach((c) => {
      if (c.partyGroup?.trim()) set.add(c.partyGroup.trim());
    });
    return Array.from(set).sort();
  }, [filterOptions.partyGroups, invitationCodes]);

  const allHouseholds = useMemo(() => {
    const set = new Set<string>(filterOptions.householdNames || []);
    invitationCodes.forEach((c) => {
      if (c.householdName?.trim()) set.add(c.householdName.trim());
    });
    return Array.from(set).sort();
  }, [filterOptions.householdNames, invitationCodes]);

  const privateSubEvents = useMemo(() => {
    return subEvents.filter((s) => s.isPrivate);
  }, [subEvents]);

  // Paginated Codes are directly returned from the API
  const paginatedCodes = invitationCodes;

  // Optimistic Single Cell Toggle
  const handleToggleCell = async (invitationCodeId: string, subEventId: string, willAllow: boolean) => {
    const currentAllowed = accessMatrix[invitationCodeId] || [];
    const updated = willAllow
      ? Array.from(new Set([...currentAllowed, subEventId]))
      : currentAllowed.filter((id) => id !== subEventId);

    const previousMatrix = { ...accessMatrix };
    setAccessMatrix((prev) => ({ ...prev, [invitationCodeId]: updated }));

    try {
      const res = await fetch('/api/admin/sub-events/access', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invitationCodeId, allowedSubEventIds: updated }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to update access');
      }
      addToast('Sub-event access updated.', 'success');
    } catch (e: any) {
      setAccessMatrix(previousMatrix);
      addToast(e.message || 'Failed to update access. Reverted changes.', 'error');
    }
  };

  // Bulk Column Toggle (for all currently filtered guests)
  const handleColumnToggle = async (subEventId: string, action: 'grant' | 'revoke') => {
    const body: any = {
      subEventIds: [subEventId],
      action,
    };

    if (searchQuery.trim()) body.search = searchQuery.trim();
    if (selectedTagFilter !== 'all') body.partyTags = [selectedTagFilter];
    if (selectedGroupFilter !== 'all') body.partyGroups = [selectedGroupFilter];
    if (selectedHouseholdFilter !== 'all') body.householdName = [selectedHouseholdFilter];

    try {
      const res = await fetch('/api/admin/sub-events/access/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Batch column update failed');
      }
      addToast(
        `Access ${action === 'grant' ? 'granted' : 'revoked'} for column across matching guests.`,
        'success'
      );
      fetchMatrix();
    } catch (e: any) {
      addToast(e.message || 'Batch update failed.', 'error');
    }
  };

  // Bulk Row Toggle (for all private sub-events for a single guest)
  const handleRowToggle = async (invitationCodeId: string, action: 'grant' | 'revoke') => {
    const privateIds = privateSubEvents.map((s) => s.id);
    if (privateIds.length === 0) return;

    const previousMatrix = { ...accessMatrix };

    const current = accessMatrix[invitationCodeId] || [];
    let updated: string[];
    if (action === 'grant') {
      updated = Array.from(new Set([...current, ...privateIds]));
    } else {
      updated = current.filter((id) => !privateIds.includes(id));
    }

    setAccessMatrix((prev) => ({ ...prev, [invitationCodeId]: updated }));

    try {
      const res = await fetch('/api/admin/sub-events/access/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invitationCodeIds: [invitationCodeId],
          subEventIds: privateIds,
          action,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Batch row update failed');
      }
      addToast(`Row permissions ${action === 'grant' ? 'granted' : 'revoked'}.`, 'success');
    } catch (e: any) {
      setAccessMatrix(previousMatrix);
      addToast(e.message || 'Failed to update row access. Reverted changes.', 'error');
    }
  };

  // Batch action for multi-selected rows
  const handleBatchSelectedRows = async (action: 'grant' | 'revoke', subEventIdsToApply?: string[]) => {
    if (selectedRowIds.length === 0) return;
    const targetSubEventIds = subEventIdsToApply || privateSubEvents.map((s) => s.id);
    if (targetSubEventIds.length === 0) return;

    const previousMatrix = { ...accessMatrix };

    const nextMatrix = { ...accessMatrix };
    selectedRowIds.forEach((codeId) => {
      const current = nextMatrix[codeId] || [];
      if (action === 'grant') {
        nextMatrix[codeId] = Array.from(new Set([...current, ...targetSubEventIds]));
      } else {
        nextMatrix[codeId] = current.filter((id) => !targetSubEventIds.includes(id));
      }
    });
    setAccessMatrix(nextMatrix);

    try {
      const res = await fetch('/api/admin/sub-events/access/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invitationCodeIds: selectedRowIds,
          subEventIds: targetSubEventIds,
          action,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Batch update failed');
      }

      addToast(`Batch ${action} completed for ${selectedRowIds.length} selected guests.`, 'success');
    } catch (e: any) {
      setAccessMatrix(previousMatrix);
      addToast(e.message || 'Batch update failed. Reverted changes.', 'error');
    }
  };

  // Create Sub-Event
  const handleCreateSubEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubEvent.title.trim()) {
      addToast('Title is required for sub-event.', 'error');
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

      if (!res.ok) throw new Error('Failed to create sub-event');
      addToast('Sub-event created successfully!', 'success');
      setNewSubEvent({ title: '', description: '', locationName: '', category: '', isPrivate: true });
      setIsModalOpen(false);
      fetchMatrix();
    } catch (err: any) {
      addToast(err.message || 'Error creating sub-event', 'error');
    }
  };

  // Row selection helpers
  const handleToggleSelectAllPaginated = (checked: boolean) => {
    if (checked) {
      const currentIds = paginatedCodes.map((c) => c.id);
      setSelectedRowIds(Array.from(new Set([...selectedRowIds, ...currentIds])));
    } else {
      const currentIds = new Set(paginatedCodes.map((c) => c.id));
      setSelectedRowIds(selectedRowIds.filter((id) => !currentIds.has(id)));
    }
  };

  const isAllPaginatedSelected =
    paginatedCodes.length > 0 && paginatedCodes.every((c) => selectedRowIds.includes(c.id));

  return (
    <div className="py-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-primary tracking-tight">Sub-Events Access Matrix</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Manage private sub-event permissions across guest invitation codes in bulk.
          </p>
        </div>
        <Button onClick={() => setIsModalOpen(true)}>
          + Create New Sub-Event
        </Button>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow border border-gray-200 dark:border-gray-700 flex flex-wrap gap-4 items-center justify-between">
        <div className="flex flex-wrap gap-3 items-center flex-1">
          {/* Search Input */}
          <div className="min-w-[200px] flex-1">
            <label htmlFor="matrix-search" className="sr-only">
              Search guests or households
            </label>
            <input
              id="matrix-search"
              type="text"
              placeholder="Search guest, code, household..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-600 focus:ring-primary focus:border-primary text-gray-900 dark:text-white"
            />
          </div>

          {/* Party Tag Filter */}
          <div>
            <select
              aria-label="Filter by Party Tag"
              value={selectedTagFilter}
              onChange={(e) => setSelectedTagFilter(e.target.value)}
              className="px-3 py-2 border rounded-lg text-sm bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
            >
              <option value="all">All Party Tags ({allTags.length})</option>
              {allTags.map((tag) => (
                <option key={tag} value={tag}>
                  Tag: {tag}
                </option>
              ))}
            </select>
          </div>

          {/* Party Group Filter */}
          <div>
            <select
              aria-label="Filter by Party Group"
              value={selectedGroupFilter}
              onChange={(e) => setSelectedGroupFilter(e.target.value)}
              className="px-3 py-2 border rounded-lg text-sm bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
            >
              <option value="all">All Party Groups ({allGroups.length})</option>
              {allGroups.map((grp) => (
                <option key={grp} value={grp}>
                  Group: {grp}
                </option>
              ))}
            </select>
          </div>

          {/* Household Filter */}
          <div>
            <select
              aria-label="Filter by Household"
              value={selectedHouseholdFilter}
              onChange={(e) => setSelectedHouseholdFilter(e.target.value)}
              className="px-3 py-2 border rounded-lg text-sm bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
            >
              <option value="all">All Households ({allHouseholds.length})</option>
              {allHouseholds.map((h) => (
                <option key={h} value={h}>
                  Household: {h}
                </option>
              ))}
            </select>
          </div>

          {/* Clear Filters */}
          {(searchQuery ||
            selectedTagFilter !== 'all' ||
            selectedGroupFilter !== 'all' ||
            selectedHouseholdFilter !== 'all') && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setSearchQuery('');
                setSelectedTagFilter('all');
                setSelectedGroupFilter('all');
                setSelectedHouseholdFilter('all');
              }}
            >
              Clear Filters
            </Button>
          )}
        </div>

        {/* Page size selector */}
        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <span>Per page:</span>
          <select
            aria-label="Rows per page"
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="px-2 py-1 border rounded text-sm bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-600"
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
      </div>

      {/* Access Matrix Table Container */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-gray-500 dark:text-gray-400">Loading sub-event access matrix...</div>
        ) : subEvents.length === 0 ? (
          <div className="p-12 text-center text-gray-500 dark:text-gray-400">
            No sub-events created yet. Click "+ Create New Sub-Event" to get started.
          </div>
        ) : totalRecords === 0 ? (
          <div className="p-12 text-center text-gray-500 dark:text-gray-400">
            No invitation codes match your filter criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-gray-100 dark:bg-gray-700/60 border-b border-gray-200 dark:border-gray-700">
                  {/* Select All Checkbox */}
                  <th className="p-3 w-10 text-center">
                    <input
                      type="checkbox"
                      aria-label="Select all page guests"
                      checked={isAllPaginatedSelected}
                      onChange={(e) => handleToggleSelectAllPaginated(e.target.checked)}
                      className="rounded border-gray-300 text-primary focus:ring-primary h-4 w-4"
                    />
                  </th>

                  {/* Guest Header */}
                  <th className="p-3 font-semibold text-gray-900 dark:text-white min-w-[220px]">
                    Guest / Code Details
                  </th>

                  {/* Sub-Events Column Headers */}
                  {subEvents.map((evt) => (
                    <th key={evt.id} className="p-3 font-semibold text-gray-900 dark:text-white min-w-[180px] border-l border-gray-200 dark:border-gray-700 align-top">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center justify-between gap-1">
                          <span className="truncate font-bold" title={evt.title}>
                            {evt.title}
                          </span>
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-bold ${
                              evt.isPrivate
                                ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700'
                                : 'bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-200 border border-green-300 dark:border-green-700'
                            }`}
                          >
                            {evt.isPrivate ? 'Private' : 'Public'}
                          </span>
                        </div>

                        {evt.isPrivate ? (
                          <div className="flex items-center gap-2 text-xs font-normal text-gray-500 dark:text-gray-400 mt-1">
                            <span>Bulk:</span>
                            <button
                              type="button"
                              className="text-primary hover:underline font-semibold"
                              onClick={() => handleColumnToggle(evt.id, 'grant')}
                              title={`Grant ${evt.title} access to all ${totalRecords} matching guests`}
                            >
                              Grant All
                            </button>
                            <span>|</span>
                            <button
                              type="button"
                              className="text-red-600 dark:text-red-400 hover:underline font-semibold"
                              onClick={() => handleColumnToggle(evt.id, 'revoke')}
                              title={`Revoke ${evt.title} access from all ${totalRecords} matching guests`}
                            >
                              Revoke All
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-gray-400 dark:text-gray-500 italic mt-1">
                            Accessible to all guests
                          </span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {paginatedCodes.map((code) => {
                  const allowedIds = accessMatrix[code.id] || [];
                  const isSelectedRow = selectedRowIds.includes(code.id);

                  return (
                    <tr
                      key={code.id}
                      className={`hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors ${
                        isSelectedRow ? 'bg-amber-50/50 dark:bg-amber-950/20' : ''
                      }`}
                    >
                      {/* Row Checkbox */}
                      <td className="p-3 text-center">
                        <input
                          type="checkbox"
                          aria-label={`Select row for ${code.guestName}`}
                          checked={isSelectedRow}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedRowIds([...selectedRowIds, code.id]);
                            } else {
                              setSelectedRowIds(selectedRowIds.filter((id) => id !== code.id));
                            }
                          }}
                          className="rounded border-gray-300 text-primary focus:ring-primary h-4 w-4"
                        />
                      </td>

                      {/* Guest Info Header Cell */}
                      <td className="p-3 font-medium text-gray-900 dark:text-white">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-gray-900 dark:text-white">{code.guestName}</span>
                            <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-mono">
                              {code.code}
                            </span>
                          </div>

                          {(code.householdName || code.partyGroup || (code.partyTags && code.partyTags.length > 0)) && (
                            <div className="flex flex-wrap gap-1 text-[11px] text-gray-500 dark:text-gray-400">
                              {code.householdName && (
                                <span className="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded border border-blue-200 dark:border-blue-800">
                                  H: {code.householdName}
                                </span>
                              )}
                              {code.partyGroup && (
                                <span className="bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded border border-purple-200 dark:border-purple-800">
                                  G: {code.partyGroup}
                                </span>
                              )}
                              {code.partyTags?.map((tag) => (
                                <span key={tag} className="bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-1.5 py-0.5 rounded">
                                  #{tag}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Row Bulk Toggle Controls */}
                          {privateSubEvents.length > 0 && (
                            <div className="flex items-center gap-2 text-xs font-normal text-gray-500 dark:text-gray-400 mt-1">
                              <span>Row:</span>
                              <button
                                type="button"
                                className="text-primary hover:underline font-semibold"
                                onClick={() => handleRowToggle(code.id, 'grant')}
                              >
                                Grant All
                              </button>
                              <span>|</span>
                              <button
                                type="button"
                                className="text-red-600 dark:text-red-400 hover:underline font-semibold"
                                onClick={() => handleRowToggle(code.id, 'revoke')}
                              >
                                Revoke All
                              </button>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Sub-Event Access Matrix Cells */}
                      {subEvents.map((evt) => {
                        const isAllowed = allowedIds.includes(evt.id);

                        if (!evt.isPrivate) {
                          return (
                            <td key={evt.id} className="p-3 border-l border-gray-200 dark:border-gray-700 text-center bg-gray-50/50 dark:bg-gray-800/50">
                              <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400 font-medium">
                                ✓ Public
                              </span>
                            </td>
                          );
                        }

                        return (
                          <td key={evt.id} className="p-3 border-l border-gray-200 dark:border-gray-700 text-center align-middle">
                            <label className="inline-flex items-center justify-center p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={isAllowed}
                                aria-label={`Toggle access for ${evt.title} on ${code.guestName}`}
                                onChange={(e) => handleToggleCell(code.id, evt.id, e.target.checked)}
                                className="rounded border-gray-300 text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                              />
                            </label>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {totalRecords > 0 && (
          <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-gray-600 dark:text-gray-300">
            <div>
              Showing {totalRecords === 0 ? 0 : (currentPage - 1) * pageSize + 1} to{' '}
              {Math.min(currentPage * pageSize, totalRecords)} of {totalRecords} guests
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span className="px-2 font-medium">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Floating Multi-Guest Action Bar */}
      {selectedRowIds.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-11/12 max-w-2xl bg-gray-900 text-white dark:bg-gray-800 p-4 rounded-2xl shadow-2xl border border-gray-700 flex flex-wrap items-center justify-between gap-3 animate-fade-in">
          <div className="flex items-center gap-2">
            <span className="font-bold px-2.5 py-1 bg-primary text-white rounded-lg text-xs tracking-wide uppercase">
              {selectedRowIds.length} Guests Selected
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => handleBatchSelectedRows('grant')}>
              Grant All Private Events
            </Button>
            <Button size="sm" variant="danger" onClick={() => handleBatchSelectedRows('revoke')}>
              Revoke All Private Events
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setSelectedRowIds([])}>
              Clear Selection
            </Button>
          </div>
        </div>
      )}

      {/* Create Sub-Event Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-md w-full p-6 border border-gray-200 dark:border-gray-700 space-y-4">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Create New Sub-Event</h2>
            <form onSubmit={handleCreateSubEvent} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Title *</label>
                <input
                  type="text"
                  required
                  value={newSubEvent.title}
                  onChange={(e) => setNewSubEvent({ ...newSubEvent, title: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
                  placeholder="e.g. Rehearsal Dinner"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Location Name</label>
                <input
                  type="text"
                  value={newSubEvent.locationName}
                  onChange={(e) => setNewSubEvent({ ...newSubEvent, locationName: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
                  placeholder="e.g. The Grand Ballroom"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Category</label>
                <input
                  type="text"
                  value={newSubEvent.category}
                  onChange={(e) => setNewSubEvent({ ...newSubEvent, category: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
                  placeholder="e.g. Dining"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
                <textarea
                  value={newSubEvent.description}
                  onChange={(e) => setNewSubEvent({ ...newSubEvent, description: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
                  rows={2}
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="subevent-private"
                  checked={newSubEvent.isPrivate}
                  onChange={(e) => setNewSubEvent({ ...newSubEvent, isPrivate: e.target.checked })}
                  className="rounded border-gray-300 text-primary focus:ring-primary h-4 w-4"
                />
                <label htmlFor="subevent-private" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Private Sub-Event (requires explicit access assignment)
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" type="button" onClick={() => setIsModalOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">Create Sub-Event</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
