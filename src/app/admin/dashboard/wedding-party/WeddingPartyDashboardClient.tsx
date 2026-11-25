'use client';
import React, { useEffect, useState } from 'react';

import type { WeddingPartyMemberDTO } from '@/features/wedding-party';
import { useAdminWeddingParty } from '@/hooks/admin/useAdminWeddingParty';

import AdminPreviewLayout from '@/components/admin/AdminPreviewLayout';
import { AdminEditorContainer } from '@/components/admin/AdminEditorContainer';
import { AdminViewState } from '@/components/admin/AdminViewState';
import { WeddingPartyEditorForm, WeddingPartyCard } from '@/components/admin/WeddingPartyEditor';
import { Button } from '@/components/ui/Button';
import { useFocusSuccessor } from '@/hooks/useFocusSuccessor';
import { useToast } from '@/components/ui/ToastProvider';
import { withBasePath } from '@/lib/basePath';

interface WeddingPartyDashboardContentProps {
  members: WeddingPartyMemberDTO[];
  fetchAll: () => unknown;
  create: (_payload: Partial<WeddingPartyMemberDTO>) => Promise<WeddingPartyMemberDTO>;
  update: (_id: string, _payload: Partial<WeddingPartyMemberDTO>) => Promise<WeddingPartyMemberDTO>;
  remove: (_id: string) => Promise<unknown>;
  reorder: (_orderedIds: string[]) => Promise<unknown>;
}

