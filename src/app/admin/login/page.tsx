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
    } catch (err) {
      setError('Network error.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-yellow-50 to-red-50 dark:from-gray-900 dark:to-gray-800 px-2">
      <form onSubmit={handleLogin} className="w-full max-w-md bg-white/90 dark:bg-gray-900/90 rounded-2xl shadow-2xl p-8 sm:p-10 flex flex-col gap-6 border border-yellow-100 dark:border-yellow-800">
        <h1 className="text-3xl font-extrabold text-center text-primary-700 dark:text-yellow-300 mb-2 tracking-tight">Admin Login</h1>
        {error && <p className="text-red-500 text-sm text-center -mt-2">{error}</p>}
        <div className="flex flex-col gap-2">
          <label htmlFor="password" className="block text-gray-700 dark:text-yellow-200 font-semibold">Password</label>
          <input
            type="password"
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="border border-yellow-200 dark:border-yellow-800 p-3 rounded-lg w-full focus:ring-2 focus:ring-primary-300 outline-none bg-white dark:bg-gray-800 text-lg"
            required
            autoFocus
            autoComplete="current-password"
            placeholder="Enter admin password"
          />
        </div>
        <button
          type="submit"
          className="w-full bg-primary-700 dark:bg-yellow-400 text-white dark:text-gray-900 px-6 py-3 rounded-lg font-bold text-lg shadow-md hover:bg-primary-800 dark:hover:bg-yellow-300 transition focus:outline-none focus:ring-2 focus:ring-primary-300 disabled:opacity-60"
          disabled={loading}
        >
          {loading ? 'Logging in...' : 'Login'}
        </button>
      </form>
    </div>
  );
}