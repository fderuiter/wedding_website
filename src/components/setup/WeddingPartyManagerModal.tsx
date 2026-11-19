'use client';

import React, { useState, useEffect, useRef } from 'react';
import type { WeddingPartyMemberDTO } from '@/features/wedding-party';
import { useAdminWeddingParty } from '@/hooks/admin/useAdminWeddingParty';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { WeddingPartyEditorForm, WeddingPartyCard } from '@/components/admin/WeddingPartyEditor';
import { useToast } from '@/components/ui/ToastProvider';

interface WeddingPartyManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function WeddingPartyManagerModal({ isOpen, onClose }: WeddingPartyManagerModalProps) {
  let toastConfirm: ((_msg: string) => Promise<boolean>) | null = null;
  try {
    const toast = useToast();
    toastConfirm = toast.confirm;
  } catch {
    // Fallback if rendered outside ToastProvider
  }

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

  const formRef = useRef<HTMLFormElement | null>(null);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const doneButtonRef = useRef<HTMLButtonElement | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const editingIdRef = useRef<string | null>(null);
  const prevIsEditingRef = useRef(isEditing);
  const pendingDeleteFocusRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      prevIsEditingRef.current = isEditing;
      return;
    }

    if (!prevIsEditingRef.current && isEditing) {
      const firstField = formRef.current?.querySelector<HTMLElement>(
        'input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)'
      );
      firstField?.focus();
    } else if (prevIsEditingRef.current && !isEditing) {
      const targetCard = editingIdRef.current
        ? cardRefs.current.get(editingIdRef.current)
        : undefined;
      const editBtn = targetCard?.querySelector<HTMLButtonElement>('button:not(:disabled)');
      if (editBtn && editBtn.isConnected) {
        editBtn.focus();
      } else {
        (addButtonRef.current ?? doneButtonRef.current)?.focus();
      }
      editingIdRef.current = null;
    }

    prevIsEditingRef.current = isEditing;
  }, [isOpen, isEditing]);

  useEffect(() => {
    if (isOpen && !isEditing && pendingDeleteFocusRef.current) {
      pendingDeleteFocusRef.current = false;
      (addButtonRef.current ?? doneButtonRef.current)?.focus();
    }
  }, [isOpen, isEditing, members.length]);

  const handleStartAdd = () => {
    editingIdRef.current = null;
    setCurrentMember({ name: '', role: '', bio: '', side: undefined, photoUrl: '', link: '', order: 0 });
    setIsEditing(true);
  };

  const handleStartEdit = (member: WeddingPartyMemberDTO) => {
    editingIdRef.current = member.id;
    setCurrentMember(member);
    setIsEditing(true);
  };

  const handleSave = async (e: React.FormEvent) => {
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
    const isConfirmed = toastConfirm
      ? await toastConfirm('Are you sure you want to delete this wedding party member?')
      : window.confirm('Are you sure you want to delete this wedding party member?');

    if (!isConfirmed) return;
    try {
      pendingDeleteFocusRef.current = true;
      await remove(id);
      if (!isEditing) {
        pendingDeleteFocusRef.current = false;
        (addButtonRef.current ?? doneButtonRef.current)?.focus();
      }
    } catch {
      pendingDeleteFocusRef.current = false;
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
            <Button ref={addButtonRef} onClick={handleStartAdd} variant="primary" size="sm">
              Add New Member
            </Button>
          </div>
        )}

        {isEditing && (
          <WeddingPartyEditorForm
            ref={formRef}
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
          <div className="py-8 text-center text-gray-500">Loading wedding party members...</div>
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
                  ref={(node) => {
                    if (node) {
                      cardRefs.current.set(member.id, node);
                    } else {
                      cardRefs.current.delete(member.id);
                    }
                  }}
                  member={member}
                  onEdit={handleStartEdit}
                  onDelete={(id) => handleDelete(id)}
                />
              ))
            )}
          </div>
        )}

        <div className="flex justify-end pt-4 border-t border-gray-200 dark:border-zinc-800">
          <Button ref={doneButtonRef} variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
