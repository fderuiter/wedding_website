'use client';

import { useState, useEffect, useMemo, useCallback, useContext, useRef } from 'react';
import { QueryClient, QueryClientProvider, QueryClientContext } from '@tanstack/react-query';
import { useToast } from '@/components/ui/ToastProvider';
import { useTheme } from '@/components/ThemeProvider';
import { Button } from '@/components/ui/Button';
import { Table } from '@/components/ui/Table';
import { useAdminSubEvents } from '@/hooks/admin/useAdminSubEvents';
import {
  SubEventEditorModal,
  SubEventDeleteConfirmModal,
  type EditableSubEvent,
} from '@/components/admin/SubEventEditorModal';
import { formatSubEventSchedule } from '@/utils/dateTime';
import type {
  SubEventDTO,
  RsvpSummaryResponse,
  SubEventRsvpSummaryItem,
  AccessMatrixGuestEventRsvp,
} from '@/features/sub-events';
import { withBasePath } from '@/lib/basePath';

type SubEvent = EditableSubEvent;

interface InvitationCode {
  id: string;
  code: string;
  guestName: string;
  householdName?: string | null;
  partyGroup?: string | null;
  partyTags?: string[];
  allowedSubEventIds?: string[];
  eventRsvps?: Record<string, AccessMatrixGuestEventRsvp>;
}

interface MatrixFilterOptions {
  partyTags: string[];
  partyGroups: string[];
  householdNames: string[];
}

interface AccessMatrixQuery {
  page: number;
  limit: number;
  searchQuery: string;
  selectedTagFilter: string;
  selectedGroupFilter: string;
  selectedHouseholdFilter: string;
}

interface AccessMatrixSnapshot {
  subEvents: SubEvent[];
  invitationCodes: InvitationCode[];
  totalRecords: number;
  totalPages: number;
  filterOptions: MatrixFilterOptions;
  accessMatrix: Record<string, string[]>;
}

interface AccessMatrixSetters {
  setSubEvents: React.Dispatch<React.SetStateAction<SubEvent[]>>;
  setInvitationCodes: React.Dispatch<React.SetStateAction<InvitationCode[]>>;
  setTotalRecords: React.Dispatch<React.SetStateAction<number>>;
  setTotalPages: React.Dispatch<React.SetStateAction<number>>;
  setFilterOptions: React.Dispatch<React.SetStateAction<MatrixFilterOptions>>;
  setAccessMatrix: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
}

interface BatchSubEventAccessRequest {
  subEventIds: string[];
  action: 'grant' | 'revoke';
  invitationCodeIds?: string[];
  search?: string;
  partyTags?: string[];
  partyGroups?: string[];
  householdName?: string[];
}

function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const candidate = (err as { message?: unknown }).message;
    if (typeof candidate === 'string' && candidate) {
      return candidate;
    }
  }
  return fallback;
}

async function requestAccessMatrix(query: AccessMatrixQuery): Promise<AccessMatrixSnapshot> {
  const params = new URLSearchParams();
  params.set('page', query.page.toString());
  params.set('limit', query.limit.toString());
  if (query.searchQuery.trim()) params.set('search', query.searchQuery.trim());
  if (query.selectedTagFilter !== 'all') params.set('partyTag', query.selectedTagFilter);
  if (query.selectedGroupFilter !== 'all') params.set('partyGroup', query.selectedGroupFilter);
  if (query.selectedHouseholdFilter !== 'all') params.set('householdName', query.selectedHouseholdFilter);

  const res = await fetch(withBasePath(`/api/admin/sub-events/access?${params.toString()}`));
  if (!res.ok) throw new Error('Failed to load access matrix');
  const json = await res.json();
  const data = json.data || json;

  const events: SubEvent[] = data.subEvents || [];
  const codes: InvitationCode[] = data.invitationCodes || [];
  const pagination = data.pagination || {
    total: codes.length,
    page: query.page,
    limit: query.limit,
    totalPages: 1,
  };
  const opts: MatrixFilterOptions = data.filterOptions || {
    partyTags: [],
    partyGroups: [],
    householdNames: [],
  };

  const matrixMap: Record<string, string[]> = {};
  codes.forEach((c) => {
    matrixMap[c.id] = c.allowedSubEventIds || [];
  });

  return {
    subEvents: events,
    invitationCodes: codes,
    totalRecords: pagination.total ?? codes.length,
    totalPages: pagination.totalPages ?? 1,
    filterOptions: opts,
    accessMatrix: matrixMap,
  };
}

