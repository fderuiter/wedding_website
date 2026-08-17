'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAdminInvitationCodes } from '@/hooks/admin/useAdminInvitationCodes';
import { FormGroup, Label, Input } from '@/components/ui/forms';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/ToastProvider';
import { useFocusSuccessor } from '@/hooks/useFocusSuccessor';

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
  } = useAdminInvitationCodes();

  const [isCreating, setIsCreating] = useState(false);
  const [newCode, setNewCode] = useState({ guestName: '', code: '' });

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

  if (isLoading) return <div className="min-h-screen flex items-center justify-center"><p>Loading...</p></div>;
  if (error) return <div className="min-h-screen flex items-center justify-center"><p className="text-red-500">Error: {error.message}</p></div>;

  return (
    <div className="py-10 px-4 sm:px-6 max-w-5xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-extrabold text-primary">Pre-Authorized Guest Invitation Codes</h1>
        <div className="flex gap-4">
          <Button variant="ghost" onClick={() => router.push('/admin/dashboard')}>Back to Dashboard</Button>
          <Button onClick={() => {
            setNewCode({ guestName: '', code: '' });
            setIsCreating(true);
          }}>Generate New Code</Button>
        </div>
      </div>

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

      <div className="grid gap-4 pb-10" ref={containerRef}>
        {codes.map(item => (
          <div key={item.id} className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow border border-primary flex justify-between items-center">
            <div>
              <div className="font-bold text-lg">{item.guestName}</div>
              <div className="text-sm font-semibold text-secondary uppercase tracking-wider">
                Code: <code className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-sm font-mono text-red-600 dark:text-red-400">{item.code}</code>
              </div>
              <div className="text-xs mt-1 text-gray-500 dark:text-gray-400">
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
        ))}
        {codes.length === 0 && <p className="text-gray-500 dark:text-gray-400">No invitation codes found.</p>}
      </div>
    </div>
  );
}
