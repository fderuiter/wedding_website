'use client';

import React, { useState } from 'react';
import type { WeddingPartyMemberDTO } from '@/features/wedding-party';
import { useAdminWeddingParty } from '@/hooks/admin/useAdminWeddingParty';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { WeddingPartyEditorForm, WeddingPartyCard } from '@/components/admin/WeddingPartyEditor';
import { EnsureToastProvider, useToast } from '@/components/ui/ToastProvider';

interface WeddingPartyManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function WeddingPartyManagerModalContent({ isOpen, onClose }: WeddingPartyManagerModalProps) {
  const { confirm } = useToast();

  const {
    data: members,
    isLoading,
    error,
    create,
    update,
    remove,
  } = useAdminWeddingParty();

  const [isEditing, setIsEditing] = useState(false);
  const [currentMember, setCurrentMember] = useState<Partial<WeddingPartyMemberDTO>>({});
  const [saving, setSaving] = useState(false);

  const handleStartAdd = () => {
    setCurrentMember({ name: '', role: '', bio: '', side: undefined, photoUrl: '', link: '', order: 0 });
    setIsEditing(true);
  };

  const handleStartEdit = (member: WeddingPartyMemberDTO) => {
    setCurrentMember(member);
    setIsEditing(true);
  };

  const handleSave = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (currentMember.id) {
        await update(currentMember.id, currentMember);
      } else {
        await create(currentMember);
      }
      setIsEditing(false);
    } catch {
      // Error is handled globally or via toast
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const isConfirmed = await confirm('Are you sure you want to delete this wedding party member?');
    if (!isConfirmed) return;
    try {
      await remove(id);
    } catch {
      // Error handled globally
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Manage Wedding Party"
      description="Add, edit, or remove wedding party members directly from your setup wizard."
      className="max-w-2xl w-full max-h-[85vh] overflow-y-auto"
    >
      <div className="space-y-6 pt-2">
        {!isEditing && (
          <div className="flex justify-between items-center pb-2 border-b border-gray-200 dark:border-gray-800">
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {members.length} {members.length === 1 ? 'member' : 'members'} configured
            </span>
            <Button onClick={handleStartAdd} variant="primary" size="sm">
              Add New Member
            </Button>
          </div>
        )}

        {isEditing && (
          <WeddingPartyEditorForm
            values={currentMember}
            onChange={(updated) => setCurrentMember((prev) => ({ ...prev, ...updated }))}
            onSubmit={handleSave}
            onCancel={() => setIsEditing(false)}
            bindFieldIds
            requireFields
            submitLabel="Save Member"
            saving={saving}
            actionsAlign="end"
            heading={currentMember.id ? 'Edit Member' : 'Add New Member'}
            className="bg-gray-50 dark:bg-zinc-800/60 p-4 rounded-lg border border-gray-200 dark:border-zinc-700 space-y-4"
          />
        )}

        {isLoading && (
          <div className="py-8 text-center text-muted-text">Loading wedding party members...</div>
        )}

        {error && (
          <div role="alert" className="p-3 text-sm text-red-600 bg-red-50 dark:bg-red-950/30 rounded">
            Failed to load members: {error.message}
          </div>
        )}

        {!isLoading && !error && (
          <div className="space-y-3">
            {members.length === 0 ? (
              <p className="py-6 text-center text-gray-500 dark:text-gray-400">
                No wedding party members added yet. Click &quot;Add New Member&quot; above.
              </p>
            ) : (
              members.map((member) => (
                <WeddingPartyCard
                  key={member.id}
                  member={member}
                  onEdit={handleStartEdit}
                  onDelete={(id) => handleDelete(id)}
                />
              ))
            )}
          </div>
        )}

        <div className="flex justify-end pt-4 border-t border-gray-200 dark:border-zinc-800">
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export function WeddingPartyManagerModal(props: WeddingPartyManagerModalProps) {
  const ToastBoundary =
    typeof EnsureToastProvider === 'function' ? EnsureToastProvider : React.Fragment;
  return (
    <ToastBoundary>
      <WeddingPartyManagerModalContent {...props} />
    </ToastBoundary>
  );
}