function applyAccessMatrixSnapshot(
  snapshot: AccessMatrixSnapshot,
  setters: AccessMatrixSetters
): void {
  setters.setSubEvents(snapshot.subEvents);
  setters.setInvitationCodes(snapshot.invitationCodes);
  setters.setTotalRecords(snapshot.totalRecords);
  setters.setTotalPages(snapshot.totalPages);
  setters.setFilterOptions(snapshot.filterOptions);
  setters.setAccessMatrix(snapshot.accessMatrix);
}

function notifyAccessMatrixError(
  err: unknown,
  addToast: ReturnType<typeof useToast>['addToast']
): void {
  let message = 'Error fetching access matrix';
  if (err instanceof Error && err.message) {
    message = err.message;
  } else if (typeof err === 'object' && err !== null && 'message' in err) {
    const candidate = (err as { message?: unknown }).message;
    if (typeof candidate === 'string' && candidate) {
      message = candidate;
    }
  }
  addToast(message, 'error');
}

function sortSubEventsBySchedule(events: SubEvent[]): SubEvent[] {
  return [...events].sort((a, b) => {
    const aTime = a.startTime ? new Date(a.startTime).getTime() : NaN;
    const bTime = b.startTime ? new Date(b.startTime).getTime() : NaN;
    const aValid = !Number.isNaN(aTime);
    const bValid = !Number.isNaN(bTime);
    if (aValid && bValid) return aTime - bTime;
    if (aValid && !bValid) return -1;
    if (!aValid && bValid) return 1;
    return 0;
  });
}

async function requestSubEventsRsvpSummary(): Promise<Record<string, SubEventRsvpSummaryItem> | null> {
  try {
    const res = await fetch(withBasePath('/api/admin/sub-events/rsvp-summary'));
    if (!res || !res.ok) return null;
    const json = await res.json();
    const payload: RsvpSummaryResponse | undefined = json?.data ?? json;
    if (!payload || !Array.isArray(payload.subEvents)) return null;
    const byId: Record<string, SubEventRsvpSummaryItem> = {};
    for (const item of payload.subEvents) {
      if (item && item.subEventId) {
        byId[item.subEventId] = item;
      }
    }
    return byId;
  } catch {
    return null;
  }
}

async function executeAccessMatrixFetch(params: {
  query: AccessMatrixQuery;
  setters: AccessMatrixSetters;
  setRsvpSummaryByEvent: React.Dispatch<
    React.SetStateAction<Record<string, SubEventRsvpSummaryItem>>
  >;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  addToast: ReturnType<typeof useToast>['addToast'];
  isCancelled?: () => boolean;
}): Promise<void> {
  const { query, setters, setRsvpSummaryByEvent, setIsLoading, addToast, isCancelled } = params;
  try {
    const [snapshot, summaryMap] = await Promise.all([
      requestAccessMatrix(query),
      requestSubEventsRsvpSummary(),
    ]);
    if (isCancelled?.()) return;
    applyAccessMatrixSnapshot(snapshot, setters);
    if (summaryMap) {
      setRsvpSummaryByEvent(summaryMap);
    }
  } catch (err: unknown) {
    if (!isCancelled?.()) {
      notifyAccessMatrixError(err, addToast);
    }
  } finally {
    if (!isCancelled?.()) {
      setIsLoading(false);
    }
  }
}