function WeddingPartyDashboardContent({
  members,
  fetchAll,
  create,
  update,
  remove,
  reorder,
}: WeddingPartyDashboardContentProps) {
  const { containerRef, captureFocusTarget } = useFocusSuccessor<HTMLDivElement>();
  const { confirm } = useToast();

  const [isEditing, setIsEditing] = useState(false);
  const [currentMember, setCurrentMember] = useState<Partial<WeddingPartyMemberDTO>>({});
  const [announcement, setAnnouncement] = useState<string>('');
  const [partnerNames, setPartnerNames] = useState<{ partner1Name: string; partner2Name: string }>({
    partner1Name: '',
    partner2Name: '',
  });

  useEffect(() => {
    let cancelled = false;
    const loadPartnerNames = async () => {
      try {
        const res = await fetch(withBasePath('/api/admin/settings'));
        if (!res || !res.ok || typeof res.json !== 'function' || cancelled) return;
        const raw = await res.json();
        if (cancelled) return;
        const cfg = raw && typeof raw === 'object' && 'data' in raw && raw.data ? raw.data : raw;
        if (cfg && typeof cfg === 'object') {
          const nextP1 = String(
            (cfg as Record<string, unknown>).partner1Name ||
              (cfg as Record<string, unknown>).brideName ||
              '',
          );
          const nextP2 = String(
            (cfg as Record<string, unknown>).partner2Name ||
              (cfg as Record<string, unknown>).groomName ||
              '',
          );
          setPartnerNames((prev) =>
            prev.partner1Name === nextP1 && prev.partner2Name === nextP2
              ? prev
              : { partner1Name: nextP1, partner2Name: nextP2 },
          );
        }
      } catch {
        // Fallback to Partner 1 / Partner 2 labels if settings endpoint is unavailable
      }
    };
    void loadPartnerNames();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleMove = async (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= members.length) return;

    const newMembers = Array.from(members);
    const [movedItem] = newMembers.splice(index, 1);
    newMembers.splice(targetIndex, 0, movedItem);

    const orderedIds = newMembers.map((m) => m.id);
    try {
      await reorder(orderedIds);
      setAnnouncement(
        `Moved ${movedItem.name || 'member'} ${direction} to position ${targetIndex + 1} of ${members.length}`
      );
    } catch {
      // Error handled by entity orchestration / toast
    }
  };

  const handleSave = async () => {
    try {
      if (currentMember.id) {
        await update(currentMember.id, currentMember);
      } else {
        await create(currentMember);
      }
      setIsEditing(false);
    } catch {
      // Error handled globally
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent<HTMLButtonElement>) => {
    const card = e.currentTarget.closest('.bg-white');
    if (!(await confirm('Are you sure you want to delete this member?'))) return;
    if (card) {
      captureFocusTarget(card as HTMLElement);
    }
    try {
      await remove(id);
    } catch {
      // Error handled globally
    }
  };

  const draftMember = {
    id: currentMember.id || 'draft',
    name: currentMember.name ?? '',
    role: currentMember.role ?? '',
    bio: currentMember.bio ?? '',
    side: currentMember.side ?? null,
    photo: {
      url: currentMember.photoUrl ?? currentMember.photo?.url ?? '',
      altText: currentMember.photoAlt ?? currentMember.photo?.altText ?? '',
      isDecorative: currentMember.photoDecorative ?? currentMember.photo?.isDecorative ?? false,
    },
    link: currentMember.link ?? '',
    order: currentMember.order ?? 0,
  };

  const currentMembersWithDraft = members.map(m => m.id === currentMember.id ? draftMember : m);
  if (!currentMember.id && isEditing) {
    currentMembersWithDraft.push(draftMember as WeddingPartyMemberDTO);
  }
  
  // Sort by order so preview looks right
  currentMembersWithDraft.sort((a, b) => a.order - b.order);

  return (
    <AdminPreviewLayout
      previewUrl="/wedding-party"
      draftType="wedding-party"
      draftData={currentMembersWithDraft}
      entityId={currentMember.id}
      onRestore={() => {
        setIsEditing(false);
        fetchAll();
      }}
    >
      <div className="py-10 px-4 sm:px-6 max-w-5xl mx-auto">
        <div className="flex flex-wrap justify-between items-center gap-4 mb-8">
          <h1 className="text-3xl font-extrabold text-primary">Wedding Party Studio</h1>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => { 
              setCurrentMember({ name: '', role: '', bio: '', side: undefined, photoUrl: '', link: '', order: 0 }); 
              setIsEditing(true); 
            }}>Add New Member</Button>
          </div>
        </div>

        {isEditing && (
          <AdminEditorContainer title={`${currentMember.id ? 'Edit' : 'Create'} Member`}>
            <WeddingPartyEditorForm
              values={currentMember}
              onChange={(updated) => setCurrentMember((prev) => ({ ...prev, ...updated }))}
              onSubmit={handleSave}
              onCancel={() => setIsEditing(false)}
              partner1Name={partnerNames.partner1Name}
              partner2Name={partnerNames.partner2Name}
              submitLabel="Save"
            />
          </AdminEditorContainer>
        )}

        <div aria-live="polite" className="sr-only" role="status">
          {announcement}
        </div>

        <div className="grid gap-4 pb-10" ref={containerRef}>
          {members.map((member, index) => (
            <WeddingPartyCard
              key={member.id}
              member={member}
              showSampleBadge
              unnamedAriaFallback
              onMove={(direction) => handleMove(index, direction)}
              disableMoveUp={index === 0}
              disableMoveDown={index === members.length - 1}
              className="dark:bg-gray-800 rounded-xl shadow border-primary dark:border-primary"
              onEdit={(item) => {
                setCurrentMember(item);
                setIsEditing(true);
              }}
              onDelete={handleDelete}
            />
          ))}
          {members.length === 0 && <p className="text-gray-500 dark:text-gray-400">No wedding party members found.</p>}
        </div>
      </div>
    </AdminPreviewLayout>
  );
}

/**
 * Render the admin CRUD interface and live preview for wedding-party members.
 *
 * Renders an admin page that lists wedding party members, provides create/edit/delete/reorder controls,
 * shows an inline form for drafting a member, and supplies a preview via AdminPreviewLayout.
 *
 * @returns The React element for the Wedding Party admin dashboard and preview.
 */
export default function WeddingPartyDashboardPage() {
  const {
    data: members,
    isLoading,
    error,
    fetchAll,
    create,
    update,
    remove,
    reorder
  } = useAdminWeddingParty();

  return (
    <AdminViewState
      isLoading={isLoading}
      error={error}
      onRetry={fetchAll}
      loadingMessage="Loading wedding party..."
    >
      <WeddingPartyDashboardContent
        members={members}
        fetchAll={fetchAll}
        create={create}
        update={update}
        remove={remove}
        reorder={reorder}
      />
    </AdminViewState>
  );
}
