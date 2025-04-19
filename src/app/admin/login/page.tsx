'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.push('/admin/dashboard');
      } else {
        const data = await res.json();
        setError(data.error || 'Login failed.');
      }
    } catch {
      setError('Network error.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#fffdfc] px-2">
      <form onSubmit={handleLogin} className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8 sm:p-10 flex flex-col gap-6 border border-rose-100">
        <h1 className="text-3xl font-extrabold text-center text-rose-700 mb-2 tracking-tight">Admin Login</h1>
        {error && <p className="text-red-500 text-sm text-center -mt-2">{error}</p>}
        <div className="flex flex-col gap-2">
          <label htmlFor="password" className="block text-gray-700 font-semibold">Password</label>
          <input
            type="password"
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="border border-gray-300 p-3 rounded-lg w-full focus:ring-2 focus:ring-rose-300 outline-none bg-white text-lg"
            required
            autoFocus
            autoComplete="current-password"
            placeholder="Enter admin password"
          />
        </div>
        <button
          type="submit"
          className="w-full bg-rose-700 text-white px-6 py-3 rounded-lg font-bold text-lg shadow-md hover:bg-rose-800 transition focus:outline-none focus:ring-2 focus:ring-rose-300 disabled:opacity-60"
          disabled={loading}
        >
          {loading ? 'Logging in...' : 'Login'}
        </button>
      </form>
    </div>
  );
}