const SEARCH_DEBOUNCE_MS = 250;

function SubEventsMatrixPageContent() {
  const { addToast } = useToast();
  const { timezone } = useTheme();
  const effectiveTimezone = timezone || undefined;
  const {
    create: createSubEvent,
    update: updateSubEvent,
    remove: removeSubEvent,
  } = useAdminSubEvents({ enabled: false });
  const [subEvents, setSubEvents] = useState<SubEvent[]>([]);
  const [invitationCodes, setInvitationCodes] = useState<InvitationCode[]>([]);
  const [accessMatrix, setAccessMatrix] = useState<Record<string, string[]>>({});
  const [rsvpSummaryByEvent, setRsvpSummaryByEvent] = useState<Record<string, SubEventRsvpSummaryItem>>({});
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState<string>('');
  const [selectedTagFilter, setSelectedTagFilter] = useState<string>('all');
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<string>('all');
  const [selectedHouseholdFilter, setSelectedHouseholdFilter] = useState<string>('all');

  // Pagination
  const [pageSize, setPageSize] = useState<number>(25);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalRecords, setTotalRecords] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);

  // Available Filter Options
  const [filterOptions, setFilterOptions] = useState<MatrixFilterOptions>({
    partyTags: [],
    partyGroups: [],
    householdNames: [],
  });

  // Multi-row selection
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);

  // Create / Edit / Delete Sub-Event Modals
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingSubEvent, setEditingSubEvent] = useState<SubEvent | null>(null);
  const [deletingSubEvent, setDeletingSubEvent] = useState<SubEvent | null>(null);

  const latestRequestIdRef = useRef<number>(0);

  const refreshRsvpSummary = useCallback(async () => {
    const summaryMap = await requestSubEventsRsvpSummary();
    if (summaryMap) {
      setRsvpSummaryByEvent(summaryMap);
    }
  }, []);

  useEffect(() => {
    if (searchQuery === debouncedSearchQuery) {
      return;
    }
    const timer = setTimeout(() => {
      setIsLoading(true);
      setDebouncedSearchQuery(searchQuery);
      setCurrentPage(1);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [searchQuery, debouncedSearchQuery]);

  const matrixSetters = useMemo<AccessMatrixSetters>(
    () => ({
      setSubEvents,
      setInvitationCodes,
      setTotalRecords,
      setTotalPages,
      setFilterOptions,
      setAccessMatrix,
    }),
    []
  );

  const fetchMatrix = useCallback(
    async (overrides?: Partial<AccessMatrixQuery>) => {
      const requestId = ++latestRequestIdRef.current;
      setIsLoading(true);
      await executeAccessMatrixFetch({
        query: {
          page: overrides?.page ?? currentPage,
          limit: overrides?.limit ?? pageSize,
          searchQuery: overrides?.searchQuery ?? debouncedSearchQuery,
          selectedTagFilter: overrides?.selectedTagFilter ?? selectedTagFilter,
          selectedGroupFilter: overrides?.selectedGroupFilter ?? selectedGroupFilter,
          selectedHouseholdFilter: overrides?.selectedHouseholdFilter ?? selectedHouseholdFilter,
        },
        setters: matrixSetters,
        setRsvpSummaryByEvent,
        setIsLoading,
        addToast,
        isCancelled: () => latestRequestIdRef.current !== requestId,
      });
    },
    [
      currentPage,
      pageSize,
      debouncedSearchQuery,
      selectedTagFilter,
      selectedGroupFilter,
      selectedHouseholdFilter,
      matrixSetters,
      addToast,
    ]
  );

  // Fetch matrix when page, debounced search, filters, or pageSize change
  useEffect(() => {
    const requestId = ++latestRequestIdRef.current;
    void executeAccessMatrixFetch({
      query: {
        page: currentPage,
        limit: pageSize,
        searchQuery: debouncedSearchQuery,
        selectedTagFilter,
        selectedGroupFilter,
        selectedHouseholdFilter,
      },
      setters: matrixSetters,
      setRsvpSummaryByEvent,
      setIsLoading,
      addToast,
      isCancelled: () => latestRequestIdRef.current !== requestId,
    });

    return () => {
      latestRequestIdRef.current += 1;
    };
  }, [
    currentPage,
    pageSize,
    debouncedSearchQuery,
    selectedTagFilter,
    selectedGroupFilter,
    selectedHouseholdFilter,
    matrixSetters,
    addToast,
  ]);

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
      const res = await fetch(withBasePath('/api/admin/sub-events/access'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invitationCodeId, allowedSubEventIds: updated }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to update access');
      }
      addToast('Sub-event access updated.', 'success');
      void refreshRsvpSummary();
    } catch (e: unknown) {
      setAccessMatrix(previousMatrix);
      addToast(getErrorMessage(e, 'Failed to update access. Reverted changes.'), 'error');
    }
  };

  // Bulk Column Toggle (for all currently filtered guests)
  const handleColumnToggle = async (subEventId: string, action: 'grant' | 'revoke') => {
    const body: BatchSubEventAccessRequest = {
      subEventIds: [subEventId],
      action,
    };

    if (searchQuery.trim()) body.search = searchQuery.trim();
    if (selectedTagFilter !== 'all') body.partyTags = [selectedTagFilter];
    if (selectedGroupFilter !== 'all') body.partyGroups = [selectedGroupFilter];
    if (selectedHouseholdFilter !== 'all') body.householdName = [selectedHouseholdFilter];

    try {
      const res = await fetch(withBasePath('/api/admin/sub-events/access/batch'), {
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
      if (debouncedSearchQuery !== searchQuery) {
        setIsLoading(true);
        setDebouncedSearchQuery(searchQuery);
        setCurrentPage(1);
      } else {
        void fetchMatrix({ searchQuery });
      }
    } catch (e: unknown) {
      addToast(getErrorMessage(e, 'Batch update failed.'), 'error');
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
      const res = await fetch(withBasePath('/api/admin/sub-events/access/batch'), {
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
    } catch (e: unknown) {
      setAccessMatrix(previousMatrix);
      addToast(getErrorMessage(e, 'Failed to update row access. Reverted changes.'), 'error');
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
      const res = await fetch(withBasePath('/api/admin/sub-events/access/batch'), {
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
    } catch (e: unknown) {
      setAccessMatrix(previousMatrix);
      addToast(getErrorMessage(e, 'Batch update failed. Reverted changes.'), 'error');
    }
  };

  // Create or Update Sub-Event
  const handleSaveSubEvent = async (payload: Partial<SubEventDTO>, editingId?: string) => {
    try {
      if (editingId) {
        const updated = await updateSubEvent(editingId, payload);
        await fetchMatrix();
        setSubEvents((prev) =>
          sortSubEventsBySchedule(
            prev.map((evt) =>
              evt.id === editingId
                ? {
                  ...evt,
                  ...payload,
                  ...(updated || {}),
                }
                : evt
            )
          )
        );
        setEditingSubEvent(null);
        addToast('Sub-event updated successfully.', 'success');
      } else {
        const created = await createSubEvent(payload);
        addToast('Sub-event created successfully!', 'success');
        await fetchMatrix();
        if (created && created.id) {
          setSubEvents((prev) =>
            prev.some((evt) => evt.id === created.id)
              ? prev
              : sortSubEventsBySchedule([
                ...prev,
                {
                  ...payload,
                  ...created,
                  isPrivate: Boolean(created.isPrivate ?? payload.isPrivate),
                } as SubEvent,
              ])
          );
        }
      }
    } catch (err: unknown) {
      addToast(
        err instanceof Error && err.message
          ? err.message
          : editingId
            ? 'Error updating sub-event'
            : 'Error creating sub-event',
        'error'
      );
      throw err;
    }
  };

  // Delete Sub-Event after confirmation
  const handleConfirmDeleteSubEvent = async (target: SubEvent) => {
    try {
      await removeSubEvent(target.id);
      await fetchMatrix();
      setSubEvents((prev) => prev.filter((evt) => evt.id !== target.id));
      setAccessMatrix((prev) => {
        const next: Record<string, string[]> = {};
        Object.entries(prev).forEach(([invId, ids]) => {
          next[invId] = ids.filter((id) => id !== target.id);
        });
        return next;
      });
      if (editingSubEvent?.id === target.id) {
        setEditingSubEvent(null);
      }
      addToast('Sub-event deleted successfully.', 'success');
    } catch (err: unknown) {
      addToast(
        err instanceof Error && err.message ? err.message : 'Error deleting sub-event',
        'error'
      );
      throw err;
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
        <Button onClick={() => {
          setEditingSubEvent(null);
          setIsModalOpen(true);
        }}>
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
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSelectedRowIds([]);
              }}
              className="w-full px-3 py-2 border rounded-lg text-sm bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-600 focus:ring-primary focus:border-primary text-gray-900 dark:text-white"
            />
          </div>

          {/* Party Tag Filter */}
          <div>
            <select
              aria-label="Filter by Party Tag"
              value={selectedTagFilter}
              onChange={(e) => {
                setSelectedTagFilter(e.target.value);
                setDebouncedSearchQuery(searchQuery);
                setCurrentPage(1);
                setSelectedRowIds([]);
                setIsLoading(true);
              }}
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
              onChange={(e) => {
                setSelectedGroupFilter(e.target.value);
                setDebouncedSearchQuery(searchQuery);
                setCurrentPage(1);
                setSelectedRowIds([]);
                setIsLoading(true);
              }}
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
              onChange={(e) => {
                setSelectedHouseholdFilter(e.target.value);
                setDebouncedSearchQuery(searchQuery);
                setCurrentPage(1);
                setSelectedRowIds([]);
                setIsLoading(true);
              }}
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
                const willTriggerEffectFetch =
                  debouncedSearchQuery !== '' ||
                  selectedTagFilter !== 'all' ||
                  selectedGroupFilter !== 'all' ||
                  selectedHouseholdFilter !== 'all' ||
                  currentPage !== 1;

                setSearchQuery('');
                setDebouncedSearchQuery('');
                setSelectedTagFilter('all');
                setSelectedGroupFilter('all');
                setSelectedHouseholdFilter('all');
                setCurrentPage(1);
                setSelectedRowIds([]);

                if (willTriggerEffectFetch) {
                  setIsLoading(true);
                } else {
                  void fetchMatrix({
                    page: 1,
                    searchQuery: '',
                    selectedTagFilter: 'all',
                    selectedGroupFilter: 'all',
                    selectedHouseholdFilter: 'all',
                  });
                }
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
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setDebouncedSearchQuery(searchQuery);
              setCurrentPage(1);
              setSelectedRowIds([]);
              setIsLoading(true);
            }}
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
            No sub-events created yet. Click &quot;+ Create New Sub-Event&quot; to get started.
          </div>
        ) : (
          <Table
            containerAriaLabel="Sub-events access matrix"
            containerClassName="focus-visible:ring-inset"
            className="text-left border-collapse"
          >
            <thead>
              <tr className="bg-gray-100 dark:bg-gray-700/60 border-b border-gray-200 dark:border-gray-700">
                {/* Select All Checkbox */}
                <th scope="col" className="p-3 w-10 text-center">
                  <input
                    type="checkbox"
                    aria-label="Select all page guests"
                    checked={isAllPaginatedSelected}
                    onChange={(e) => handleToggleSelectAllPaginated(e.target.checked)}
                    className="rounded border-gray-300 text-primary focus:ring-primary h-4 w-4"
                  />
                </th>

                {/* Guest Header */}
                <th scope="col" className="p-3 font-semibold text-gray-900 dark:text-white min-w-[220px]">
                  Guest / Code Details
                </th>

                {/* Sub-Events Column Headers */}
                {subEvents.map((evt) => {
                  const scheduleLabel = formatSubEventSchedule(
                    evt.startTime,
                    evt.endTime,
                    effectiveTimezone
                  );
                  const eventSummary = rsvpSummaryByEvent[evt.id];
                  return (
                    <th key={evt.id} scope="col" className="p-3 font-semibold text-gray-900 dark:text-white min-w-[220px] border-l border-gray-200 dark:border-gray-700 align-top">
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

                        {scheduleLabel && (
                          <span
                            className="text-[11px] font-normal text-gray-500 dark:text-gray-400"
                            data-testid={`sub-event-schedule-${evt.id}`}
                          >
                            {scheduleLabel}
                          </span>
                        )}

                        {eventSummary && (
                          <div
                            className="flex flex-wrap gap-1 mt-1"
                            data-testid={`sub-event-rsvp-badges-${evt.id}`}
                          >
                            <span
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-700"
                              title={
                                eventSummary.attendingPlusOnes > 0
                                  ? `${eventSummary.attendingCount} household(s) + ${eventSummary.attendingPlusOnes} plus-one(s)`
                                  : `${eventSummary.attendingCount} attending`
                              }
                            >
                              Attending: {eventSummary.attendingHeadcount}
                            </span>
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200 border border-rose-300 dark:border-rose-700">
                              Declined: {eventSummary.declinedCount}
                            </span>
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-600">
                              Pending: {eventSummary.pendingCount}
                            </span>
                            {eventSummary.mealCounts.map((meal) => (
                              <span
                                key={meal.optionId}
                                data-testid={`sub-event-meal-badge-${evt.id}-${meal.optionId}`}
                                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200 border border-amber-200 dark:border-amber-800"
                              >
                                {meal.label}: {meal.count}
                              </span>
                            ))}
                          </div>
                        )}

                        <div className="flex items-center gap-2 text-xs font-normal mt-0.5">
                          <button
                            type="button"
                            aria-label={`Edit sub-event ${evt.title}`}
                            onClick={() => {
                              setEditingSubEvent(evt);
                              setIsModalOpen(true);
                            }}
                            className="text-gray-600 dark:text-gray-300 hover:text-primary dark:hover:text-red-300 hover:underline font-medium"
                          >
                            Edit
                          </button>
                          <span className="text-gray-300 dark:text-gray-600">|</span>
                          <button
                            type="button"
                            aria-label={`Delete sub-event ${evt.title}`}
                            onClick={() => setDeletingSubEvent(evt)}
                            className="text-red-600 dark:text-red-400 hover:underline font-medium"
                          >
                            Delete
                          </button>
                        </div>

                        {evt.isPrivate ? (
                          <div className="flex items-center gap-2 text-xs font-normal text-gray-500 dark:text-gray-400 mt-0.5">
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
                          <span className="text-[11px] text-gray-400 dark:text-gray-500 italic mt-0.5">
                            Accessible to all guests
                          </span>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {paginatedCodes.length === 0 ? (
                <tr>
                  <td
                    colSpan={2 + subEvents.length}
                    className="p-12 text-center text-gray-500 dark:text-gray-400"
                  >
                    No invitation codes match your filter criteria.
                  </td>
                </tr>
              ) : paginatedCodes.map((code) => {
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
                      const guestEventRsvp = code.eventRsvps?.[evt.id];
                      const rsvpStatusBadgeClasses =
                        guestEventRsvp?.status === 'attending'
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-800'
                          : guestEventRsvp?.status === 'declined'
                            ? 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/50 dark:text-rose-200 dark:border-rose-800'
                            : 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-800';
                      const rsvpDetailsBlock = guestEventRsvp ? (
                        <div
                          className="mt-1.5 space-y-1 text-left text-[11px]"
                          data-testid={`matrix-cell-rsvp-${code.id}-${evt.id}`}
                        >
                          <div className="flex flex-wrap items-center justify-center gap-1">
                            <span
                              className={`inline-flex items-center px-1.5 py-0.5 rounded font-semibold border ${rsvpStatusBadgeClasses}`}
                            >
                              {guestEventRsvp.status.charAt(0).toUpperCase() +
                                guestEventRsvp.status.slice(1)}
                              {guestEventRsvp.status === 'attending' &&
                              guestEventRsvp.plusOneCount > 0
                                ? ` (+${guestEventRsvp.plusOneCount})`
                                : ''}
                            </span>
                          </div>
                          {guestEventRsvp.plusOneNames.length > 0 && (
                            <div className="text-gray-600 dark:text-gray-300 text-center">
                              +1: {guestEventRsvp.plusOneNames.join(', ')}
                            </div>
                          )}
                          {guestEventRsvp.meals.length > 0 && (
                            <div className="text-indigo-800 dark:text-indigo-200 bg-indigo-50/70 dark:bg-indigo-950/40 px-1.5 py-0.5 rounded border border-indigo-200 dark:border-indigo-800/60">
                              {guestEventRsvp.meals
                                .map((sel) => {
                                  const tags =
                                    sel.dietaryTags.length > 0
                                      ? ` (${sel.dietaryTags.join(', ')})`
                                      : '';
                                  return `${sel.attendee}: ${sel.label}${tags}`;
                                })
                                .join('; ')}
                            </div>
                          )}
                          {guestEventRsvp.answers.length > 0 && (
                            <div className="text-sky-800 dark:text-sky-200 bg-sky-50/70 dark:bg-sky-950/40 px-1.5 py-0.5 rounded border border-sky-200 dark:border-sky-800/60">
                              {guestEventRsvp.answers
                                .map((ans) => `${ans.prompt}: ${ans.answer}`)
                                .join('; ')}
                            </div>
                          )}
                          {guestEventRsvp.dietaryNotes && (
                            <div className="text-amber-800 dark:text-amber-200 bg-amber-50/70 dark:bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-800/60">
                              Dietary: {guestEventRsvp.dietaryNotes}
                            </div>
                          )}
                        </div>
                      ) : null;

                      if (!evt.isPrivate) {
                        return (
                          <td key={evt.id} className="p-3 border-l border-gray-200 dark:border-gray-700 text-center bg-gray-50/50 dark:bg-gray-800/50 align-middle">
                            <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400 font-medium">
                              ✓ Public
                            </span>
                            {rsvpDetailsBlock}
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
                          {rsvpDetailsBlock}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </Table>
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
                onClick={() => {
                  setIsLoading(true);
                  setCurrentPage((p) => Math.max(1, p - 1));
                }}
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
                onClick={() => {
                  setIsLoading(true);
                  setCurrentPage((p) => Math.min(totalPages, p + 1));
                }}
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

      <SubEventEditorModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingSubEvent(null);
        }}
        editingEvent={editingSubEvent}
        onSave={handleSaveSubEvent}
        timezone={effectiveTimezone}
        existingSubEvents={subEvents}
        onSelectEdit={(evt) => setEditingSubEvent(evt)}
        onRequestDelete={(evt) => setDeletingSubEvent(evt)}
      />

      <SubEventDeleteConfirmModal
        subEvent={deletingSubEvent}
        onClose={() => setDeletingSubEvent(null)}
        onConfirm={handleConfirmDeleteSubEvent}
      />
    </div>
  );
}

export default function SubEventsMatrixPage() {
  const existingQueryClient = useContext(QueryClientContext);
  const [fallbackQueryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      })
  );

  if (existingQueryClient) {
    return <SubEventsMatrixPageContent />;
  }

  return (
    <QueryClientProvider client={fallbackQueryClient}>
      <SubEventsMatrixPageContent />
    </QueryClientProvider>
  );
}
