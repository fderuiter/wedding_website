'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DraggableProvidedDragHandleProps,
  type DropResult,
} from '@hello-pangea/dnd';
import { useToast } from '@/components/ui/ToastProvider';
import { useAdminRegistry } from '@/hooks/admin/useAdminRegistry';
import {
  ContributorLifecycleBadge,
  useRegistryCapabilities,
  type ContributorStatus,
  type RegistryItem,
} from '@/features/registry';
import { Button } from '@/components/ui/Button';
import { Input, Label, Textarea, FormGroup } from '@/components/ui/forms';
import { Icon } from '@/components/ui/Icon';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { useFocusSuccessor } from '@/hooks/useFocusSuccessor';
import { formatCurrency, formatDate } from '@/utils/intl';

type RegistryLayoutVariant = 'desktop' | 'mobile';

interface PreparedRegistryItem {
  item: RegistryItem;
  index: number;
  isPriority: boolean;
  groupIndex: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  itemLabel: string;
  isUnconfiguredFund: boolean;
}

function mergeRefs<T>(...refs: Array<React.Ref<T> | undefined>): React.RefCallback<T> {
  return (node: T | null) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === 'function') {
        ref(node);
      } else {
        ref.current = node;
      }
    }
  };
}

type AdminContributorEntry = RegistryItem['contributors'][number];

