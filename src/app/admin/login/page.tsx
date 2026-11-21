'use client';

import { Suspense, useState } from 'react';
import * as nextNavigation from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { motion, Variants } from 'framer-motion';
// eslint-disable-next-line no-restricted-imports
import { apiClient } from '@/features/admin/apiClient';
import { ApiError } from '@/lib/apiClient';

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.6,
      ease: [0.22, 1, 0.36, 1],
    },
  },
};

function useOptionalResetToken(): string {
  const searchParamsHook =
    typeof nextNavigation.useSearchParams === 'function'
      ? nextNavigation.useSearchParams
      : null;
  const hookParams = searchParamsHook ? searchParamsHook() : null;
  const fromHook = hookParams?.get('token')?.trim();
  if (fromHook) {
    return fromHook;
  }
  if (typeof window !== 'undefined' && window.location?.search) {
    return new URLSearchParams(window.location.search).get('token')?.trim() || '';
  }
  return '';
}

function AdminLoginContent() {
  const urlToken = useOptionalResetToken();
  const [tokenDismissed, setTokenDismissed] = useState(false);
  const activeToken = tokenDismissed ? '' : urlToken;

  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const router = nextNavigation.useRouter();

  const effectiveMode: 'login' | 'forgot' | 'confirm' = activeToken ? 'confirm' : mode;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setStatusMessage('');
    setLoading(true);
    try {
      await apiClient.post('/api/admin/login', { password });
      localStorage.setItem('isAdminLoggedIn', 'true');
      window.dispatchEvent(new Event('storage'));
      router.push('/admin/dashboard');
    } catch (err: any) {
      if (err instanceof ApiError) {
        setError(err.message || 'Login failed.');
      } else {
        setError('Network error.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setStatusMessage('');
    setLoading(true);
    try {
      const response = await apiClient.post<{ success: boolean; message?: string }>(
        '/api/admin/password-reset/request',
        {}
      );
      setStatusMessage(
        response?.message ||
          'If an administrative contact email and email provider are configured, a password reset link valid for 30 minutes has been sent.'
      );
    } catch (err: any) {
      if (err instanceof ApiError) {
        setError(err.message || 'Unable to request password reset.');
      } else {
        setError('Network error.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setStatusMessage('');

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }

    setLoading(true);
    try {
      const response = await apiClient.post<{ success: boolean; message?: string }>(
        '/api/admin/password-reset/confirm',
        {
          token: activeToken,
          newPassword,
          confirmPassword,
        }
      );
      setNewPassword('');
      setConfirmPassword('');
      setTokenDismissed(true);
      setMode('login');
      setStatusMessage(
        response?.message ||
          'Admin password has been reset. You can now sign in with your new password.'
      );
      if (typeof router?.replace === 'function') {
        router.replace('/admin/login');
      }
    } catch (err: any) {
      if (err instanceof ApiError) {
        setError(err.message || 'Invalid or expired reset link.');
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
          className="inline-flex items-center text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-primary transition mb-8 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-md px-2 py-1"
        >
          <Icon name="ArrowLeft" size={16} className="mr-2 transition-transform group-hover:-translate-x-1" />
          Back to home
        </Link>

        {effectiveMode === 'login' && (
          <form
            onSubmit={handleLogin}
            className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-8 sm:p-10 flex flex-col gap-6 border border-gray-100 dark:border-gray-700 relative overflow-hidden"
          >
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-primary to-secondary" />

            <div className="text-center space-y-2">
              <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary dark:from-primary-light dark:to-secondary-light tracking-tight py-1">
                Admin Login
              </h1>
              <p className="text-gray-500 dark:text-gray-400 text-sm">
                Enter your password to access the dashboard.
              </p>
            </div>

            {statusMessage && (
              <p
                role="status"
                className="text-emerald-800 dark:text-emerald-200 text-sm font-medium bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 p-3 rounded-xl text-center"
              >
                {statusMessage}
              </p>
            )}

            {error && (
              <motion.p
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                id="login-error"
                role="alert"
                className="text-red-600 dark:text-primary-text text-sm font-medium bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 p-3 rounded-xl text-center"
              >
                {error}
              </motion.p>
            )}

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between ml-1">
                <label htmlFor="password" className="block text-gray-700 dark:text-gray-300 font-semibold text-sm">
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setError('');
                    setStatusMessage('');
                    setMode('forgot');
                  }}
                  className="text-xs font-medium text-gray-700 dark:text-gray-300 hover:text-primary dark:hover:text-primary-light underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded px-1 py-0.5"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative group">
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="border border-gray-200 dark:border-gray-400 p-4 rounded-2xl w-full focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none focus-visible:ring-offset-2 bg-gray-50/50 dark:bg-gray-700/50 text-lg text-gray-800 dark:text-gray-100 pr-12 transition-all hover:bg-gray-100 dark:hover:bg-gray-700"
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  aria-invalid={error ? 'true' : undefined}
                  aria-describedby={error ? 'login-error' : undefined}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-primary dark:text-gray-400 dark:hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-full p-1"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <Icon name="EyeOff" size={22} /> : <Icon name="Eye" size={22} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="w-full bg-primary bg-gradient-to-r from-primary to-secondary text-white px-6 py-4 rounded-2xl font-bold text-lg shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-75 disabled:cursor-not-allowed flex items-center justify-center overflow-hidden relative"
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
        )}

        {effectiveMode === 'forgot' && (
          <form
            onSubmit={handleRequestReset}
            className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-8 sm:p-10 flex flex-col gap-6 border border-gray-100 dark:border-gray-700 relative overflow-hidden"
          >
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-primary to-secondary" />

            <div className="text-center space-y-2">
              <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary dark:from-primary-light dark:to-secondary-light tracking-tight py-1">
                Reset Admin Password
              </h1>
              <p className="text-gray-500 dark:text-gray-400 text-sm">
                Send a single-use 30-minute recovery link to the configured host contact email address.
              </p>
            </div>

            {statusMessage && (
              <p
                role="status"
                className="text-emerald-800 dark:text-emerald-200 text-sm font-medium bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 p-3 rounded-xl text-center"
              >
                {statusMessage}
              </p>
            )}

            {error && (
              <p
                id="reset-request-error"
                role="alert"
                className="text-red-600 dark:text-primary-text text-sm font-medium bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 p-3 rounded-xl text-center"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              className="w-full bg-primary bg-gradient-to-r from-primary to-secondary text-white px-6 py-4 rounded-2xl font-bold text-lg shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-75 disabled:cursor-not-allowed flex items-center justify-center overflow-hidden relative"
              disabled={loading}
              aria-busy={loading}
            >
              <span className={loading ? 'opacity-0' : 'opacity-100'}>Send Reset Link</span>
              {loading && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Icon name="Loader2" className="animate-spin h-6 w-6" aria-hidden="true" />
                </div>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setError('');
                setStatusMessage('');
                setMode('login');
              }}
              className="text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-primary dark:hover:text-primary-light transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md py-1"
            >
              Back to sign in
            </button>
          </form>
        )}

        {effectiveMode === 'confirm' && (
          <form
            onSubmit={handleConfirmReset}
            className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-8 sm:p-10 flex flex-col gap-6 border border-gray-100 dark:border-gray-700 relative overflow-hidden"
          >
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-primary to-secondary" />

            <div className="text-center space-y-2">
              <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary dark:from-primary-light dark:to-secondary-light tracking-tight py-1">
                Set New Password
              </h1>
              <p className="text-gray-500 dark:text-gray-400 text-sm">
                Choose a new administrator password (minimum 8 characters).
              </p>
            </div>

            {error && (
              <div className="space-y-2">
                <p
                  id="reset-confirm-error"
                  role="alert"
                  className="text-red-600 dark:text-primary-text text-sm font-medium bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 p-3 rounded-xl text-center"
                >
                  {error}
                </p>
                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setError('');
                      setTokenDismissed(true);
                      setMode('forgot');
                      if (typeof router?.replace === 'function') {
                        router.replace('/admin/login');
                      }
                    }}
                    className="text-xs font-medium text-gray-700 dark:text-gray-300 hover:text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded px-2 py-1"
                  >
                    Request a new reset link
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <label htmlFor="reset-new-password" className="block text-gray-700 dark:text-gray-300 font-semibold text-sm ml-1">
                New Password
              </label>
              <div className="relative group">
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  id="reset-new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="border border-gray-200 dark:border-gray-400 p-4 rounded-2xl w-full focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none focus-visible:ring-offset-2 bg-gray-50/50 dark:bg-gray-700/50 text-lg text-gray-800 dark:text-gray-100 pr-12 transition-all hover:bg-gray-100 dark:hover:bg-gray-700"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="Minimum 8 characters"
                  aria-invalid={error ? 'true' : undefined}
                  aria-describedby={error ? 'reset-confirm-error' : undefined}
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-primary dark:text-gray-400 dark:hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-full p-1"
                  aria-label={showNewPassword ? 'Hide new password' : 'Show new password'}
                >
                  {showNewPassword ? <Icon name="EyeOff" size={22} /> : <Icon name="Eye" size={22} />}
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="reset-confirm-password" className="block text-gray-700 dark:text-gray-300 font-semibold text-sm ml-1">
                Confirm New Password
              </label>
              <div className="relative group">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  id="reset-confirm-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="border border-gray-200 dark:border-gray-400 p-4 rounded-2xl w-full focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none focus-visible:ring-offset-2 bg-gray-50/50 dark:bg-gray-700/50 text-lg text-gray-800 dark:text-gray-100 pr-12 transition-all hover:bg-gray-100 dark:hover:bg-gray-700"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="Re-enter new password"
                  aria-invalid={error ? 'true' : undefined}
                  aria-describedby={error ? 'reset-confirm-error' : undefined}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-primary dark:text-gray-400 dark:hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-full p-1"
                  aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                >
                  {showConfirmPassword ? <Icon name="EyeOff" size={22} /> : <Icon name="Eye" size={22} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="w-full bg-primary bg-gradient-to-r from-primary to-secondary text-white px-6 py-4 rounded-2xl font-bold text-lg shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-75 disabled:cursor-not-allowed flex items-center justify-center overflow-hidden relative"
              disabled={loading}
              aria-busy={loading}
            >
              <span className={loading ? 'opacity-0' : 'opacity-100'}>Reset Password</span>
              {loading && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Icon name="Loader2" className="animate-spin h-6 w-6" aria-hidden="true" />
                </div>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setError('');
                setTokenDismissed(true);
                setMode('login');
                if (typeof router?.replace === 'function') {
                  router.replace('/admin/login');
                }
              }}
              className="text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-primary dark:hover:text-primary-light transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md py-1"
            >
              Back to sign in
            </button>
          </form>
        )}
      </motion.div>
    </div>
  );
}

/**
 * @page LoginPage
 * @description The login and stateless password recovery page for administrators.
 *
 * @returns {JSX.Element} The rendered login page wrapped in Suspense for search param safety.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <AdminLoginContent />
    </Suspense>
  );
}
