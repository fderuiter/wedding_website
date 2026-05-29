"use client";
import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { checkAdminClient } from '@/utils/adminAuth.client';
import { WeddingPartyMember } from '@prisma/client';

import AdminPreviewLayout from "@/components/admin/AdminPreviewLayout";

export default function WeddingPartyDashboardPage() {
  const router = useRouter();
  const [members, setMembers] = useState<WeddingPartyMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [currentMember, setCurrentMember] = useState<Partial<WeddingPartyMember>>({});

  useEffect(() => {
    async function checkAuthAndFetch() {
      const isAdmin = await checkAdminClient();
      if (!isAdmin) {
        router.replace('/admin/login');
        return;
      }
      fetchMembers();
    }
    checkAuthAndFetch();
  }, [router]);

  const fetchMembers = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/wedding-party');
      if (!res.ok) throw new Error('Failed to fetch members');
      const data = await res.json();
      setMembers(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      const url = currentMember.id ? `/api/admin/wedding-party/${currentMember.id}` : '/api/admin/wedding-party';
      const method = currentMember.id ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentMember)
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to save member');
      }

      setIsEditing(false);
      fetchMembers();
    } catch (e: any) {
      alert(e.message || 'Error saving member');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this member?')) return;
    try {
      const res = await fetch(`/api/admin/wedding-party/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete member');
      setMembers((prev) => prev.filter((i) => i.id !== id));
    } catch (e: any) {
      alert(e.message || 'Error deleting member');
    }
  };

  if (loading) return <main className="min-h-screen flex items-center justify-center"><p>Loading...</p></main>;
  if (error) return <main className="min-h-screen flex items-center justify-center"><p className="text-red-500">Error: {error}</p></main>;

  const draftMember = {
    id: currentMember.id || 'draft',
    name: currentMember.name || '',
    role: currentMember.role || '',
    bio: currentMember.bio || '',
    photo: currentMember.photo || '',
    link: currentMember.link || '',
    order: currentMember.order || 0,
  };

  const currentMembersWithDraft = members.map(m => m.id === currentMember.id ? draftMember : m);
  if (!currentMember.id && isEditing) {
    currentMembersWithDraft.push(draftMember as WeddingPartyMember);
  }
  
  // Sort by order so preview looks right
  currentMembersWithDraft.sort((a, b) => a.order - b.order);

  return (
    <AdminPreviewLayout
      previewUrl="/archive/wedding-party"
      draftType="wedding-party"
      draftData={currentMembersWithDraft}
      entityId={currentMember.id}
      onRestore={() => {
        setIsEditing(false);
        fetchMembers();
      }}
    >
      <div className="py-10 px-4 sm:px-6 max-w-5xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-extrabold text-rose-700">Wedding Party Studio</h1>
          <div>
            <button onClick={() => router.push('/admin/dashboard')} className="mr-4 px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 transition">Back to Dashboard</button>
            <button onClick={() => { 
              setCurrentMember({ name: '', role: '', bio: '', photo: '', link: '', order: 0 }); 
              setIsEditing(true); 
            }} className="px-4 py-2 bg-rose-600 text-white rounded hover:bg-rose-700 transition">Add New Member</button>
          </div>
        </div>

        {isEditing && (
          <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg mb-8 border border-rose-100 dark:border-gray-700">
            <h2 className="text-2xl font-bold mb-4">{currentMember.id ? 'Edit' : 'Create'} Member</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-semibold mb-1">Name</label>
                <input type="text" className="w-full border rounded p-2 text-black" value={currentMember.name || ''} onChange={e => setCurrentMember({...currentMember, name: e.target.value})} />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Role</label>
                <input type="text" className="w-full border rounded p-2 text-black" value={currentMember.role || ''} onChange={e => setCurrentMember({...currentMember, role: e.target.value})} />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-semibold mb-1">Bio</label>
                <textarea className="w-full border rounded p-2 text-black" value={currentMember.bio || ''} onChange={e => setCurrentMember({...currentMember, bio: e.target.value})} />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Photo URL</label>
                <input type="text" className="w-full border rounded p-2 text-black" value={currentMember.photo || ''} onChange={e => setCurrentMember({...currentMember, photo: e.target.value})} />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Social Link</label>
                <input type="text" className="w-full border rounded p-2 text-black" value={currentMember.link || ''} onChange={e => setCurrentMember({...currentMember, link: e.target.value})} />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Order</label>
                <input type="number" className="w-full border rounded p-2 text-black" value={currentMember.order || 0} onChange={e => setCurrentMember({...currentMember, order: parseInt(e.target.value) || 0})} />
              </div>
            </div>
            <div className="flex gap-4 mt-6">
              <button onClick={handleSave} className="bg-green-600 text-white px-4 py-2 rounded font-bold">Save</button>
              <button onClick={() => setIsEditing(false)} className="bg-gray-400 text-white px-4 py-2 rounded">Cancel</button>
            </div>
          </div>
        )}

        <div className="grid gap-4 pb-10">
          {members.map(member => (
            <div key={member.id} className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow border border-rose-100 flex justify-between items-center">
              <div className="flex items-center gap-4">
                {member.photo && <img src={member.photo} alt={member.name} className="w-16 h-16 rounded-full object-cover" />}
                <div>
                  <div className="font-bold text-lg">{member.name}</div>
                  <div className="text-sm font-semibold text-rose-600">{member.role}</div>
                  <div className="text-sm mt-1 text-gray-700 dark:text-gray-300">
                    {member.bio}
                  </div>
                </div>
              </div>
              <div className="space-x-2 flex flex-col gap-2">
                <button onClick={() => { 
                  setCurrentMember(member); 
                  setIsEditing(true); 
                }} className="bg-amber-500 text-white px-3 py-1 rounded text-sm">Edit</button>
                <button onClick={() => handleDelete(member.id)} className="bg-rose-600 text-white px-3 py-1 rounded text-sm">Delete</button>
              </div>
            </div>
          ))}
          {members.length === 0 && <p className="text-gray-500">No wedding party members found.</p>}
        </div>
      </div>
    </AdminPreviewLayout>
  );
}
