'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { useToast } from '@/components/ui/ToastProvider';
import { useAdminRegistry } from '@/hooks/admin/useAdminRegistry';
import { useRegistryCapabilities } from '@/features/registry';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { useFocusSuccessor } from '@/hooks/useFocusSuccessor';
import { formatCurrency, formatDate } from '@/utils/intl';

function mergeRefs<T>(...refs: Array<React.Ref<T> | undefined>): React.RefCallback<T> {
  return (node: T | null) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === 'function') {
        ref(node);
      } else {
        (ref as React.MutableRefObject<T | null>).current = node;
      }
    }
  };
}

const ContributionsList = ({
  contributors,
}: {
  contributors?: {
    name: string;
    amount: number;
    date: string;
    stripeChargeId?: string | null;
    stripePaymentIntentId?: string | null;
    transactionTimestamp?: string | null;
  }[];
}) => {
  if (!contributors || contributors.length === 0) {
    return <span className="text-gray-500 dark:text-gray-400">None</span>;
  }
  return (
    <ul className="text-xs space-y-1.5">
      {contributors.map((c, idx) => {
        const transactionRef = c.stripeChargeId || c.stripePaymentIntentId;
        return (
          <li key={idx} className="flex flex-col">
            <span>
              {c.name} - {formatCurrency(c.amount)} on {formatDate(c.date)}
            </span>
            {transactionRef && (
              <span
                data-testid={`verified-transaction-${idx}`}
                className="inline-flex items-center gap-1 text-[11px] font-mono text-emerald-700 dark:text-emerald-400 font-medium"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" aria-hidden="true" />
                Verified Ref: {transactionRef}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
};

/**
 * @page AdminRegistryPage
 * @description Dedicated admin view for managing wedding gift registry items, priority ordering,
 * checkout capability warnings, and contribution records under `/admin/dashboard/registry`.
 */
export default function AdminRegistryPage() {
  const router = useRouter();
  const {
    data: items,
    isLoading,
    error,
    remove,
    reorderItems,
    toggleMostWanted,
  } = useAdminRegistry();
  const { addToast, confirm } = useToast();
  const [announcement, setAnnouncement] = useState<string>('');

  const safeItems = Array.isArray(items) ? items : [];
  const mostWantedItems = safeItems.filter((item) => Boolean(item.isMostWanted));
  const standardItems = safeItems.filter((item) => !item.isMostWanted);
  const orderedItems = [...mostWantedItems, ...standardItems];

  const hasFundWithoutHandle = safeItems.some(
    (item) =>
      !item.isSample &&
      !item.purchased &&
      (item.itemType === 'CASH_FUND' || item.itemType === 'EXPERIENCE_FUND') &&
      !(item.paymentHandle && item.paymentHandle.trim())
  );
  const { cardCheckoutEnabled, isCapabilitiesLoading } = useRegistryCapabilities({
    enabled: !isLoading && !error && hasFundWithoutHandle,
  });
  const isUnconfiguredFundItem = (item: (typeof safeItems)[number]) =>
    !isCapabilitiesLoading &&
    !cardCheckoutEnabled &&
    !item.isSample &&
    !item.purchased &&
    (item.itemType === 'CASH_FUND' || item.itemType === 'EXPERIENCE_FUND') &&
    !(item.paymentHandle && item.paymentHandle.trim());
  const unconfiguredFunds = safeItems.filter(isUnconfiguredFundItem);

  const { containerRef: desktopContainerRef, captureFocusTarget: captureDesktopFocus } = useFocusSuccessor<HTMLTableSectionElement>();
  const { containerRef: mobileContainerRef, captureFocusTarget: captureMobileFocus } = useFocusSuccessor<HTMLDivElement>();

  const handleMoveItem = async (index: number, direction: 'up' | 'down') => {
    const currentItem = orderedItems[index];
    if (!currentItem) return;

    const isPriority = Boolean(currentItem.isMostWanted);
    const groupStart = isPriority ? 0 : mostWantedItems.length;
    const groupLength = isPriority ? mostWantedItems.length : standardItems.length;
    const groupIndex = index - groupStart;
    const targetGroupIndex = direction === 'up' ? groupIndex - 1 : groupIndex + 1;

    if (targetGroupIndex < 0 || targetGroupIndex >= groupLength) return;

    const targetIndex = groupStart + targetGroupIndex;
    const nextItems = Array.from(orderedItems);
    const [movedItem] = nextItems.splice(index, 1);
    nextItems.splice(targetIndex, 0, movedItem);

    const itemLabel = movedItem.name || movedItem.id;
    setAnnouncement(
      `Moved ${itemLabel} ${direction} to position ${targetGroupIndex + 1} of ${groupLength}`
    );

    try {
      await reorderItems(nextItems.map((entry) => entry.id));
    } catch {
      // Rollback and error feedback are handled by useAdminRegistry hook
    }
  };

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination) return;

    const sourceIndex = result.source.index;
    const destinationIndex = result.destination.index;

    if (sourceIndex === destinationIndex) return;

    const draggedItem = orderedItems[sourceIndex];
    const destinationSlotItem = orderedItems[destinationIndex];
    if (!draggedItem || !destinationSlotItem) return;

    const isPriority = Boolean(draggedItem.isMostWanted);
    if (Boolean(destinationSlotItem.isMostWanted) !== isPriority) {
      return;
    }

    const groupStart = isPriority ? 0 : mostWantedItems.length;
    const groupLength = isPriority ? mostWantedItems.length : standardItems.length;
    const targetGroupIndex = destinationIndex - groupStart;

    const nextItems = Array.from(orderedItems);
    const [movedItem] = nextItems.splice(sourceIndex, 1);
    nextItems.splice(destinationIndex, 0, movedItem);

    const itemLabel = movedItem.name || movedItem.id;
    setAnnouncement(
      `Moved ${itemLabel} to position ${targetGroupIndex + 1} of ${groupLength}`
    );

    try {
      await reorderItems(nextItems.map((entry) => entry.id));
    } catch {
      // Rollback and error feedback are handled by useAdminRegistry hook
    }
  };

  const handleTogglePriority = async (item: (typeof orderedItems)[number]) => {
    const nextMostWanted = !item.isMostWanted;
    const itemLabel = item.name || item.id;
    setAnnouncement(
      nextMostWanted
        ? `Marked ${itemLabel} as Most Wanted`
        : `Removed Most Wanted from ${itemLabel}`
    );

    try {
      await toggleMostWanted(item.id, nextMostWanted);
    } catch {
      // Rollback and error feedback are handled by useAdminRegistry hook
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh]">
        <h1 className="text-3xl font-bold mb-4 text-primary">Gift Registry</h1>
        <p className="text-lg text-gray-500 dark:text-gray-400">Loading items...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh]">
        <h1 className="text-3xl font-bold mb-4 text-primary">Gift Registry</h1>
        <p className="text-red-500 text-lg">Error: {error.message}</p>
      </div>
    );
  }

  return (
    <div className="py-10">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-wrap justify-between items-center gap-4 mb-8">
          <div>
            <h1 className="text-4xl font-extrabold text-primary tracking-tight drop-shadow-lg">
              Gift Registry
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Manage gifts, cash funds, priority ordering, and verified guest contributions.
            </p>
          </div>
          <Button onClick={() => router.push('/registry/add-item')}>
            Add New Item
          </Button>
        </div>

        <div
          aria-live="polite"
          className="sr-only"
          role="status"
          data-testid="registry-live-announcement"
        >
          {announcement}
        </div>

        {unconfiguredFunds.length > 0 && (
          <div
            role="alert"
            data-testid="admin-dashboard-unconfigured-funds-warning"
            className="mb-6 p-4 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100 text-sm"
          >
            <p className="font-bold mb-1">
              Action Required: {unconfiguredFunds.length}{' '}
              {unconfiguredFunds.length === 1 ? 'fund has' : 'funds have'} checkout disabled
            </p>
            <p className="text-xs leading-relaxed">
              Online card processing is not configured (Stripe publishable and secret keys are missing), and the following{' '}
              {unconfiguredFunds.length === 1 ? 'fund does' : 'funds do'} not have a direct transfer handle:{' '}
              <span className="font-semibold">{unconfiguredFunds.map((f) => f.name).join(', ')}</span>. Edit{' '}
              {unconfiguredFunds.length === 1 ? 'this item' : 'these items'} to add a payment handle or configure Stripe credentials.
            </p>
          </div>
        )}

        {/* Responsive Table for Desktop, Cards for Mobile */}
        <div className="hidden md:block">
          <div className="overflow-x-auto rounded-xl shadow-lg bg-white dark:bg-gray-800 border border-primary dark:border-gray-700">
            <DragDropContext onDragEnd={handleDragEnd}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Claimed/Funded</TableHead>
                    <TableHead>Contributions</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <Droppable droppableId="desktop-registry-items">
                  {(droppableProvided) => (
                    <TableBody
                      ref={mergeRefs(desktopContainerRef, droppableProvided.innerRef)}
                      {...droppableProvided.droppableProps}
                    >
                      {orderedItems.map((item, index) => {
                        const isPriority = Boolean(item.isMostWanted);
                        const groupItems = isPriority ? mostWantedItems : standardItems;
                        const groupIndex = isPriority ? index : index - mostWantedItems.length;
                        const itemLabel = item.name || item.id;

                        return (
                          <Draggable key={item.id} draggableId={item.id} index={index}>
                            {(draggableProvided) => (
                              <TableRow
                                ref={draggableProvided.innerRef}
                                {...draggableProvided.draggableProps}
                              >
                                <TableCell>
                                  <div className="flex items-center gap-1">
                                    <div
                                      {...draggableProvided.dragHandleProps}
                                      aria-label={`Reorder ${itemLabel}`}
                                      className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 cursor-grab active:cursor-grabbing focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded p-1 transition-colors"
                                    >
                                      <Icon name="DragHandle" className="h-5 w-5" />
                                    </div>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      aria-label={`Move ${itemLabel} up`}
                                      disabled={groupIndex === 0}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void handleMoveItem(index, 'up');
                                      }}
                                    >
                                      <Icon name="ArrowUp" className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      aria-label={`Move ${itemLabel} down`}
                                      disabled={groupIndex === groupItems.length - 1}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void handleMoveItem(index, 'down');
                                      }}
                                    >
                                      <Icon name="ArrowDown" className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </TableCell>
                                <TableCell className="font-semibold">
                                  {item.name}
                                  {item.isSample && (
                                    <span className="ml-2 inline-flex items-center text-xs font-medium px-2 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200 border border-amber-300 dark:border-amber-700">
                                      Sample
                                    </span>
                                  )}
                                  {isUnconfiguredFundItem(item) && (
                                    <span
                                      data-testid={`unconfigured-fund-badge-${item.id}`}
                                      className="ml-2 inline-flex items-center text-xs font-medium px-2 py-0.5 rounded bg-red-100 text-red-800 dark:bg-red-950/70 dark:text-red-200 border border-red-300 dark:border-red-700"
                                    >
                                      Checkout Disabled
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    pressed={Boolean(item.isMostWanted)}
                                    aria-label={item.name ? `Most Wanted: ${item.name}` : 'Most Wanted: unnamed item'}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void handleTogglePriority(item);
                                    }}
                                    className={
                                      item.isMostWanted
                                        ? 'bg-amber-100 text-amber-900 border-amber-400 hover:bg-amber-200 dark:bg-amber-900/50 dark:text-amber-200 dark:border-amber-600'
                                        : ''
                                    }
                                  >
                                    <Icon
                                      name="Star"
                                      className={item.isMostWanted ? 'h-4 w-4 fill-current mr-1' : 'h-4 w-4 mr-1'}
                                    />
                                    Most Wanted
                                  </Button>
                                </TableCell>
                                <TableCell>{formatCurrency(item.price)}</TableCell>
                                <TableCell>{item.purchased ? 'Yes' : 'No'}</TableCell>
                                <TableCell>
                                  <ContributionsList contributors={item.contributors} />
                                </TableCell>
                                <TableCell className="space-x-2">
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    aria-label={item.name ? 'Edit registry item: ' + item.name : 'Edit unnamed item'}
                                    onClick={() => router.push(`/registry/edit-item/${item.id}`)}
                                  >
                                    Edit
                                  </Button>
                                  <Button
                                    variant="danger"
                                    size="sm"
                                    aria-label={item.name ? 'Delete registry item: ' + item.name : 'Delete unnamed item'}
                                    onClick={async (e) => {
                                      const row = e.currentTarget.closest('tr');
                                      if (!(await confirm('Are you sure you want to delete this item?'))) return;

                                      if (row) {
                                        captureDesktopFocus(row as HTMLElement);
                                      }

                                      try {
                                        await remove(item.id);
                                        addToast('Item deleted successfully.', 'success');
                                      } catch {
                                        // Error is handled by useAdminRegistry hook
                                      }
                                    }}
                                  >
                                    Delete
                                  </Button>
                                </TableCell>
                              </TableRow>
                            )}
                          </Draggable>
                        );
                      })}
                      {droppableProvided.placeholder}
                    </TableBody>
                  )}
                </Droppable>
              </Table>
            </DragDropContext>
          </div>
        </div>

        {/* Card Layout for Mobile */}
        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="mobile-registry-items">
            {(droppableProvided) => (
              <div
                className="md:hidden space-y-6"
                ref={mergeRefs(mobileContainerRef, droppableProvided.innerRef)}
                {...droppableProvided.droppableProps}
              >
                {orderedItems.map((item, index) => {
                  const isPriority = Boolean(item.isMostWanted);
                  const groupItems = isPriority ? mostWantedItems : standardItems;
                  const groupIndex = isPriority ? index : index - mostWantedItems.length;
                  const itemLabel = item.name || item.id;

                  return (
                    <Draggable key={item.id} draggableId={item.id} index={index}>
                      {(draggableProvided) => (
                        <div
                          ref={draggableProvided.innerRef}
                          {...draggableProvided.draggableProps}
                          className="rounded-xl shadow-lg bg-white dark:bg-gray-800 p-4 flex flex-col gap-2 border border-primary dark:border-gray-700"
                        >
                          <div className="flex justify-between items-center mb-2 gap-2">
                            <div className="flex items-center gap-2">
                              <div
                                {...draggableProvided.dragHandleProps}
                                aria-label={`Reorder ${itemLabel}`}
                                className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 cursor-grab active:cursor-grabbing focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded p-1 transition-colors"
                              >
                                <Icon name="DragHandle" className="h-5 w-5" />
                              </div>
                              <span className="font-bold text-lg text-primary">{item.name}</span>
                            </div>
                            <span className="text-sm font-semibold">{formatCurrency(item.price)}</span>
                          </div>
                          <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                            <div className="flex flex-wrap gap-2 text-xs">
                              {item.isSample && (
                                <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200 border border-amber-300 dark:border-amber-700 font-medium">Sample</span>
                              )}
                              {isUnconfiguredFundItem(item) && (
                                <span className="px-2 py-1 rounded-full bg-red-100 text-red-800 dark:bg-red-950/70 dark:text-red-200 border border-red-300 dark:border-red-700 font-medium">
                                  Checkout Disabled
                                </span>
                              )}
                              <span className={`px-2 py-1 rounded-full ${item.purchased ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>{item.purchased ? 'Claimed' : 'Available'}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                pressed={Boolean(item.isMostWanted)}
                                aria-label={item.name ? `Most Wanted: ${item.name}` : 'Most Wanted: unnamed item'}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleTogglePriority(item);
                                }}
                                className={
                                  item.isMostWanted
                                    ? 'bg-amber-100 text-amber-900 border-amber-400 hover:bg-amber-200 dark:bg-amber-900/50 dark:text-amber-200 dark:border-amber-600'
                                    : ''
                                }
                              >
                                <Icon
                                  name="Star"
                                  className={item.isMostWanted ? 'h-4 w-4 fill-current mr-1' : 'h-4 w-4 mr-1'}
                                />
                                Most Wanted
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                aria-label={`Move ${itemLabel} up`}
                                disabled={groupIndex === 0}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleMoveItem(index, 'up');
                                }}
                              >
                                <Icon name="ArrowUp" className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                aria-label={`Move ${itemLabel} down`}
                                disabled={groupIndex === groupItems.length - 1}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleMoveItem(index, 'down');
                                }}
                              >
                                <Icon name="ArrowDown" className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                          <div className="mb-2">
                            <span className="font-semibold">Contributions:</span>
                            <div className="ml-2 mt-1">
                              <ContributionsList contributors={item.contributors} />
                            </div>
                          </div>
                          <div className="flex gap-2 mt-2">
                            <Button
                              className="flex-1"
                              variant="secondary"
                              size="sm"
                              aria-label={item.name ? 'Edit registry item: ' + item.name : 'Edit unnamed item'}
                              onClick={() => router.push(`/registry/edit-item/${item.id}`)}
                            >
                              Edit
                            </Button>
                            <Button
                              className="flex-1"
                              variant="danger"
                              size="sm"
                              aria-label={item.name ? 'Delete registry item: ' + item.name : 'Delete unnamed item'}
                              onClick={async (e) => {
                                const card = e.currentTarget.closest('.rounded-xl');
                                if (!(await confirm('Are you sure you want to delete this item?'))) return;

                                if (card) {
                                  captureMobileFocus(card as HTMLElement);
                                }

                                try {
                                  await remove(item.id);
                                  addToast('Item deleted successfully.', 'success');
                                } catch {
                                  // Error is handled by useAdminRegistry hook
                                }
                              }}
                            >
                              Delete
                            </Button>
                          </div>
                        </div>
                      )}
                    </Draggable>
                  );
                })}
                {droppableProvided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      </div>
    </div>
  );
}
