'use client';

import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/ToastProvider';
import { useAdminRegistry } from '@/hooks/admin/useAdminRegistry';
import { useRegistryCapabilities } from '@/features/registry';
import { Button } from '@/components/ui/Button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { OnboardingChecklist } from '@/components/admin/OnboardingChecklist';
import { useFocusSuccessor } from '@/hooks/useFocusSuccessor';
import { formatCurrency, formatDate } from '@/utils/intl';

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
 * @page AdminDashboardPage
 * @description The main dashboard for administrators to manage the wedding registry.
 *
 * This client component first checks if the user is authenticated as an admin.
 * If not, it redirects to the login page.
 * If authenticated, it fetches all registry items and displays them in a responsive table.
 * The dashboard provides functionality to edit and delete existing registry items and
 * includes a link to add new items.
 *
 * @returns {JSX.Element} The rendered admin dashboard page, or a loading/error state.
 */
export default function AdminDashboardPage() {
  const router = useRouter();
  const { data: items, isLoading, error, remove } = useAdminRegistry();
  const { addToast, confirm } = useToast();

  const safeItems = Array.isArray(items) ? items : [];
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

  if (isLoading) return (
    <div className="flex flex-col items-center justify-center min-h-[50vh]">
      <h1 className="text-3xl font-bold mb-4 text-primary">Admin Dashboard</h1>
      <p className="text-lg text-gray-500 dark:text-gray-400">Loading items...</p>
    </div>
  );
  if (error) return (
    <div className="flex flex-col items-center justify-center min-h-[50vh]">
      <h1 className="text-3xl font-bold mb-4 text-primary">Admin Dashboard</h1>
      <p className="text-red-500 text-lg">Error: {error.message}</p>
    </div>
  );

  return (
    <div className="py-10">
      <div className="max-w-5xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-extrabold text-primary tracking-tight drop-shadow-lg">Admin Dashboard</h1>
        </div>

        <OnboardingChecklist refreshTrigger={Array.isArray(items) ? items.length : 0} />

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
              Card processing (`STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`) is not configured, and the following{' '}
              {unconfiguredFunds.length === 1 ? 'fund does' : 'funds do'} not have a direct transfer handle:{' '}
              <span className="font-semibold">{unconfiguredFunds.map((f) => f.name).join(', ')}</span>. Edit{' '}
              {unconfiguredFunds.length === 1 ? 'this item' : 'these items'} to add a payment handle or configure Stripe credentials.
            </p>
          </div>
        )}
        
        {/* Responsive Table for Desktop, Cards for Mobile */}
        <div className="hidden md:block">
          <div className="overflow-x-auto rounded-xl shadow-lg bg-white dark:bg-gray-800 border border-primary dark:border-gray-700">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Claimed/Funded</TableHead>
                  <TableHead>Contributions</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody ref={desktopContainerRef}>
                {(Array.isArray(items) ? items : []).map((item) => (
                  <TableRow key={item.id}>
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
                          } catch (e: any) {
                            // Error is handled by useAdminRegistry hook
                          }
                        }}
                      >
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
        
        {/* Card Layout for Mobile */}
        <div className="md:hidden space-y-6" ref={mobileContainerRef}>
          {(Array.isArray(items) ? items : []).map((item) => (
            <div key={item.id} className="rounded-xl shadow-lg bg-white dark:bg-gray-800 p-4 flex flex-col gap-2 border border-primary dark:border-gray-700">
              <div className="flex justify-between items-center mb-2">
                <span className="font-bold text-lg text-primary">{item.name}</span>
                <span className="text-sm font-semibold">{formatCurrency(item.price)}</span>
              </div>
              <div className="flex flex-wrap gap-2 text-xs mb-1">
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
                    } catch (e: any) {
                      // Error is handled by useAdminRegistry hook
                    }
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-10 flex justify-center">
          <Button
            size="lg"
            onClick={() => router.push('/registry/add-item')}
          >
            Add New Item
          </Button>
        </div>
      </div>
    </div>
  );
}
