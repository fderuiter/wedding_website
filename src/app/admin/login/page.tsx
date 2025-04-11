'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // In a real app, you'd make an API call to verify the password.
    // For simplicity, we compare against an environment variable directly on the client.
    // This is NOT secure for production but matches the plan's simplicity.
    // A better approach would be an API route for login.
    if (password === process.env.NEXT_PUBLIC_ADMIN_PASSWORD) {
      // Store a simple session flag in localStorage
      localStorage.setItem('isAdminLoggedIn', 'true');
      router.push('/registry/add-item'); // Corrected path
    } else {
      setError('Incorrect password.');
    }
  };

  // IMPORTANT: Expose the password to the client like this is insecure.
  // This is only for demonstration based on the plan's simplicity.
  // You MUST add NEXT_PUBLIC_ADMIN_PASSWORD to your .env.local file.
  if (!process.env.NEXT_PUBLIC_ADMIN_PASSWORD) {
      return <p className="text-red-500 text-center mt-10">Admin password environment variable (NEXT_PUBLIC_ADMIN_PASSWORD) is not set.</p>;
  }


  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <form onSubmit={handleLogin} className="bg-white p-8 rounded shadow-md w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-6 text-center">Admin Login</h1>
        {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
        <div className="mb-4">
          <label htmlFor="password" className="block text-gray-700 mb-2">Password:</label>
          <input
            type="password"
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="border p-2 rounded w-full focus:ring-2 focus:ring-blue-300 outline-none"
            required
          />
        </div>
        <button
          type="submit"
          className="w-full bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition"
        >
          Login
        </button>
      </form>
    </div>
  );
}