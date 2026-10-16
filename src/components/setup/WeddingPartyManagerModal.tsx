'use client';

import React, { useState } from 'react';
import type { WeddingPartyMemberDTO } from '@/features/wedding-party';
import { useAdminWeddingParty } from '@/hooks/admin/useAdminWeddingParty';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { FormGroup, Label, Input, Textarea, Checkbox, Select } from '@/components/ui/forms';
import { useToast } from '@/components/ui/ToastProvider';

interface WeddingPartyManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function WeddingPartyManagerModal({ isOpen, onClose }: WeddingPartyManagerModalProps) {
  let toastConfirm: ((msg: string) => Promise<boolean>) | null = null;
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

  const handleStartAdd = () => {
    setCurrentMember({ name: '', role: '', bio: '', side: undefined, photoUrl: '', link: '', order: 0 });
    setIsEditing(true);
  };

  const handleStartEdit = (member: WeddingPartyMemberDTO) => {
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
          <form onSubmit={handleSave} className="bg-gray-50 dark:bg-zinc-800/60 p-4 rounded-lg border border-gray-200 dark:border-zinc-700 space-y-4">
            <h3 className="font-semibold text-lg">
              {currentMember.id ? 'Edit Member' : 'Add New Member'}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormGroup>
                <Label htmlFor="memberName">Name</Label>
                <Input
                  id="memberName"
                  type="text"
                  value={currentMember.name || ''}
                  onChange={(e) => setCurrentMember({ ...currentMember, name: e.target.value })}
                  required
                />
              </FormGroup>
              <FormGroup>
                <Label htmlFor="memberRole">Role</Label>
                <Input
                  id="memberRole"
                  type="text"
                  value={currentMember.role || ''}
                  onChange={(e) => setCurrentMember({ ...currentMember, role: e.target.value })}
                  required
                />
              </FormGroup>
              <FormGroup>
                <Label htmlFor="memberSide">Side</Label>
                <Select
                  id="memberSide"
                  value={currentMember.side || ''}
                  onChange={(e) => setCurrentMember({ ...currentMember, side: (e.target.value || null) as any })}
                >
                  <option value="">None / Joint</option>
                  <option value="BRIDE">Bride</option>
                  <option value="GROOM">Groom</option>
                  <option value="JOINT">Joint</option>
                </Select>
              </FormGroup>
              <FormGroup className="md:col-span-2">
                <Label htmlFor="memberBio">Bio</Label>
                <Textarea
                  id="memberBio"
                  value={currentMember.bio || ''}
                  onChange={(e) => setCurrentMember({ ...currentMember, bio: e.target.value })}
                />
              </FormGroup>
              <FormGroup>
                <Label htmlFor="memberPhotoUrl">Photo URL</Label>
                <Input
                  id="memberPhotoUrl"
                  type="text"
                  value={currentMember.photoUrl || (currentMember.photo as any)?.url || ''}
                  onChange={(e) => setCurrentMember({ ...currentMember, photoUrl: e.target.value })}
                />
              </FormGroup>
              <FormGroup>
                <Label htmlFor="memberPhotoAlt">Photo Alt Text</Label>
                <Input
                  id="memberPhotoAlt"
                  type="text"
                  value={currentMember.photoAlt || (currentMember.photo as any)?.altText || ''}
                  onChange={(e) => setCurrentMember({ ...currentMember, photoAlt: e.target.value })}
                  disabled={currentMember.photoDecorative || (currentMember.photo as any)?.isDecorative}
                />
              </FormGroup>
              <FormGroup className="md:col-span-2">
                <div className="flex items-center">
                  <Checkbox
                    id="memberPhotoDecorative"
                    checked={currentMember.photoDecorative || (currentMember.photo as any)?.isDecorative || false}
                    onChange={(e) => setCurrentMember({ ...currentMember, photoDecorative: e.target.checked })}
                    className="mr-2"
                  />
                  <Label htmlFor="memberPhotoDecorative" className="mb-0">
                    Decorative (no alt text)
                  </Label>
                </div>
              </FormGroup>
              <FormGroup>
                <Label htmlFor="memberLink">Social Link</Label>
                <Input
                  id="memberLink"
                  type="text"
                  value={currentMember.link || ''}
                  onChange={(e) => setCurrentMember({ ...currentMember, link: e.target.value })}
                />
              </FormGroup>
              <FormGroup>
                <Label htmlFor="memberOrder">Display Order</Label>
                <Input
                  id="memberOrder"
                  type="number"
                  value={currentMember.order || 0}
                  onChange={(e) => setCurrentMember({ ...currentMember, order: parseInt(e.target.value, 10) || 0 })}
                />
              </FormGroup>
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <Button type="button" variant="ghost" onClick={() => setIsEditing(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? 'Saving...' : 'Save Member'}
              </Button>
            </div>
          </form>
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
                <div
                  key={member.id}
                  className="bg-white dark:bg-zinc-800 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-zinc-700 flex justify-between items-center gap-4"
                >
                  <div className="flex items-center gap-3">
                    {member.photo && (
                      <img
                        src={(member.photo as any)?.url || '/images/placeholder.png'}
                        alt={(member.photo as any)?.isDecorative ? '' : ((member.photo as any)?.altText || member.name)}
                        className="w-12 h-12 rounded-full object-cover bg-gray-100"
                      />
                    )}
                    <div>
                      <div className="font-semibold text-gray-900 dark:text-gray-100">
                        {member.name}
                      </div>
                      <div className="text-xs text-primary font-medium">{member.role}</div>
                      {member.bio && (
                        <div className="text-xs text-gray-600 dark:text-gray-400 line-clamp-1 mt-0.5">
                          {member.bio}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-label={`Edit wedding party member: ${member.name}`}
                      disabled={member.id.startsWith('temp-')}
                      onClick={() => handleStartEdit(member)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      aria-label={`Delete wedding party member: ${member.name}`}
                      disabled={member.id.startsWith('temp-')}
                      onClick={() => handleDelete(member.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
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
