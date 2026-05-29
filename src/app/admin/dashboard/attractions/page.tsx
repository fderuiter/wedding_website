"use client";
import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { checkAdminClient } from '@/utils/adminAuth.client';
import { Attraction } from '@prisma/client';

export default function AttractionsDashboardPage() {
  const router = useRouter();
  const [attractions, setAttractions] = useState<Attraction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [currentAttraction, setCurrentAttraction] = useState<Partial<Attraction>>({});

  useEffect(() => {
    async function checkAuthAndFetch() {
      const isAdmin = await checkAdminClient();
      if (!isAdmin) {
        router.replace('/admin/login');
        return;
      }
      fetchAttractions();
    }
    checkAuthAndFetch();
  }, [router]);

  const fetchAttractions = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/attractions');
      if (!res.ok) throw new Error('Failed to fetch attractions');
      const data = await res.json();
      setAttractions(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      const url = currentAttraction.id ? `/api/admin/attractions/${currentAttraction.id}` : '/api/admin/attractions';
      const method = currentAttraction.id ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentAttraction)
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to save attraction');
      }

      setIsEditing(false);
      fetchAttractions();
    } catch (e: any) {
      alert(e.message || 'Error saving attraction');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this attraction?')) return;
    try {
      const res = await fetch(`/api/admin/attractions/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete attraction');
      setAttractions((prev) => prev.filter((i) => i.id !== id));
    } catch (e: any) {
      alert(e.message || 'Error deleting attraction');
    }
  };

  if (loading) return <main className="min-h-screen flex items-center justify-center"><p>Loading...</p></main>;
  if (error) return <main className="min-h-screen flex items-center justify-center"><p className="text-red-500">Error: {error}</p></main>;

  return (
    <main className="min-h-screen bg-[var(--color-background)] text-[var(--color-foreground)] py-10 px-4 sm:px-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-extrabold text-rose-700">Attractions Studio</h1>
          <div>
            <button onClick={() => router.push('/admin/dashboard')} className="mr-4 px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 transition">Back to Dashboard</button>
            <button onClick={() => { 
              setCurrentAttraction({ name: '', description: '', image: '', category: 'food', website: '', directions: '', latitude: 0, longitude: 0, isVisible: true }); 
              setIsEditing(true); 
            }} className="px-4 py-2 bg-rose-600 text-white rounded hover:bg-rose-700 transition">Add New Attraction</button>
          </div>
        </div>

        {isEditing && (
          <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg mb-8 border border-rose-100 dark:border-gray-700">
            <h2 className="text-2xl font-bold mb-4">{currentAttraction.id ? 'Edit' : 'Create'} Attraction</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-semibold mb-1">Name</label>
                <input type="text" className="w-full border rounded p-2 text-black" value={currentAttraction.name || ''} onChange={e => setCurrentAttraction({...currentAttraction, name: e.target.value})} />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Category</label>
                <select className="w-full border rounded p-2 text-black" value={currentAttraction.category || 'food'} onChange={e => setCurrentAttraction({...currentAttraction, category: e.target.value})}>
                  <option value="food">Food</option>
                  <option value="coffee">Coffee</option>
                  <option value="park">Park</option>
                  <option value="museum">Museum</option>
                  <option value="hotel">Hotel</option>
                  <option value="venue">Venue</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-semibold mb-1">Description</label>
                <textarea className="w-full border rounded p-2 text-black" value={currentAttraction.description || ''} onChange={e => setCurrentAttraction({...currentAttraction, description: e.target.value})} />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Image URL</label>
                <input type="text" className="w-full border rounded p-2 text-black" value={currentAttraction.image || ''} onChange={e => setCurrentAttraction({...currentAttraction, image: e.target.value})} />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Website URL</label>
                <input type="text" className="w-full border rounded p-2 text-black" value={currentAttraction.website || ''} onChange={e => setCurrentAttraction({...currentAttraction, website: e.target.value})} />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Directions URL</label>
                <input type="text" className="w-full border rounded p-2 text-black" value={currentAttraction.directions || ''} onChange={e => setCurrentAttraction({...currentAttraction, directions: e.target.value})} />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1 flex items-center gap-2">
                  <input type="checkbox" checked={currentAttraction.isVisible !== false} onChange={e => setCurrentAttraction({...currentAttraction, isVisible: e.target.checked})} />
                  Is Visible
                </label>
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Latitude</label>
                <input type="number" step="any" className="w-full border rounded p-2 text-black" value={currentAttraction.latitude || 0} onChange={e => setCurrentAttraction({...currentAttraction, latitude: parseFloat(e.target.value)})} />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Longitude</label>
                <input type="number" step="any" className="w-full border rounded p-2 text-black" value={currentAttraction.longitude || 0} onChange={e => setCurrentAttraction({...currentAttraction, longitude: parseFloat(e.target.value)})} />
              </div>
            </div>
            <div className="flex gap-4 mt-6">
              <button onClick={handleSave} className="bg-green-600 text-white px-4 py-2 rounded font-bold">Save</button>
              <button onClick={() => setIsEditing(false)} className="bg-gray-400 text-white px-4 py-2 rounded">Cancel</button>
            </div>
          </div>
        )}

        <div className="grid gap-4">
          {attractions.map(attraction => (
            <div key={attraction.id} className={`bg-white dark:bg-gray-800 p-4 rounded-xl shadow border border-rose-100 flex justify-between items-center ${!attraction.isVisible ? 'opacity-50' : ''}`}>
              <div className="flex items-center gap-4">
                {attraction.image && <img src={attraction.image} alt={attraction.name} className="w-16 h-16 rounded-lg object-cover" />}
                <div>
                  <div className="font-bold text-lg">{attraction.name} {!attraction.isVisible && <span className="text-red-500 text-sm">(Hidden)</span>}</div>
                  <div className="text-sm font-semibold text-amber-600 uppercase">{attraction.category}</div>
                  <div className="text-sm mt-1 text-gray-700 dark:text-gray-300">
                    {attraction.description}
                  </div>
                </div>
              </div>
              <div className="space-x-2 flex flex-col gap-2">
                <button onClick={() => { 
                  setCurrentAttraction(attraction); 
                  setIsEditing(true); 
                }} className="bg-amber-500 text-white px-3 py-1 rounded text-sm">Edit</button>
                <button onClick={() => handleDelete(attraction.id)} className="bg-rose-600 text-white px-3 py-1 rounded text-sm">Delete</button>
              </div>
            </div>
          ))}
          {attractions.length === 0 && <p className="text-gray-500">No attractions found.</p>}
        </div>
      </div>
    </main>
  );
}
