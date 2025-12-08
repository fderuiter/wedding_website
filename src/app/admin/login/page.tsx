'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * @page LoginPage
 * @description The login page for administrators.
 *
 * This client component provides a form for an administrator to enter a password.
 * On submission, it sends the password to the `/api/admin/login` endpoint.
 * If the login is successful, the user is redirected to the admin dashboard.
 * Otherwise, an error message is displayed.
 *
 * @returns {JSX.Element} The rendered login page.
 */
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
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)] px-2 text-[var(--color-foreground)]">
      <form onSubmit={handleLogin} className="w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-8 sm:p-10 flex flex-col gap-6 border border-rose-100 dark:border-gray-700">
        <h1 className="text-3xl font-extrabold text-center text-rose-700 mb-2 tracking-tight">Admin Login</h1>
        {error && <p className="text-red-500 text-sm text-center -mt-2">{error}</p>}
        <div className="flex flex-col gap-2">
          <label htmlFor="password" className="block text-gray-700 dark:text-gray-300 font-semibold">Password</label>
          <input
            type="password"
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="border border-gray-300 dark:border-gray-600 p-3 rounded-lg w-full focus:ring-2 focus:ring-rose-300 outline-none bg-white dark:bg-gray-700 text-lg text-gray-800 dark:text-gray-100"
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
