'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { motion, Variants } from 'framer-motion';
import { apiClient } from '@/lib/admin/apiClient';

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.6,
      ease: [0.22, 1, 0.36, 1] // Custom cubic-bezier for smoother feel
    }
  }
};

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
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await apiClient.post('/api/admin/login', { password });
      localStorage.setItem('isAdminLoggedIn', 'true');
      window.dispatchEvent(new Event('storage'));
      router.push('/admin/dashboard');
    } catch (err: any) {
      if (err.name === 'ApiError') {
        setError(err.message || 'Login failed.');
      } else {
        setError('Network error.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)] px-4 py-12 text-[var(--color-foreground)]">
      <motion.div
        initial="hidden"
        animate="visible"
        variants={fadeUp}
        className="w-full max-w-md"
      >
        <Link
          href="/"
          className="inline-flex items-center text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-primary transition mb-8 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-md px-2 py-1"
        >
          <Icon name="ArrowLeft" size={16} className="mr-2 transition-transform group-hover:-translate-x-1" />
          Back to home
        </Link>

        <form
          onSubmit={handleLogin}
          className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-8 sm:p-10 flex flex-col gap-6 border border-gray-100 dark:border-gray-700 relative overflow-hidden"
        >
          {/* Subtle accent line at the top */}
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-primary to-secondary" />

          <div className="text-center space-y-2">
            <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary tracking-tight py-1">
              Admin Login
            </h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              Enter your password to access the dashboard.
            </p>
          </div>

          {error && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              id="login-error"
              role="alert"
              className="text-red-500 text-sm font-medium bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 p-3 rounded-xl text-center"
            >
              {error}
            </motion.p>
          )}

          <div className="flex flex-col gap-2">
            <label htmlFor="password" className="block text-gray-700 dark:text-gray-300 font-semibold text-sm ml-1">
              Password
            </label>
            <div className="relative group">
              <input
                type={showPassword ? 'text' : 'password'}
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="border border-gray-200 dark:border-gray-600 p-4 rounded-2xl w-full focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none focus-visible:ring-offset-2 bg-gray-50/50 dark:bg-gray-700/50 text-lg text-gray-800 dark:text-gray-100 pr-12 transition-all hover:bg-gray-100 dark:hover:bg-gray-700"
                required
                autoFocus
                autoComplete="current-password"
                placeholder="••••••••"
                aria-invalid={error ? "true" : undefined}
                aria-describedby={error ? "login-error" : undefined}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-primary dark:text-gray-500 dark:hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-full p-1"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <Icon name="EyeOff" size={22} /> : <Icon name="Eye" size={22} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="w-full bg-gradient-to-r from-primary to-secondary text-white px-6 py-4 rounded-2xl font-bold text-lg shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-75 disabled:cursor-not-allowed flex items-center justify-center overflow-hidden relative"
            disabled={loading}
            aria-busy={loading}
          >
            <span className={loading ? 'opacity-0' : 'opacity-100'}>Login</span>
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Icon name="Loader2" className="animate-spin h-6 w-6" aria-hidden="true" />
              </div>
            )}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