const ContributionsList = ({
  contributors,
  onContributorAction,
  onEditContributor,
  onDeleteContributor,
  pendingContributorId,
}: {
  contributors?: AdminContributorEntry[];
  onContributorAction?: (
    contributorId: string,
    contributorName: string,
    action: 'confirm' | 'remind' | 'void'
  ) => Promise<void>;
  onEditContributor?: (contributor: AdminContributorEntry) => void;
  onDeleteContributor?: (contributor: AdminContributorEntry) => Promise<void>;
  pendingContributorId?: string | null;
}) => {
  if (!contributors || contributors.length === 0) {
    return <span className="text-gray-500 dark:text-gray-400">None</span>;
  }
  return (
    <ul className="text-xs space-y-2">
      {contributors.map((c, idx) => {
        const transactionRef = c.stripeChargeId || c.stripePaymentIntentId;
        const normalizedStatus = (c.status || 'CONFIRMED').toUpperCase();
        const isInactive = normalizedStatus === 'CANCELLED' || normalizedStatus === 'REFUNDED';
        const isRowBusy = Boolean(c.id && pendingContributorId === c.id);

        return (
          <li key={c.id || idx} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={isInactive ? 'line-through text-gray-500 dark:text-gray-400' : ''}>
                {c.name} - {formatCurrency(c.amount)} on {formatDate(c.date)}
              </span>
              <ContributorLifecycleBadge
                status={normalizedStatus}
                amount={c.amount}
                refundedAmount={c.refundedAmount}
                contributorId={c.id}
              />
            </div>
            {transactionRef && (
              <span
                data-testid={`verified-transaction-${idx}`}
                className="inline-flex items-center gap-1 text-[11px] font-mono text-emerald-700 dark:text-emerald-400 font-medium"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" aria-hidden="true" />
                Verified Ref: {transactionRef}
              </span>
            )}
            {c.id && (
              <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                {onContributorAction && !isInactive && (
                  <>
                    {normalizedStatus === 'RESERVED' && (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="primary"
                          disabled={isRowBusy}
                          aria-label={`Confirm contribution from ${c.name}`}
                          onClick={() => void onContributorAction(c.id!, c.name, 'confirm')}
                          className="px-2 py-0.5 text-[11px] h-auto"
                        >
                          Confirm
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={isRowBusy}
                          aria-label={`Send polite reminder to ${c.name}`}
                          onClick={() => void onContributorAction(c.id!, c.name, 'remind')}
                          className="px-2 py-0.5 text-[11px] h-auto"
                        >
                          Polite Reminder
                        </Button>
                      </>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="danger"
                      disabled={isRowBusy}
                      aria-label={`Void contribution from ${c.name}`}
                      onClick={() => void onContributorAction(c.id!, c.name, 'void')}
                      className="px-2 py-0.5 text-[11px] h-auto"
                    >
                      Void
                    </Button>
                  </>
                )}
                {onEditContributor && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={isRowBusy}
                    aria-label={`Edit contribution from ${c.name}`}
                    onClick={() => onEditContributor(c)}
                    className="px-2 py-0.5 text-[11px] h-auto"
                  >
                    Edit
                  </Button>
                )}
                {onDeleteContributor && (
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    disabled={isRowBusy}
                    aria-label={`Delete contribution from ${c.name}`}
                    onClick={() => void onDeleteContributor(c)}
                    className="px-2 py-0.5 text-[11px] h-auto"
                  >
                    Delete
                  </Button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
};

const RegistryItemDragHandle = ({
  dragHandleProps,
  itemLabel,
}: {
  dragHandleProps: DraggableProvidedDragHandleProps | null | undefined;
  itemLabel: string;
}) => (
  <div
    {...dragHandleProps}
    aria-label={`Reorder ${itemLabel}`}
    className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 cursor-grab active:cursor-grabbing focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded p-1 transition-colors"
  >
    <Icon name="DragHandle" className="h-5 w-5" />
  </div>
);

const RegistryItemMoveButtons = ({
  itemLabel,
  canMoveUp,
  canMoveDown,
  onMove,
}: {
  itemLabel: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (_direction: 'up' | 'down') => void;
}) => (
  <>
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={`Move ${itemLabel} up`}
      disabled={!canMoveUp}
      onClick={(e) => {
        e.stopPropagation();
        onMove('up');
      }}
    >
      <Icon name="ArrowUp" className="h-4 w-4" />
    </Button>
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={`Move ${itemLabel} down`}
      disabled={!canMoveDown}
      onClick={(e) => {
        e.stopPropagation();
        onMove('down');
      }}
    >
      <Icon name="ArrowDown" className="h-4 w-4" />
    </Button>
  </>
);

const RegistryItemPriorityToggle = ({
  itemName,
  isPriority,
  onToggle,
}: {
  itemName: string;
  isPriority: boolean;
  onToggle: () => void;
}) => (
  <Button
    type="button"
    variant="outline"
    size="sm"
    pressed={isPriority}
    aria-label={itemName ? `Most Wanted: ${itemName}` : 'Most Wanted: unnamed item'}
    onClick={(e) => {
      e.stopPropagation();
      onToggle();
    }}
    className={
      isPriority
        ? 'bg-amber-100 text-amber-900 border-amber-400 hover:bg-amber-200 dark:bg-amber-900/50 dark:text-amber-200 dark:border-amber-600'
        : ''
    }
  >
    <Icon
      name="Star"
      className={isPriority ? 'h-4 w-4 fill-current mr-1' : 'h-4 w-4 mr-1'}
    />
    Most Wanted
  </Button>
);

const RegistryItemBadges = ({
  itemId,
  isSample,
  isUnconfiguredFund,
  variant,
}: {
  itemId: string;
  isSample?: boolean;
  isUnconfiguredFund: boolean;
  variant: RegistryLayoutVariant;
}) => {
  const badgeLayoutClass =
    variant === 'desktop'
      ? 'ml-2 inline-flex items-center text-xs font-medium px-2 py-0.5 rounded'
      : 'px-2 py-1 rounded-full font-medium';

  return (
    <>
      {isSample && (
        <span
          className={`${badgeLayoutClass} bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200 border border-amber-300 dark:border-amber-700`}
        >
          Sample
        </span>
      )}
      {isUnconfiguredFund && (
        <span
          data-testid={variant === 'desktop' ? `unconfigured-fund-badge-${itemId}` : undefined}
          className={`${badgeLayoutClass} bg-red-100 text-red-800 dark:bg-red-950/70 dark:text-red-200 border border-red-300 dark:border-red-700`}
        >
          Checkout Disabled
        </span>
      )}
    </>
  );
};

const RegistryItemActions = ({
  itemName,
  variant,
  isPurchased,
  isUnclaimPending,
  onUnclaim,
  onEdit,
  onDelete,
}: {
  itemName: string;
  variant: RegistryLayoutVariant;
  isPurchased?: boolean;
  isUnclaimPending?: boolean;
  onUnclaim?: () => void;
  onEdit: () => void;
  onDelete: (_event: React.MouseEvent<HTMLButtonElement>) => void;
}) => {
  const buttonClassName = variant === 'mobile' ? 'flex-1' : undefined;

  return (
    <>
      {isPurchased && onUnclaim && (
        <Button
          className={buttonClassName}
          variant="outline"
          size="sm"
          disabled={isUnclaimPending}
          aria-label={itemName ? 'Unclaim registry item: ' + itemName : 'Unclaim unnamed item'}
          onClick={onUnclaim}
        >
          Unclaim
        </Button>
      )}
      <Button
        className={buttonClassName}
        variant="secondary"
        size="sm"
        aria-label={itemName ? 'Edit registry item: ' + itemName : 'Edit unnamed item'}
        onClick={onEdit}
      >
        Edit
      </Button>
      <Button
        className={buttonClassName}
        variant="danger"
        size="sm"
        aria-label={itemName ? 'Delete registry item: ' + itemName : 'Delete unnamed item'}
        onClick={onDelete}
      >
        Delete
      </Button>
    </>
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
    performContributorAction,
    unclaimItem,
    updateContributor,
    deleteContributor,
  } = useAdminRegistry();
  const { addToast, confirm } = useToast();
  const [announcement, setAnnouncement] = useState<string>('');
  const [pendingContributorId, setPendingContributorId] = useState<string | null>(null);
  const [pendingUnclaimItemId, setPendingUnclaimItemId] = useState<string | null>(null);

  const [editingContributor, setEditingContributor] = useState<AdminContributorEntry | null>(null);
  const [editContributorName, setEditContributorName] = useState<string>('');
  const [editContributorEmail, setEditContributorEmail] = useState<string>('');
  const [editContributorAmount, setEditContributorAmount] = useState<string>('');
  const [editContributorStatus, setEditContributorStatus] =
    useState<ContributorStatus>('CONFIRMED');
  const [editContributorMessage, setEditContributorMessage] = useState<string>('');
  const [isSavingContributorEdit, setIsSavingContributorEdit] = useState<boolean>(false);

  const openEditContributor = (contributor: AdminContributorEntry) => {
    setEditingContributor(contributor);
    setEditContributorName(contributor.name || '');
    setEditContributorEmail(contributor.email || '');
    setEditContributorAmount(String(contributor.amount ?? ''));
    const normalized = (contributor.status || 'CONFIRMED').toUpperCase();
    setEditContributorStatus(
      normalized === 'RESERVED' ||
        normalized === 'CONFIRMED' ||
        normalized === 'CANCELLED' ||
        normalized === 'REFUNDED'
        ? (normalized as ContributorStatus)
        : 'CONFIRMED'
    );
    setEditContributorMessage(contributor.message || '');
  };

  const closeEditContributor = () => {
    setEditingContributor(null);
  };

  const handleSaveContributorEdit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingContributor?.id) return;

    const trimmedName = editContributorName.trim();
    const parsedAmount = Number(editContributorAmount);
    if (!trimmedName) {
      addToast('Contributor name is required.', 'error');
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      addToast('Contribution amount must be a positive number.', 'error');
      return;
    }

    const verifiedRef =
      editingContributor.stripeChargeId || editingContributor.stripePaymentIntentId;
    const hasVerifiedPayment = Boolean(verifiedRef);

    if (hasVerifiedPayment) {
      const confirmed = await confirm(
        `Warning: ${editingContributor.name} has a verified Stripe payment (${verifiedRef}). Editing this claim will NOT automatically refund or adjust the Stripe payment. Proceed with saving changes?`
      );
      if (!confirmed) return;
    }

    setIsSavingContributorEdit(true);
    setPendingContributorId(editingContributor.id);
    try {
      await updateContributor(editingContributor.id, {
        name: trimmedName,
        email: editContributorEmail.trim() || null,
        amount: parsedAmount,
        status: editContributorStatus,
        message: editContributorMessage.trim() || null,
        confirmVerifiedPayment: hasVerifiedPayment,
      });
      const feedback = `Updated contribution from ${trimmedName}.`;
      setAnnouncement(feedback);
      addToast(feedback, 'success');
      closeEditContributor();
    } catch (err: unknown) {
      addToast(
        err instanceof Error && err.message
          ? err.message
          : 'Failed to update contributor record.',
        'error'
      );
    } finally {
      setIsSavingContributorEdit(false);
      setPendingContributorId(null);
    }
  };

  const handleDeleteContributor = async (contributor: AdminContributorEntry) => {
    if (!contributor.id) return;
    const verifiedRef = contributor.stripeChargeId || contributor.stripePaymentIntentId;
    const hasVerifiedPayment = Boolean(verifiedRef);

    const promptMessage = hasVerifiedPayment
      ? `Warning: ${contributor.name} has a verified Stripe payment (${verifiedRef}). Deleting this contribution will permanently remove the claim record without issuing a Stripe refund. Are you sure you want to delete it?`
      : `Delete the contribution from ${contributor.name}? This will permanently remove the claim record and recalculate the item balance.`;

    const confirmed = await confirm(promptMessage);
    if (!confirmed) return;

    setPendingContributorId(contributor.id);
    try {
      await deleteContributor(contributor.id, hasVerifiedPayment);
      const feedback = `Deleted contribution from ${contributor.name}.`;
      setAnnouncement(feedback);
      addToast(feedback, 'success');
    } catch (err: unknown) {
      addToast(
        err instanceof Error && err.message
          ? err.message
          : 'Failed to delete contributor record.',
        'error'
      );
    } finally {
      setPendingContributorId(null);
    }
  };

  const handleUnclaimItem = async (item: RegistryItem) => {
    const itemLabel = item.name || item.id;
    const activeContributors = (item.contributors || []).filter((c) => {
      const st = (c.status || 'CONFIRMED').toUpperCase();
      return st === 'RESERVED' || st === 'CONFIRMED';
    });
    const hasVerifiedPayment = activeContributors.some((c) =>
      Boolean(c.stripePaymentIntentId || c.stripeChargeId)
    );

    const promptMessage = hasVerifiedPayment
      ? `Warning: "${itemLabel}" has a verified Stripe payment on file. Releasing this claim will NOT automatically refund the Stripe payment. Are you sure you want to unclaim this gift?`
      : `Release the claim on "${itemLabel}" and reopen it for guests?`;

    const confirmed = await confirm(promptMessage);
    if (!confirmed) return;

    setPendingUnclaimItemId(item.id);
    try {
      await unclaimItem(item.id, hasVerifiedPayment);
      const feedback = `Released claim on ${itemLabel}.`;
      setAnnouncement(feedback);
      addToast(feedback, 'success');
    } catch (err: unknown) {
      addToast(
        err instanceof Error && err.message
          ? err.message
          : 'Failed to release claim on registry item.',
        'error'
      );
    } finally {
      setPendingUnclaimItemId(null);
    }
  };

  const handleContributorAction = async (
    contributorId: string,
    contributorName: string,
    action: 'confirm' | 'remind' | 'void'
  ) => {
    if (action === 'void') {
      const confirmed = await confirm(
        `Void the contribution from ${contributorName}? This keeps the contributor record for history while reopening the gift balance.`
      );
      if (!confirmed) return;
    }

    setPendingContributorId(contributorId);
    try {
      await performContributorAction(contributorId, action);
      const feedback =
        action === 'confirm'
          ? `Confirmed contribution from ${contributorName}.`
          : action === 'remind'
            ? `Sent polite reminder email to ${contributorName}.`
            : `Voided contribution from ${contributorName}.`;
      setAnnouncement(feedback);
      addToast(feedback, 'success');
    } catch (err: unknown) {
      addToast(
        err instanceof Error && err.message
          ? err.message
          : 'Failed to update contributor record.',
        'error'
      );
    } finally {
      setPendingContributorId(null);
    }
  };

  const safeItems = Array.isArray(items) ? items : [];
  const mostWantedItems = safeItems.filter((item) => Boolean(item.isMostWanted));
  const standardItems = safeItems.filter((item) => !item.isMostWanted);
  const orderedItems = [...mostWantedItems, ...standardItems];

  const hasFundWithoutHandle = safeItems.some(
    (item) =>
      !item.isSample &&
      !item.purchased &&
      (item.itemType === 'CASH_FUND' || item.itemType === 'EXPERIENCE_FUND' || item.isGroupGift) &&
      !(item.paymentHandle && item.paymentHandle.trim())
  );
  const { cardCheckoutEnabled, defaultPaymentHandle, isCapabilitiesLoading } =
    useRegistryCapabilities({
      enabled: !isLoading && !error && hasFundWithoutHandle,
    });
  const hasDefaultHandle = Boolean(defaultPaymentHandle && defaultPaymentHandle.trim());
  const isUnconfiguredFundItem = (item: (typeof safeItems)[number]) =>
    !isCapabilitiesLoading &&
    !cardCheckoutEnabled &&
    !hasDefaultHandle &&
    !item.isSample &&
    !item.purchased &&
    (item.itemType === 'CASH_FUND' || item.itemType === 'EXPERIENCE_FUND' || item.isGroupGift) &&
    !(item.paymentHandle && item.paymentHandle.trim());
  const unconfiguredFunds = safeItems.filter(isUnconfiguredFundItem);

  const preparedItems: PreparedRegistryItem[] = orderedItems.map((item, index) => {
    const isPriority = Boolean(item.isMostWanted);
    const groupLength = isPriority ? mostWantedItems.length : standardItems.length;
    const groupIndex = isPriority ? index : index - mostWantedItems.length;

    return {
      item,
      index,
      isPriority,
      groupIndex,
      canMoveUp: groupIndex > 0,
      canMoveDown: groupIndex < groupLength - 1,
      itemLabel: item.name || item.id,
      isUnconfiguredFund: isUnconfiguredFundItem(item),
    };
  });

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

  const handleDeleteItem = async (
    event: React.MouseEvent<HTMLButtonElement>,
    itemId: string,
    variant: RegistryLayoutVariant
  ) => {
    const container = event.currentTarget.closest<HTMLElement>(
      variant === 'desktop' ? 'tr' : '.rounded-xl'
    );
    if (!(await confirm('Are you sure you want to delete this item?'))) return;

    if (container) {
      if (variant === 'desktop') {
        captureDesktopFocus(container);
      } else {
        captureMobileFocus(container);
      }
    }

    try {
      await remove(itemId);
      addToast('Item deleted successfully.', 'success');
    } catch {
      // Error is handled by useAdminRegistry hook
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
                      {preparedItems.map(
                        ({
                          item,
                          index,
                          isPriority,
                          canMoveUp,
                          canMoveDown,
                          itemLabel,
                          isUnconfiguredFund,
                        }) => (
                          <Draggable key={item.id} draggableId={item.id} index={index}>
                            {(draggableProvided) => (
                              <TableRow
                                ref={draggableProvided.innerRef}
                                {...draggableProvided.draggableProps}
                              >
                                <TableCell>
                                  <div className="flex items-center gap-1">
                                    <RegistryItemDragHandle
                                      dragHandleProps={draggableProvided.dragHandleProps}
                                      itemLabel={itemLabel}
                                    />
                                    <RegistryItemMoveButtons
                                      itemLabel={itemLabel}
                                      canMoveUp={canMoveUp}
                                      canMoveDown={canMoveDown}
                                      onMove={(direction) => void handleMoveItem(index, direction)}
                                    />
                                  </div>
                                </TableCell>
                                <TableCell className="font-semibold">
                                  {item.name}
                                  <RegistryItemBadges
                                    itemId={item.id}
                                    isSample={item.isSample}
                                    isUnconfiguredFund={isUnconfiguredFund}
                                    variant="desktop"
                                  />
                                </TableCell>
                                <TableCell>
                                  <RegistryItemPriorityToggle
                                    itemName={item.name}
                                    isPriority={isPriority}
                                    onToggle={() => void handleTogglePriority(item)}
                                  />
                                </TableCell>
                                <TableCell>{formatCurrency(item.price)}</TableCell>
                                <TableCell>{item.purchased ? 'Yes' : 'No'}</TableCell>
                                <TableCell>
                                  <ContributionsList
                                    contributors={item.contributors}
                                    onContributorAction={handleContributorAction}
                                    onEditContributor={openEditContributor}
                                    onDeleteContributor={handleDeleteContributor}
                                    pendingContributorId={pendingContributorId}
                                  />
                                </TableCell>
                                <TableCell className="space-x-2">
                                  <RegistryItemActions
                                    itemName={item.name}
                                    variant="desktop"
                                    isPurchased={item.purchased}
                                    isUnclaimPending={pendingUnclaimItemId === item.id}
                                    onUnclaim={() => void handleUnclaimItem(item)}
                                    onEdit={() => router.push(`/registry/edit-item/${item.id}`)}
                                    onDelete={(e) => void handleDeleteItem(e, item.id, 'desktop')}
                                  />
                                </TableCell>
                              </TableRow>
                            )}
                          </Draggable>
                        )
                      )}
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
                {preparedItems.map(
                  ({
                    item,
                    index,
                    isPriority,
                    canMoveUp,
                    canMoveDown,
                    itemLabel,
                    isUnconfiguredFund,
                  }) => (
                    <Draggable key={item.id} draggableId={item.id} index={index}>
                      {(draggableProvided) => (
                        <div
                          ref={draggableProvided.innerRef}
                          {...draggableProvided.draggableProps}
                          className="rounded-xl shadow-lg bg-white dark:bg-gray-800 p-4 flex flex-col gap-2 border border-primary dark:border-gray-700"
                        >
                          <div className="flex justify-between items-center mb-2 gap-2">
                            <div className="flex items-center gap-2">
                              <RegistryItemDragHandle
                                dragHandleProps={draggableProvided.dragHandleProps}
                                itemLabel={itemLabel}
                              />
                              <span className="font-bold text-lg text-primary">{item.name}</span>
                            </div>
                            <span className="text-sm font-semibold">{formatCurrency(item.price)}</span>
                          </div>
                          <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                            <div className="flex flex-wrap gap-2 text-xs">
                              <RegistryItemBadges
                                itemId={item.id}
                                isSample={item.isSample}
                                isUnconfiguredFund={isUnconfiguredFund}
                                variant="mobile"
                              />
                              <span
                                className={`px-2 py-1 rounded-full ${item.purchased ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}
                              >
                                {item.purchased ? 'Claimed' : 'Available'}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <RegistryItemPriorityToggle
                                itemName={item.name}
                                isPriority={isPriority}
                                onToggle={() => void handleTogglePriority(item)}
                              />
                              <RegistryItemMoveButtons
                                itemLabel={itemLabel}
                                canMoveUp={canMoveUp}
                                canMoveDown={canMoveDown}
                                onMove={(direction) => void handleMoveItem(index, direction)}
                              />
                            </div>
                          </div>
                          <div className="mb-2">
                            <span className="font-semibold">Contributions:</span>
                            <div className="ml-2 mt-1">
                              <ContributionsList
                                contributors={item.contributors}
                                onContributorAction={handleContributorAction}
                                onEditContributor={openEditContributor}
                                onDeleteContributor={handleDeleteContributor}
                                pendingContributorId={pendingContributorId}
                              />
                            </div>
                          </div>
                          <div className="flex gap-2 mt-2">
                            <RegistryItemActions
                              itemName={item.name}
                              variant="mobile"
                              isPurchased={item.purchased}
                              isUnclaimPending={pendingUnclaimItemId === item.id}
                              onUnclaim={() => void handleUnclaimItem(item)}
                              onEdit={() => router.push(`/registry/edit-item/${item.id}`)}
                              onDelete={(e) => void handleDeleteItem(e, item.id, 'mobile')}
                            />
                          </div>
                        </div>
                      )}
                    </Draggable>
                  )
                )}
                {droppableProvided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>

        {editingContributor && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-contributor-dialog-title"
          >
            <div className="w-full max-w-md rounded-xl bg-white dark:bg-gray-800 p-6 shadow-xl border border-gray-200 dark:border-gray-700 space-y-4">
              <h2
                id="edit-contributor-dialog-title"
                className="text-xl font-bold text-gray-900 dark:text-white"
              >
                Edit Contribution
              </h2>
              {(editingContributor.stripeChargeId || editingContributor.stripePaymentIntentId) && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100 text-xs"
                >
                  Verified Stripe payment ({editingContributor.stripeChargeId || editingContributor.stripePaymentIntentId}) is linked to this record. Saving changes updates the registry ledger only and will require confirmation.
                </div>
              )}
              <form onSubmit={handleSaveContributorEdit} className="space-y-3">
                <FormGroup>
                  <Label htmlFor="edit-contributor-name">Contributor Name</Label>
                  <Input
                    id="edit-contributor-name"
                    type="text"
                    value={editContributorName}
                    onChange={(e) => setEditContributorName(e.target.value)}
                    required
                  />
                </FormGroup>
                <FormGroup>
                  <Label htmlFor="edit-contributor-amount">Contribution Amount ($)</Label>
                  <Input
                    id="edit-contributor-amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={editContributorAmount}
                    onChange={(e) => setEditContributorAmount(e.target.value)}
                    required
                  />
                </FormGroup>
                <FormGroup>
                  <Label htmlFor="edit-contributor-email">Contributor Email (Optional)</Label>
                  <Input
                    id="edit-contributor-email"
                    type="email"
                    value={editContributorEmail}
                    onChange={(e) => setEditContributorEmail(e.target.value)}
                  />
                </FormGroup>
                <FormGroup>
                  <Label htmlFor="edit-contributor-status">Claim Status</Label>
                  <select
                    id="edit-contributor-status"
                    value={editContributorStatus}
                    onChange={(e) => setEditContributorStatus(e.target.value as ContributorStatus)}
                    className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
                  >
                    <option value="RESERVED">RESERVED</option>
                    <option value="CONFIRMED">CONFIRMED</option>
                    <option value="CANCELLED">CANCELLED</option>
                    <option value="REFUNDED">REFUNDED</option>
                  </select>
                </FormGroup>
                <FormGroup>
                  <Label htmlFor="edit-contributor-message">Personal Message (Optional)</Label>
                  <Textarea
                    id="edit-contributor-message"
                    rows={2}
                    value={editContributorMessage}
                    onChange={(e) => setEditContributorMessage(e.target.value)}
                  />
                </FormGroup>
                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={isSavingContributorEdit}
                    onClick={closeEditContributor}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={isSavingContributorEdit}
                  >
                    {isSavingContributorEdit ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
