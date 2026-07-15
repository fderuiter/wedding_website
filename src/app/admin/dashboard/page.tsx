'use client';

import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/ToastProvider';
import { useAdminRegistry } from '@/hooks/admin/useAdminRegistry';
import { Button } from '@/components/ui/Button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { useFocusSuccessor } from '@/hooks/useFocusSuccessor';
import { formatCurrency, formatDate } from '@/utils/intl';

const ContributionsList = ({ contributors }: { contributors?: { name: string; amount: number; date: string }[] }) => {
  if (!contributors || contributors.length === 0) {
    return <span className="text-gray-500 dark:text-gray-400">None</span>;
  }
  return (
    <ul className="text-xs space-y-1">
      {contributors.map((c, idx) => (
        <li key={idx}>
          {c.name} - {formatCurrency(c.amount)} on {formatDate(c.date)}
        </li>
      ))}
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
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-semibold">{item.name}</TableCell>
                    <TableCell>{formatCurrency(item.price)}</TableCell>
                    <TableCell>{item.purchased ? 'Yes' : 'No'}</TableCell>
                    <TableCell>
                      <ContributionsList contributors={item.contributors} />
                    </TableCell>
                    <TableCell className="space-x-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-label={'Edit registry item: ' + item.name}
                        onClick={() => router.push(`/admin/dashboard/registry/edit-item/${item.id}`)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        aria-label={'Delete registry item: ' + item.name}
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
          {items.map((item) => (
            <div key={item.id} className="rounded-xl shadow-lg bg-white dark:bg-gray-800 p-4 flex flex-col gap-2 border border-primary dark:border-gray-700">
              <div className="flex justify-between items-center mb-2">
                <span className="font-bold text-lg text-primary">{item.name}</span>
                <span className="text-sm font-semibold">{formatCurrency(item.price)}</span>
              </div>
              <div className="flex flex-wrap gap-2 text-xs mb-1">
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
                  aria-label={'Edit registry item: ' + item.name}
                  onClick={() => router.push(`/admin/dashboard/registry/edit-item/${item.id}`)}
                >
                  Edit
                </Button>
                <Button
                  className="flex-1"
                  variant="danger"
                  size="sm"
                  aria-label={'Delete registry item: ' + item.name}
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
            onClick={() => router.push('/admin/dashboard/registry/add-item')}
          >
            Add New Item
          </Button>
        </div>
      </div>
    </div>
  );
}
