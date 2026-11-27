'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { FormGroup, FormMessage, Input, Label } from '@/components/ui/forms';
import { Icon } from '@/components/ui/Icon';
import { motion, Variants } from 'framer-motion';
import { useTheme } from '@/components/ThemeProvider';
import { Overlay } from '@/components/ui/Overlay';
import { GuestSignInLinkRecovery } from '@/components/guest/GuestSignInLinkRecovery';
import { useGuestLoginMachine } from '@/hooks/useGuestLoginMachine';
import { withBasePath } from '@/lib/basePath';

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

function getSafeMailtoUrl(email: string | null | undefined): string | null {
  if (!email || typeof email !== 'string') {
    return null;
  }
  const trimmed = email.trim();
  if (!trimmed || trimmed.toLowerCase() === 'hosts@wedding.example') {
    return null;
  }
  const isValidEmail = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(trimmed);
  if (!isValidEmail) {
    return null;
  }
  return `mailto:${trimmed}?subject=Guest%20Portal%20Sign-In%20Help`;
}

function GuestLoginForm() {
  const { contactEmail, isMessagingActive } = useTheme();
  const {
    passcode,
    showPasscode,
    error,
    loading,
    showHelp,
    isLoginDisabled,
    passcodeInputRef,
    handleLogin,
    setPasscode,
    setShowPasscode,
    setShowHelp,
  } = useGuestLoginMachine();

  const searchParams = useSearchParams();
  const codeParam = searchParams?.get('code')?.trim() ?? '';
  const mailtoUrl = getSafeMailtoUrl(contactEmail);
  const helpTriggerRef = useRef<HTMLButtonElement>(null);
  const [hasPhotoQrSession, setHasPhotoQrSession] = useState(false);

  useEffect(() => {
    if (codeParam || typeof fetch !== 'function') return;
    const controller = new AbortController();
    fetch(withBasePath('/api/guest/session'), { signal: controller.signal })
      .then((res) => (res && res.ok && typeof res.json === 'function' ? res.json() : null))
      .then((json) => {
        if (controller.signal.aborted) return;
        const payload = json?.data ?? json;
        setHasPhotoQrSession(payload?.status === 'photo_qr');
      })
      .catch(() => {
        // Ignore transient or mocked-out session check errors on login form
      });

    return () => {
      controller.abort();
    };
  }, [codeParam]);

  return (
    <>
      <form
        onSubmit={handleLogin}
        className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-8 sm:p-10 flex flex-col gap-6 border border-gray-100 dark:border-gray-700 relative overflow-hidden"
      >
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-primary to-secondary" />

        <div className="text-center space-y-2">
          <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary dark:from-primary-light dark:to-secondary-light tracking-tight py-1">
            Guest Portal
          </h1>
          <p className="text-gray-600 dark:text-gray-300 text-sm">
            Enter your event passcode or personal invitation code to view schedules, event details, and your RSVP.
          </p>
        </div>

        <FormGroup
          state={error ? 'error' : 'default'}
          busy={loading}
          className="flex flex-col gap-2 space-y-0"
        >
          {error && (
            <FormMessage
              id="login-error"
              className="mt-0 mb-3 text-red-700 dark:text-red-200 text-sm font-medium bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800/50 p-3 rounded-xl text-center"
            >
              {error}
            </FormMessage>
          )}

          <Label htmlFor="passcode" className="ml-1 dark:text-gray-200">
            Passcode or Invitation Code
          </Label>
          <div className="relative group">
            <Input
              ref={passcodeInputRef}
              type={showPasscode ? 'text' : 'password'}
              id="passcode"
              name="passcode"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              busy={loading}
              required
              autoComplete="current-password"
              placeholder="Enter passcode or invitation code"
              style={{ borderRadius: '1rem' }}
              className="h-auto p-4 rounded-2xl bg-gray-50/50 dark:bg-gray-700/50 text-lg text-gray-800 dark:text-gray-100 pr-12 transition-all hover:bg-gray-100 dark:hover:bg-gray-700"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowPasscode(!showPasscode)}
              className="absolute right-3 top-1/2 -translate-y-1/2 h-8 w-8 p-1 rounded-full text-gray-500 hover:text-primary dark:text-gray-300 dark:hover:text-primary"
              aria-label={showPasscode ? 'Hide code' : 'Show code'}
            >
              {showPasscode ? <Icon name="EyeOff" size={22} /> : <Icon name="Eye" size={22} />}
            </Button>
          </div>
          <div className="flex justify-end pt-1">
            <Button
              ref={helpTriggerRef}
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowHelp(true)}
              aria-expanded={showHelp}
              aria-controls={showHelp ? 'guest-help-drawer' : undefined}
              className="h-auto text-xs sm:text-sm font-medium text-primary hover:underline hover:bg-transparent dark:text-primary-light rounded-lg px-1 py-0.5"
            >
              Need help finding your code?
            </Button>
          </div>
        </FormGroup>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          aria-disabled={isLoginDisabled}
          aria-busy={loading}
          style={{ borderRadius: '1rem', fontWeight: 700 }}
          className="w-full h-auto bg-primary bg-gradient-to-r from-primary to-secondary text-white px-6 py-4 rounded-2xl font-bold text-lg shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all active:scale-[0.98]"
        >
          {loading ? (
            <>
              <Icon name="Loader2" className="animate-spin mr-2 h-5 w-5 shrink-0" aria-hidden="true" />
              <span>Signing in...</span>
            </>
          ) : (
            <span>Access Portal</span>
          )}
        </Button>

        {hasPhotoQrSession && (
          <div className="pt-2 border-t border-gray-100 dark:border-gray-700 text-center">
            <Link
              href="/photos?tab=guest"
              data-testid="back-to-wedding-photos-link"
              className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 rounded-xl text-sm font-semibold text-gray-800 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              <Icon name="ArrowLeft" className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Back to Wedding Photos</span>
            </Link>
          </div>
        )}
      </form>

      <Overlay
        isOpen={showHelp}
        onClose={() => setShowHelp(false)}
        triggerRef={helpTriggerRef}
        id="guest-help-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-drawer-title"
        layoutClassName="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
        className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-6 sm:p-8 w-full max-w-md max-h-[calc(100vh-2rem)] overflow-y-auto border border-gray-100 dark:border-gray-700 space-y-5 text-gray-800 dark:text-gray-100 relative"
      >
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 pb-3">
          <div className="flex items-center gap-2">
            <Icon name="HelpCircle" className="w-5 h-5 text-primary" />
            <h2 id="help-drawer-title" className="text-lg font-bold text-gray-900 dark:text-white">
              Sign-In Help
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setShowHelp(false)}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-white p-1 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Close help drawer"
          >
            <Icon name="X" className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="space-y-3 text-sm text-gray-600 dark:text-gray-300">
            <p className="font-medium text-gray-900 dark:text-gray-100">
              Where to find your code:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-xs sm:text-sm">
              <li>Check your physical wedding invitation or save-the-date card.</li>
              <li>Look for a digital invitation or confirmation email sent by the hosts.</li>
              <li>Enter either the shared event passcode or your personal invitation code in the sign-in box.</li>
            </ul>
          </div>

          {isMessagingActive ? (
            <GuestSignInLinkRecovery headingLevel="h3" />
          ) : (
            <div className="bg-gray-50 dark:bg-gray-700/50 p-4 rounded-2xl border border-gray-100 dark:border-gray-700 space-y-2">
              <p className="text-xs sm:text-sm font-semibold text-gray-800 dark:text-gray-200">
                Still can&apos;t find your code?
              </p>
              {mailtoUrl ? (
                <>
                  <p className="text-xs text-gray-600 dark:text-gray-300">
                    Send a quick email to the hosts and they can share your code with you.
                  </p>
                  <a
                    href={mailtoUrl}
                    className="inline-flex items-center justify-center gap-2 w-full mt-2 px-4 py-2.5 bg-primary text-white text-sm font-semibold rounded-xl shadow-md hover:opacity-90 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  >
                    <Icon name="Mail" className="w-4 h-4" />
                    <span>Contact Host</span>
                  </a>
                </>
              ) : (
                <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300">
                  Please message the hosts directly by text or phone so they can share your code with you.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="pt-1 flex justify-end">
          <button
            type="button"
            onClick={() => setShowHelp(false)}
            className="px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Got it, thanks
          </button>
        </div>
      </Overlay>
    </>
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
            <h1 className="sr-only">Guest Portal</h1>
            <Icon name="Loader2" className="animate-spin h-10 w-10 text-primary" />
          </div>
        }>
          <GuestLoginForm />
        </Suspense>
      </motion.div>
    </div>
  );
}
