"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import type { WeddingPartyMemberDTO } from '@/features/wedding-party/schemas';
import { useAdminWeddingParty } from '@/hooks/admin/useAdminWeddingParty';

import AdminPreviewLayout from "@/components/admin/AdminPreviewLayout";
import { Button } from "@/components/ui/Button";
import { FormGroup, Label, Input, Textarea } from "@/components/ui/forms";
import { useFocusSuccessor } from "@/hooks/useFocusSuccessor";
import { useToast } from "@/components/ui/ToastProvider";

/**
 * Render the admin CRUD interface and live preview for wedding-party members.
 *
 * Renders an admin page that lists wedding party members, provides create/edit/delete controls,
 * shows an inline form for drafting a member, and supplies a preview via AdminPreviewLayout.
 *
 * @returns The React element for the Wedding Party admin dashboard and preview.
 */
export default function WeddingPartyDashboardPage() {
  const router = useRouter();
  const { containerRef, captureFocusTarget } = useFocusSuccessor<HTMLDivElement>();
  const { confirm } = useToast();
  
  const {
    data: members,
    isLoading,
    error,
    fetchAll,
    create,
    update,
    remove
  } = useAdminWeddingParty();

  const [isEditing, setIsEditing] = useState(false);
  const [currentMember, setCurrentMember] = useState<Partial<WeddingPartyMemberDTO>>({});


  const handleSave = async () => {
    try {
      if (currentMember.id) {
        await update(currentMember.id, currentMember);
      } else {
        await create(currentMember);
      }
      setIsEditing(false);
    } catch (e: any) {
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
    } catch (e: any) {
      // Error handled globally
    }
  };

  if (isLoading) return <div className="min-h-[50vh] flex items-center justify-center"><p>Loading...</p></div>;
  if (error) return <div className="min-h-[50vh] flex items-center justify-center"><p className="text-red-500">Error: {error.message}</p></div>;

  const draftMember = {
    id: currentMember.id || 'draft',
    name: currentMember.name || '',
    role: currentMember.role || '',
    bio: currentMember.bio || '',
    photo: {
      url: currentMember.photoUrl || (currentMember.photo as any)?.url || '',
      altText: currentMember.photoAlt || (currentMember.photo as any)?.altText || '',
      isDecorative: currentMember.photoDecorative || (currentMember.photo as any)?.isDecorative || false,
    },
    link: currentMember.link || '',
    order: currentMember.order || 0,
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
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-extrabold text-primary">Wedding Party Studio</h1>
          <div>
            <Button onClick={() => { 
              setCurrentMember({ name: '', role: '', bio: '', photoUrl: '', link: '', order: 0 }); 
              setIsEditing(true); 
            }}>Add New Member</Button>
          </div>
        </div>

        {isEditing && (
          <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg mb-8 border border-primary dark:border-gray-700">
            <h2 className="text-2xl font-bold mb-4">{currentMember.id ? 'Edit' : 'Create'} Member</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <FormGroup>
                <Label>Name</Label>
                <Input type="text" value={currentMember.name || ''} onChange={e => setCurrentMember({...currentMember, name: e.target.value})} />
              </FormGroup>
              <FormGroup>
                <Label>Role</Label>
                <Input type="text" value={currentMember.role || ''} onChange={e => setCurrentMember({...currentMember, role: e.target.value})} />
              </FormGroup>
              <FormGroup className="md:col-span-2">
                <Label>Bio</Label>
                <Textarea value={currentMember.bio || ''} onChange={e => setCurrentMember({...currentMember, bio: e.target.value})} />
              </FormGroup>
              <FormGroup>
                <Label>Photo URL</Label>
                <Input type="text" value={currentMember.photoUrl || (currentMember.photo as any)?.url || ''} onChange={e => setCurrentMember({...currentMember, photoUrl: e.target.value})} />
              </FormGroup>
              <FormGroup>
                <Label>Photo Alt Text</Label>
                <Input type="text" value={currentMember.photoAlt || (currentMember.photo as any)?.altText || ''} onChange={e => setCurrentMember({...currentMember, photoAlt: e.target.value})} disabled={currentMember.photoDecorative || (currentMember.photo as any)?.isDecorative} />
              </FormGroup>
              <FormGroup className="md:col-span-2">
                <div className="flex items-center">
                  <input type="checkbox" checked={currentMember.photoDecorative || (currentMember.photo as any)?.isDecorative || false} onChange={e => setCurrentMember({...currentMember, photoDecorative: e.target.checked})} className="mr-2" />
                  <Label className="mb-0">Decorative (no alt text)</Label>
                </div>
              </FormGroup>
              <FormGroup>
                <Label>Social Link</Label>
                <Input type="text" value={currentMember.link || ''} onChange={e => setCurrentMember({...currentMember, link: e.target.value})} />
              </FormGroup>
              <FormGroup>
                <Label>Order</Label>
                <Input type="number" value={currentMember.order || 0} onChange={e => setCurrentMember({...currentMember, order: parseInt(e.target.value) || 0})} />
              </FormGroup>
            </div>
            <div className="flex gap-4 mt-6">
              <Button onClick={handleSave} variant="primary">Save</Button>
              <Button onClick={() => setIsEditing(false)} variant="ghost">Cancel</Button>
            </div>
          </div>
        )}

        <div className="grid gap-4 pb-10" ref={containerRef}>
          {members.map(member => (
            <div key={member.id} className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow border border-primary flex justify-between items-center">
              <div className="flex items-center gap-4">
                {member.photo && <img src={(member.photo as any)?.url || '/images/placeholder.png'} alt={(member.photo as any)?.isDecorative ? '' : ((member.photo as any)?.altText || member.name)} className="w-16 h-16 rounded-full object-cover" />}
                <div>
                  <div className="font-bold text-lg">{member.name}</div>
                  <div className="text-sm font-semibold text-primary">{member.role}</div>
                  <div className="text-sm mt-1 text-gray-700 dark:text-gray-300">
                    {member.bio}
                  </div>
                </div>
              </div>
              <div className="space-x-2 flex flex-col gap-2">
                <Button variant="secondary" size="sm" onClick={() => { 
                  setCurrentMember(member); 
                  setIsEditing(true); 
                }}>Edit</Button>
                <Button variant="danger" size="sm" onClick={(e) => handleDelete(member.id, e as React.MouseEvent<HTMLButtonElement>)}>Delete</Button>
              </div>
            </div>
          ))}
          {members.length === 0 && <p className="text-gray-500 dark:text-gray-400">No wedding party members found.</p>}
        </div>
      </div>
    </AdminPreviewLayout>
  );
}
