'use client';

import { Suspense } from 'react';
import { Icon } from '@/components/ui/Icon';
import { motion, Variants } from 'framer-motion';
import { useTheme } from '@/components/ThemeProvider';
import { Overlay } from '@/components/ui/Overlay';
import { GuestLookupHelpPanel } from '@/components/guest/GuestLookupHelpPanel';
import { useGuestLoginMachine, getSafeCallbackUrl } from '@/hooks/useGuestLoginMachine';

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

export { getSafeCallbackUrl };

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
  const { contactEmail } = useTheme();
  const {
    passcode,
    showPasscode,
    error,
    loading,
    showHelp,
    isLoginDisabled,
    unlockByName,
    firstName,
    lastName,
    disambiguationEmail,
    disambiguationZip,
    requiresDisambiguation,
    lookupNotFound,
    handleLogin,
    setPasscode,
    setShowPasscode,
    setShowHelp,
    setUnlockByName,
    setFirstName,
    setLastName,
    setDisambiguationEmail,
    setDisambiguationZip,
  } = useGuestLoginMachine();

  const mailtoUrl = getSafeMailtoUrl(contactEmail);

  return (
    <>
      <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-8 sm:p-10 flex flex-col gap-6 border border-gray-100 dark:border-gray-700 relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-primary to-secondary" />

        <form onSubmit={handleLogin} className="flex flex-col gap-6">
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary dark:from-primary-light dark:to-secondary-light tracking-tight py-1">
              Guest Portal
            </h1>
            <p className="text-gray-600 dark:text-gray-300 text-sm">
              Enter your event passcode or personal invitation code to view schedules, event details, and your RSVP.
            </p>
          </div>

          {error && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              id="login-error"
              role="alert"
              className="text-red-800 dark:text-red-200 text-sm font-medium bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/30 p-3 rounded-xl text-center"
            >
              {error}
            </motion.p>
          )}

          <div className="flex flex-col gap-2">
            <label htmlFor="passcode" className="block text-gray-700 dark:text-gray-300 font-semibold text-sm ml-1">
              Passcode or Invitation Code
            </label>
            <div className="relative group">
              <input
                type={showPasscode ? 'text' : 'password'}
                id="passcode"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                disabled={isLoginDisabled}
                className="border border-gray-200 dark:border-gray-400 p-4 rounded-2xl w-full focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none focus-visible:ring-offset-2 bg-gray-50/50 dark:bg-gray-700/50 text-lg text-gray-800 dark:text-gray-100 pr-12 transition-all hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-60 disabled:cursor-not-allowed"
                required
                autoComplete="off"
                placeholder="Enter passcode or invitation code"
                aria-invalid={error ? 'true' : undefined}
                aria-describedby={error ? 'login-error' : undefined}
              />
              <button
                type="button"
                onClick={() => setShowPasscode(!showPasscode)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-primary dark:text-gray-300 dark:hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-full p-1"
                aria-label={showPasscode ? 'Hide code' : 'Show code'}
              >
                {showPasscode ? <Icon name="EyeOff" size={22} /> : <Icon name="Eye" size={22} />}
              </button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={() => setUnlockByName(!unlockByName)}
                aria-expanded={unlockByName}
                aria-controls="guest-login-name-fields"
                data-testid="toggle-name-unlock-button"
                className="text-xs sm:text-sm font-medium text-primary hover:underline dark:text-primary-light transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg px-1 py-0.5"
              >
                {unlockByName
                  ? 'Sign in with code or passcode only'
                  : 'Unlock RSVP with your name instead'}
              </button>
              <button
                type="button"
                onClick={() => setShowHelp(true)}
                aria-expanded={showHelp}
                aria-controls="guest-help-drawer"
                className="text-xs sm:text-sm font-medium text-primary hover:underline dark:text-primary-light transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg px-1 py-0.5"
              >
                Need help finding your code?
              </button>
            </div>
          </div>

          {unlockByName && (
            <div
              id="guest-login-name-fields"
              data-testid="guest-login-name-fields"
              className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-700/30 p-4 space-y-4"
            >
              <p className="text-xs text-gray-600 dark:text-gray-300">
                Enter the shared event passcode above along with both your first and last name to
                unlock your household&apos;s RSVP without a personal invitation code.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="guest-login-first-name"
                    className="block text-gray-700 dark:text-gray-200 font-semibold text-xs ml-0.5"
                  >
                    First Name
                  </label>
                  <input
                    id="guest-login-first-name"
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    disabled={isLoginDisabled}
                    required
                    autoComplete="given-name"
                    placeholder="First name"
                    className="border border-gray-200 dark:border-gray-500 px-3.5 py-2.5 rounded-xl w-full focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none bg-white dark:bg-gray-800 text-sm text-gray-800 dark:text-gray-100"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="guest-login-last-name"
                    className="block text-gray-700 dark:text-gray-200 font-semibold text-xs ml-0.5"
                  >
                    Last Name
                  </label>
                  <input
                    id="guest-login-last-name"
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    disabled={isLoginDisabled}
                    required
                    autoComplete="family-name"
                    placeholder="Last name"
                    className="border border-gray-200 dark:border-gray-500 px-3.5 py-2.5 rounded-xl w-full focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none bg-white dark:bg-gray-800 text-sm text-gray-800 dark:text-gray-100"
                  />
                </div>
              </div>

              {requiresDisambiguation && (
                <div
                  id="guest-login-disambiguation-fields"
                  data-testid="guest-login-disambiguation-fields"
                  className="pt-3 border-t border-gray-200 dark:border-gray-600 space-y-3"
                >
                  <p className="text-xs font-medium text-amber-900 dark:text-amber-200">
                    To confirm which household is yours, enter either the email address or postal
                    ZIP code on your invitation:
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor="guest-login-email"
                        className="block text-gray-700 dark:text-gray-200 font-semibold text-xs ml-0.5"
                      >
                        Email Address
                      </label>
                      <input
                        id="guest-login-email"
                        type="email"
                        value={disambiguationEmail}
                        onChange={(e) => setDisambiguationEmail(e.target.value)}
                        disabled={isLoginDisabled}
                        autoComplete="email"
                        placeholder="you@example.com"
                        className="border border-gray-200 dark:border-gray-500 px-3.5 py-2.5 rounded-xl w-full focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none bg-white dark:bg-gray-800 text-sm text-gray-800 dark:text-gray-100"
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor="guest-login-zip"
                        className="block text-gray-700 dark:text-gray-200 font-semibold text-xs ml-0.5"
                      >
                        ZIP / Postal Code
                      </label>
                      <input
                        id="guest-login-zip"
                        type="text"
                        value={disambiguationZip}
                        onChange={(e) => setDisambiguationZip(e.target.value)}
                        disabled={isLoginDisabled}
                        autoComplete="postal-code"
                        placeholder="e.g. 94102"
                        className="border border-gray-200 dark:border-gray-500 px-3.5 py-2.5 rounded-xl w-full focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none bg-white dark:bg-gray-800 text-sm text-gray-800 dark:text-gray-100"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <button
            type="submit"
            className="w-full bg-primary bg-gradient-to-r from-primary to-secondary text-white px-6 py-4 rounded-2xl font-bold text-lg shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-75 disabled:cursor-not-allowed flex items-center justify-center overflow-hidden relative"
            disabled={isLoginDisabled}
            aria-busy={loading}
          >
            <span className={loading ? 'opacity-0' : 'opacity-100'}>
              {unlockByName ? 'Unlock Household RSVP' : 'Access Portal'}
            </span>
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Icon name="Loader2" className="animate-spin h-6 w-6" aria-hidden="true" />
              </div>
            )}
          </button>
        </form>

        {unlockByName && lookupNotFound && (
          <GuestLookupHelpPanel
            idPrefix="login-lookup-help"
            initialGuestName={[firstName, lastName].filter(Boolean).join(' ')}
            initialEmail={disambiguationEmail}
          />
        )}
      </div>

      <Overlay
        isOpen={showHelp}
        onClose={() => setShowHelp(false)}
        id="guest-help-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-drawer-title"
        layoutClassName="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
        className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-6 sm:p-8 w-full max-w-md border border-gray-100 dark:border-gray-700 space-y-5 text-gray-800 dark:text-gray-100 relative"
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
            <Icon name="Loader2" className="animate-spin h-10 w-10 text-primary" />
          </div>
        }>
          <GuestLoginForm />
        </Suspense>
      </motion.div>
    </div>
  );
}
