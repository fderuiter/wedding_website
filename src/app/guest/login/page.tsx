'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { motion, Variants } from 'framer-motion';

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.6,
      ease: [0.22, 1, 0.36, 1]
    }
  }
};

function GuestLoginForm() {
  const [passcode, setPasscode] = useState('');
  const [showPasscode, setShowPasscode] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/guest/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Incorrect passcode. Please try again.');
      } else {
        const callbackUrl = searchParams.get('callbackUrl') || '/';
        router.push(callbackUrl);
      }
    } catch (err: any) {
      setError('A connection error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={handleLogin}
      className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-8 sm:p-10 flex flex-col gap-6 border border-gray-100 dark:border-gray-700 relative overflow-hidden"
    >
      <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-primary to-secondary" />

      <div className="text-center space-y-2">
        <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary dark:from-primary-light dark:to-secondary-light tracking-tight py-1">
          Guest Portal
        </h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm">
          Please enter the passcode shared on your invitation to access logistics and schedules.
        </p>
      </div>

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
        <label htmlFor="passcode" className="block text-gray-700 dark:text-gray-300 font-semibold text-sm ml-1">
          Guest Passcode
        </label>
        <div className="relative group">
          <input
            type={showPasscode ? 'text' : 'password'}
            id="passcode"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            className="border border-gray-200 dark:border-gray-400 p-4 rounded-2xl w-full focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none focus-visible:ring-offset-2 bg-gray-50/50 dark:bg-gray-700/50 text-lg text-gray-800 dark:text-gray-100 pr-12 transition-all hover:bg-gray-100 dark:hover:bg-gray-700"
            required
            autoComplete="off"
            placeholder="Enter passcode"
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? 'login-error' : undefined}
          />
          <button
            type="button"
            onClick={() => setShowPasscode(!showPasscode)}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-primary dark:text-gray-400 dark:hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-full p-1"
            aria-label={showPasscode ? 'Hide passcode' : 'Show passcode'}
          >
            {showPasscode ? <Icon name="EyeOff" size={22} /> : <Icon name="Eye" size={22} />}
          </button>
        </div>
      </div>

      <button
        type="submit"
        className="w-full bg-primary bg-gradient-to-r from-primary to-secondary text-white px-6 py-4 rounded-2xl font-bold text-lg shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-75 disabled:cursor-not-allowed flex items-center justify-center overflow-hidden relative"
        disabled={loading}
        aria-busy={loading}
      >
        <span className={loading ? 'opacity-0' : 'opacity-100'}>Access Portal</span>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Icon name="Loader2" className="animate-spin h-6 w-6" aria-hidden="true" />
          </div>
        )}
      </button>
    </form>
  );
}

export default function GuestLoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)] px-4 py-12 text-[var(--color-foreground)]">
      <motion.div
        initial="hidden"
        animate="visible"
        variants={fadeUp}
        className="w-full max-w-md"
      >
        <Suspense fallback={
          <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-8 sm:p-10 flex flex-col gap-6 border border-gray-100 dark:border-gray-700 relative overflow-hidden items-center justify-center min-h-[300px]">
            <Icon name="Loader2" className="animate-spin h-10 w-10 text-primary" />
          </div>
        }>
          <GuestLoginForm />
        </Suspense>
      </motion.div>
    </div>
  );
}
