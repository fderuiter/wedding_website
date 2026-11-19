'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useTheme } from '@/components/ThemeProvider';
import { sanitizeUrl } from '@/utils/validation';
import { cn } from '@/utils/cn';

export type GuestHelpCategory = 'passcode' | 'dietary' | 'registry';

export interface GuestHelpConfig {
  contactEmail?: string | null;
  twilioFromNumber?: string | null;
  contactPhone?: string | null;
  partner1Name?: string | null;
  partner2Name?: string | null;
  brideName?: string | null;
  groomName?: string | null;
}

const SAFE_EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const SAFE_PHONE_RE = /^\+?[0-9()\-\s.]{7,25}$/;
const UNSAFE_RAW_RE = /[<>[\]\u0000-\u001F\u007F]/;
const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring,var(--color-primary,#B91C1C))]';
const SUBTEXT_CLS = 'text-xs sm:text-sm text-gray-600 dark:text-zinc-300';
const HEADING_SM_CLS = 'font-bold text-gray-900 dark:text-zinc-100';
const LINK_BTN_CLS =
  'inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-xs sm:text-sm font-semibold focus-visible:ring-offset-2';

export function sanitizeConfigText(value?: string | null, maxLength = 120): string {
  if (!value || typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .replace(/\b(?:javascript|data|vbscript)\s*:/gi, '')
    .trim()
    .slice(0, maxLength);
}

export function getSafeHostEmailLink(
  rawEmail?: string | null
): { email: string; href: string } | null {
  if (!rawEmail || typeof rawEmail !== 'string' || UNSAFE_RAW_RE.test(rawEmail)) return null;
  const email = sanitizeConfigText(rawEmail, 254);
  if (!email || !SAFE_EMAIL_RE.test(email)) return null;
  const href = sanitizeUrl(`mailto:${email}?subject=Wedding%20Guest%20Question`);
  return href?.toLowerCase().startsWith('mailto:') ? { email, href } : null;
}

export function getSafeHostPhoneLink(
  rawPhone?: string | null
): { displayPhone: string; href: string } | null {
  if (!rawPhone || typeof rawPhone !== 'string' || UNSAFE_RAW_RE.test(rawPhone)) return null;
  const displayPhone = sanitizeConfigText(rawPhone, 30);
  if (!displayPhone || !SAFE_PHONE_RE.test(displayPhone)) return null;
  const digits = displayPhone.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  const href = sanitizeUrl(`tel:${displayPhone.startsWith('+') ? '+' : ''}${digits}`);
  return href?.toLowerCase().startsWith('tel:') ? { displayPhone, href } : null;
}

export function resolveHelpCategoryForPath(pathname?: string | null): GuestHelpCategory {
  if (!pathname) return 'passcode';
  if (pathname.startsWith('/registry')) return 'registry';
  if (pathname.startsWith('/guest')) return 'passcode';
  return 'dietary';
}

const HELP_TABS: readonly {
  id: GuestHelpCategory;
  label: string;
  icon: IconName;
  heading: string;
  items: [string, string][];
}[] = [
  {
    id: 'passcode',
    label: 'Invitation Code',
    icon: 'Tag',
    heading: 'Locating Your Invitation Code or Passcode',
    items: [
      [
        'Physical envelopes & paper mailers',
        'Check the address label on your outer mailing envelope or the bottom corner of your paper save-the-date or RSVP card.',
      ],
      [
        'Digital announcements & emails',
        'Check save-the-date or wedding invitation emails from the hosts for your code or direct sign-in link near the RSVP button.',
      ],
      [
        'No code yet?',
        'Share postal details on the Mailing Address Form without a code, or contact the hosts below for code recovery.',
      ],
    ],
  },
  {
    id: 'dietary',
    label: 'RSVP & Dietary',
    icon: 'Calendar',
    heading: 'Event RSVPs & Severe Allergy Notes',
    items: [
      [
        'Submitting allergy & dietary notes',
        'On each event card, mark Attending, enter allergies or meal needs (nut, shellfish, dairy, celiac) in Dietary Requirements / Notes, and click Save RSVP.',
      ],
      [
        'Updating responses & plus-ones',
        'Revisit your schedule anytime before the deadline to update attendance, allocated plus-ones, or allergy notes.',
      ],
      [
        'Severe allergies',
        'For life-threatening cross-contamination needs, please also contact the hosts below to coordinate with catering.',
      ],
    ],
  },
  {
    id: 'registry',
    label: 'Registry & Gifts',
    icon: 'Gift',
    heading: 'Wedding Registry & Gift Questions',
    items: [
      [
        'Available & group gifts',
        'Filter items by category or price. Group Gifts accept partial contributions of any amount toward the goal.',
      ],
      [
        'Retailer links & funds',
        'Select a gift card to contribute or visit the store, then record your gift to keep availability accurate.',
      ],
      [
        'Thank-you tracking',
        'Entering your name or invitation code helps match gifts for thank-you notes while keeping details private.',
      ],
    ],
  },
];

export interface GuestHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialCategory?: GuestHelpCategory;
  config?: GuestHelpConfig | null;
  className?: string;
}

export const GuestHelpModal = React.forwardRef<HTMLDivElement, GuestHelpModalProps>(
  ({ isOpen, onClose, initialCategory = 'passcode', config, className }, ref) => {
    const baseId = useId();
    const titleId = `help-title-${baseId}`;
    const descId = `help-desc-${baseId}`;
    const theme = useTheme();
    const modalKey = `${isOpen ? 'open' : 'closed'}-${initialCategory}`;
    const [categoryOverride, setCategoryOverride] = useState<{
      key: string;
      category: GuestHelpCategory;
    } | null>(null);
    const activeCategory =
      categoryOverride && categoryOverride.key === modalKey
        ? categoryOverride.category
        : initialCategory;
    const setActiveCategory = (category: GuestHelpCategory) => {
      setCategoryOverride({ key: modalKey, category });
    };
    const tabRefs = useRef<Record<GuestHelpCategory, HTMLButtonElement | null>>({
      passcode: null,
      dietary: null,
      registry: null,
    });

    const p1 = sanitizeConfigText(config?.partner1Name || config?.brideName, 60);
    const p2 = sanitizeConfigText(config?.partner2Name || config?.groomName, 60);
    const couple = p1 && p2 ? `${p1} & ${p2}` : p1 || p2;

    const emailContact = useMemo(
      () => getSafeHostEmailLink(config?.contactEmail ?? theme.contactEmail),
      [config?.contactEmail, theme.contactEmail]
    );
    const phoneContact = useMemo(
      () =>
        getSafeHostPhoneLink(
          config?.contactPhone ?? config?.twilioFromNumber ?? theme.contactPhone
        ),
      [config?.contactPhone, config?.twilioFromNumber, theme.contactPhone]
    );

    const activeTab = HELP_TABS.find((t) => t.id === activeCategory) ?? HELP_TABS[0];

    const onTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
      const len = HELP_TABS.length;
      const next =
        e.key === 'ArrowRight'
          ? (idx + 1) % len
          : e.key === 'ArrowLeft'
            ? (idx - 1 + len) % len
            : e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? len - 1
                : null;
      if (next !== null) {
        e.preventDefault();
        const target = HELP_TABS[next];
        setActiveCategory(target.id);
        tabRefs.current[target.id]?.focus();
      }
    };

    return (
      <Dialog
        ref={ref}
        isOpen={isOpen}
        onClose={onClose}
        aria-labelledby={titleId}
        aria-describedby={descId}
        className={cn('max-w-lg rounded-2xl', className)}
        contentClassName="p-0"
      >
        <div className="flex flex-col max-h-[85vh]">
          <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-4 border-b border-gray-200 dark:border-zinc-800">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Icon name="HelpCircle" className="h-5 w-5 text-[var(--color-primary,#B91C1C)] shrink-0" />
                <h2 id={titleId} className="text-lg font-bold text-gray-900 dark:text-zinc-50">
                  Guest Help &amp; Support
                </h2>
              </div>
              <p id={descId} className={SUBTEXT_CLS}>
                {couple
                  ? `Quick answers for ${couple}'s celebration and direct host contact options.`
                  : 'Quick answers for wedding guests and direct host contact options.'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close guest help"
              className={cn(
                'inline-flex items-center justify-center min-h-[32px] min-w-[32px] rounded-full p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800',
                FOCUS_RING
              )}
            >
              <Icon name="X" className="h-5 w-5" />
            </button>
          </div>

          <div
            role="tablist"
            aria-label="Guest help topics"
            className="grid grid-cols-3 gap-1 px-6 pt-2.5 border-b border-gray-200 dark:border-zinc-800 bg-gray-50/70 dark:bg-zinc-900/60"
          >
            {HELP_TABS.map((tab, idx) => {
              const selected = tab.id === activeTab.id;
              return (
                <button
                  key={tab.id}
                  ref={(el) => {
                    tabRefs.current[tab.id] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`${baseId}-tab-${tab.id}`}
                  aria-selected={selected}
                  aria-controls={`${baseId}-panel-${tab.id}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setActiveCategory(tab.id)}
                  onKeyDown={(e) => onTabKeyDown(e, idx)}
                  className={cn(
                    'inline-flex items-center justify-center gap-1.5 px-2 py-2.5 text-xs sm:text-sm font-semibold border-b-2 rounded-t-md',
                    FOCUS_RING,
                    selected
                      ? 'border-[var(--color-primary,#B91C1C)] text-[var(--color-primary-text,var(--color-primary,#B91C1C))] dark:text-zinc-50 bg-white dark:bg-zinc-800'
                      : 'border-transparent text-gray-600 hover:text-gray-900 dark:text-zinc-400 dark:hover:text-zinc-200'
                  )}
                >
                  <Icon name={tab.icon} className="h-3.5 w-3.5 hidden sm:inline-block shrink-0" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          <div className="overflow-y-auto px-6 py-5 space-y-4">
            <div
              role="tabpanel"
              id={`${baseId}-panel-${activeTab.id}`}
              aria-labelledby={`${baseId}-tab-${activeTab.id}`}
              tabIndex={0}
              className={cn('space-y-3 rounded-lg', FOCUS_RING)}
            >
              <h3 className={cn('text-sm sm:text-base', HEADING_SM_CLS)}>{activeTab.heading}</h3>
              <ul className="space-y-2">
                {activeTab.items.map(([title, detail]) => (
                  <li
                    key={title}
                    className="rounded-xl border border-gray-100 dark:border-zinc-800 bg-gray-50/80 dark:bg-zinc-800/50 p-3 text-xs sm:text-sm"
                  >
                    <p className="font-semibold text-gray-900 dark:text-zinc-100">{title}</p>
                    <p className="mt-0.5 text-gray-600 dark:text-zinc-300 leading-relaxed">{detail}</p>
                  </li>
                ))}
              </ul>
            </div>

            <section
              aria-label="Contact the hosts"
              className="rounded-xl border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800/70 p-4 space-y-2.5"
            >
              <h3 className={cn('text-xs sm:text-sm', HEADING_SM_CLS)}>
                Still need help? Reach out to the hosts
              </h3>
              {emailContact || phoneContact ? (
                <div className="flex flex-col sm:flex-row flex-wrap gap-2.5">
                  {emailContact && (
                    <a
                      href={emailContact.href}
                      className={cn(
                        LINK_BTN_CLS,
                        'bg-[var(--btn-primary-bg,var(--color-primary,#B91C1C))] text-[var(--btn-primary-text,#ffffff)] shadow-sm hover:opacity-95',
                        FOCUS_RING
                      )}
                    >
                      <Icon name="Mail" className="h-4 w-4 shrink-0" />
                      <span>Email {emailContact.email}</span>
                    </a>
                  )}
                  {phoneContact && (
                    <a
                      href={phoneContact.href}
                      className={cn(
                        LINK_BTN_CLS,
                        'border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100 hover:bg-gray-100 dark:hover:bg-zinc-700',
                        FOCUS_RING
                      )}
                    >
                      <Icon name="Phone" className="h-4 w-4 shrink-0" />
                      <span>Call {phoneContact.displayPhone}</span>
                    </a>
                  )}
                </div>
              ) : (
                <p className={SUBTEXT_CLS}>
                  Please contact the couple directly using the email address or phone number on your
                  save-the-date or wedding invitation.
                </p>
              )}
            </section>
          </div>

          <div className="flex items-center justify-end px-6 py-3.5 border-t border-gray-200 dark:border-zinc-800 bg-gray-50/50 dark:bg-zinc-900/40">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </Dialog>
    );
  }
);
GuestHelpModal.displayName = 'GuestHelpModal';

interface GuestHelpContextValue {
  hasProvider: boolean;
  isOpen: boolean;
  activeCategory: GuestHelpCategory;
  openHelp: (_category?: GuestHelpCategory) => void;
  closeHelp: () => void;
}

const GuestHelpContext = createContext<GuestHelpContextValue>({
  hasProvider: false,
  isOpen: false,
  activeCategory: 'passcode',
  openHelp: () => {},
  closeHelp: () => {},
});

export function useGuestHelp(): GuestHelpContextValue {
  return useContext(GuestHelpContext);
}

export interface GuestHelpProviderProps {
  children: React.ReactNode;
  config?: GuestHelpConfig | null;
  pathname?: string | null;
}

export function GuestHelpProvider({ children, config, pathname }: GuestHelpProviderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<GuestHelpCategory>(() =>
    resolveHelpCategoryForPath(pathname)
  );
  const openHelp = useCallback(
    (category?: GuestHelpCategory) => {
      setActiveCategory(category ?? resolveHelpCategoryForPath(pathname));
      setIsOpen(true);
    },
    [pathname]
  );
  const closeHelp = useCallback(() => setIsOpen(false), []);
  const value = useMemo<GuestHelpContextValue>(
    () => ({ hasProvider: true, isOpen, activeCategory, openHelp, closeHelp }),
    [isOpen, activeCategory, openHelp, closeHelp]
  );

  return (
    <GuestHelpContext.Provider value={value}>
      {children}
      <GuestHelpModal
        isOpen={isOpen}
        onClose={closeHelp}
        initialCategory={activeCategory}
        config={config}
      />
    </GuestHelpContext.Provider>
  );
}

export interface GuestHelpTriggerProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  defaultCategory?: GuestHelpCategory;
  label?: string;
  variant?: 'inline' | 'navbar' | 'mobileNav';
  config?: GuestHelpConfig | null;
  onTrigger?: () => void;
}

const VARIANT_CLS = {
  inline:
    'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 min-h-[28px] text-xs sm:text-sm font-semibold text-[var(--color-primary-text,var(--color-primary,#B91C1C))] hover:bg-[var(--btn-ghost-hover-bg,rgba(0,0,0,0.05))] dark:text-red-300 dark:hover:bg-zinc-700/60 focus-visible:ring-offset-1',
  navbar:
    'inline-flex items-center justify-center gap-1.5 px-3 py-1.5 min-h-[32px] min-w-[32px] rounded-md text-sm font-medium text-[var(--color-primary-text)] hover:bg-[var(--btn-ghost-hover-bg,rgba(0,0,0,0.05))] focus-visible:ring-offset-2',
  mobileNav:
    'flex w-full items-center gap-2 text-left px-3 py-2 rounded-md text-base font-medium text-[var(--color-primary-text)] hover:bg-[var(--btn-ghost-hover-bg,rgba(0,0,0,0.05))] focus-visible:ring-offset-2',
};

export const GuestHelpTrigger = React.forwardRef<HTMLButtonElement, GuestHelpTriggerProps>(
  (
    {
      defaultCategory,
      label = 'Need Help?',
      variant = 'inline',
      config,
      onTrigger,
      className,
      ...buttonProps
    },
    ref
  ) => {
    const context = useGuestHelp();
    const [localOpen, setLocalOpen] = useState(false);

    return (
      <>
        <button
          ref={ref}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={context.hasProvider ? context.isOpen : localOpen}
          onClick={() => {
            onTrigger?.();
            if (context.hasProvider) context.openHelp(defaultCategory);
            else setLocalOpen(true);
          }}
          className={cn('transition-colors', FOCUS_RING, VARIANT_CLS[variant], className)}
          {...buttonProps}
        >
          <Icon name="HelpCircle" className="h-4 w-4 shrink-0" />
          <span>{label}</span>
        </button>
        {!context.hasProvider && (
          <GuestHelpModal
            isOpen={localOpen}
            onClose={() => setLocalOpen(false)}
            initialCategory={defaultCategory ?? 'passcode'}
            config={config}
          />
        )}
      </>
    );
  }
);
GuestHelpTrigger.displayName = 'GuestHelpTrigger';
