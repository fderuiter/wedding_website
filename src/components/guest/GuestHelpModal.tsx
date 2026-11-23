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
import {
  DEFAULT_RSVP_CLOSED_MESSAGE,
  evaluateRsvpCutoff,
  formatRsvpDeadlineDate,
  sanitizeRsvpClosedMessage,
} from '@/utils/rsvpDeadline';
import { cn } from '@/utils/cn';
import { tokenizeSafeLinks } from '@/utils/linkifyText';

export type GuestHelpCategory = 'passcode' | 'dietary' | 'registry' | 'faq';

export interface GuestHelpFaqItem {
  id?: string;
  question: string;
  answer: string;
  category?: string | null;
  isVisible?: boolean | string | null;
  displayOrder?: number | null;
}

export interface GuestHelpConfig {
  contactEmail?: string | null;
  twilioFromNumber?: string | null;
  contactPhone?: string | null;
  partner1Name?: string | null;
  partner2Name?: string | null;
  brideName?: string | null;
  groomName?: string | null;
  rsvpOpen?: boolean | null;
  isRsvpOpen?: boolean | null;
  rsvpDeadlineDate?: string | null;
  rsvpClosedMessage?: string | null;
  timezone?: string | null;
  faqs?: GuestHelpFaqItem[] | null;
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
        'Companion full names & entrée menus',
        'On each event card, mark Attending, enter the full first and last name for every attending plus-one companion (shared across your schedule), and choose a plated entrée or Kids Meal option for each guest on events with a dinner menu.',
      ],
      [
        'Custom RSVP prompts & updating responses',
        'Answer any event-specific text or multiple-choice RSVP prompts (such as shuttle seating or song requests) and click Save RSVP. Revisit your schedule anytime before the deadline to update attendance, companions, entrées, or answers.',
      ],
      [
        'Allergy & cross-contamination notes',
        'Enter allergies or dietary restrictions (nut, shellfish, dairy, celiac) in Dietary Requirements / Notes. For severe or life-threatening cross-contamination needs, please also contact the hosts below to coordinate directly with catering.',
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
    const contactSectionId = `help-contacts-${baseId}`;
    const contactHeadingId = `help-contacts-heading-${baseId}`;
    const contactSectionRef = useRef<HTMLElement | null>(null);
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
      faq: null,
    });

    const p1 = sanitizeConfigText(config?.partner1Name || config?.brideName, 60);
    const p2 = sanitizeConfigText(config?.partner2Name || config?.groomName, 60);
    const couple = p1 && p2 ? `${p1} & ${p2}` : p1 || p2;

    const rawFaqs = config?.faqs;
    const visibleCoupleFaqs = useMemo(() => {
      if (!Array.isArray(rawFaqs)) return [];
      return rawFaqs
        .filter((item) => {
          if (!item || item.isVisible === false || item.isVisible === 'false') return false;
          const question = sanitizeConfigText(item.question, 300);
          const answerTokens = tokenizeSafeLinks(item.answer);
          const hasAnswer = answerTokens.some((token) =>
            token.type === 'link' ? Boolean(token.label.trim()) : Boolean(token.value.trim())
          );
          return Boolean(question && hasAnswer);
        })
        .map((item, idx) => ({
          id: item.id || `couple-faq-${idx}`,
          question: sanitizeConfigText(item.question, 300),
          answerTokens: tokenizeSafeLinks(item.answer),
          category: sanitizeConfigText(item.category, 60),
          displayOrder:
            typeof item.displayOrder === 'number' && Number.isFinite(item.displayOrder)
              ? item.displayOrder
              : Number.MAX_SAFE_INTEGER,
          originalIndex: idx,
        }))
        .sort((a, b) =>
          a.displayOrder !== b.displayOrder
            ? a.displayOrder - b.displayOrder
            : a.originalIndex - b.originalIndex
        );
    }, [rawFaqs]);

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

    const rsvpCutoffEvaluation = useMemo(
      () =>
        evaluateRsvpCutoff({
          rsvpOpen: config?.rsvpOpen,
          rsvpDeadlineDate: config?.rsvpDeadlineDate,
          rsvpClosedMessage: config?.rsvpClosedMessage,
          timezone: config?.timezone,
        }),
      [
        config?.rsvpOpen,
        config?.rsvpDeadlineDate,
        config?.rsvpClosedMessage,
        config?.timezone,
      ]
    );
    const isRsvpCurrentlyOpen =
      typeof config?.isRsvpOpen === 'boolean'
        ? config.isRsvpOpen
        : rsvpCutoffEvaluation.isOpen;
    const formattedCutoffDate = useMemo(
      () => formatRsvpDeadlineDate(config?.rsvpDeadlineDate),
      [config?.rsvpDeadlineDate]
    );
    const sanitizedTimezone = sanitizeConfigText(config?.timezone, 64);
    const sanitizedClosedMessage =
      sanitizeRsvpClosedMessage(config?.rsvpClosedMessage) || DEFAULT_RSVP_CLOSED_MESSAGE;

    const resolvedTabs = useMemo(() => {
      const baseTabs = HELP_TABS.map((tab) => {
        if (tab.id !== 'dietary') return tab;
        if (!isRsvpCurrentlyOpen) {
          return {
            ...tab,
            heading: 'Online RSVPs Are Closed — Host Contact Guidance',
            items: [
              ['Online RSVPs are closed', sanitizedClosedMessage],
              [
                'Requesting companion, entrée, prompt, or Dietary Requirements / Notes updates',
                'Online changes to attendance, plus-one companion full names, structured entrée or Kids Meal selections, custom RSVP prompts, and Dietary Requirements / Notes are locked. Please reach out to the hosts below for headcount, meal, or severe allergy and cross-contamination updates.',
              ],
              [
                'Saved responses & mailing address',
                'You can still view your saved RSVP summary (including companion names, entrée choices, and custom prompt answers), export calendar events, and update your postal mailing address in the Guest Portal.',
              ],
            ] as [string, string][],
          };
        }
        if (formattedCutoffDate) {
          const tzDetail = sanitizedTimezone ? ` (midnight in ${sanitizedTimezone})` : '';
          return {
            ...tab,
            items: [
              tab.items[0],
              [
                'RSVP deadline & updating responses',
                `Answer any custom RSVP prompts (such as shuttle seating or song requests) and submit or update your attendance, companion full names, entrée selections, or allergy notes by ${formattedCutoffDate}${tzDetail}.`,
              ],
              tab.items[2],
            ] as [string, string][],
          };
        }
        return tab;
      });

      if (visibleCoupleFaqs.length > 0) {
        return [
          ...baseTabs,
          {
            id: 'faq' as GuestHelpCategory,
            label: 'Wedding Q&A',
            icon: 'HelpCircle' as IconName,
            heading: couple ? `${couple}'s Wedding Q&A` : 'Wedding Q&A from the Hosts',
            items: [] as [string, string][],
          },
        ];
      }

      return baseTabs;
    }, [
      isRsvpCurrentlyOpen,
      sanitizedClosedMessage,
      formattedCutoffDate,
      sanitizedTimezone,
      visibleCoupleFaqs.length,
      couple,
    ]);

    const activeTab = resolvedTabs.find((t) => t.id === activeCategory) ?? resolvedTabs[0];

    const onTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
      const len = resolvedTabs.length;
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
        const target = resolvedTabs[next];
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
            className={cn(
              'grid gap-1 px-6 pt-2.5 border-b border-gray-200 dark:border-zinc-800 bg-gray-50/70 dark:bg-zinc-900/60',
              resolvedTabs.length > 3 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'
            )}
          >
            {resolvedTabs.map((tab, idx) => {
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
              data-testid={
                activeTab.id === 'dietary' && !isRsvpCurrentlyOpen
                  ? 'help-modal-rsvp-closed'
                  : undefined
              }
              tabIndex={0}
              className={cn('space-y-3 rounded-lg', FOCUS_RING)}
            >
              <h3 className={cn('text-sm sm:text-base', HEADING_SM_CLS)}>{activeTab.heading}</h3>
              {activeTab.id === 'faq' ? (
                <ul className="space-y-2" data-testid="help-modal-couple-faqs">
                  {visibleCoupleFaqs.map((faq) => (
                    <li
                      key={faq.id}
                      className="rounded-xl border border-gray-100 dark:border-zinc-800 bg-gray-50/80 dark:bg-zinc-800/50 p-3 text-xs sm:text-sm"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="font-semibold text-gray-900 dark:text-zinc-100">
                          {faq.question}
                        </p>
                        {faq.category && faq.category !== 'General' && (
                          <span className="inline-flex items-center rounded-full bg-gray-200/80 dark:bg-zinc-700 px-2 py-0.5 text-[11px] font-medium text-gray-800 dark:text-zinc-200">
                            {faq.category}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-gray-600 dark:text-zinc-300 leading-relaxed whitespace-pre-wrap">
                        {faq.answerTokens.map((token, tokenIdx) =>
                          token.type === 'link' ? (
                            <a
                              key={`${faq.id}-link-${tokenIdx}`}
                              href={token.href}
                              target={token.isExternal ? '_blank' : undefined}
                              rel={token.isExternal ? 'noopener noreferrer' : undefined}
                              className={cn(
                                'underline underline-offset-2 font-medium text-[var(--color-primary-text,var(--color-primary,#B91C1C))] dark:text-red-300 hover:opacity-80 rounded-sm',
                                FOCUS_RING
                              )}
                            >
                              {token.label}
                            </a>
                          ) : (
                            <React.Fragment key={`${faq.id}-text-${tokenIdx}`}>
                              {token.value}
                            </React.Fragment>
                          )
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <ul className="space-y-2">
                  {activeTab.items.map(([title, detail], idx) => (
                    <li
                      key={title}
                      className="rounded-xl border border-gray-100 dark:border-zinc-800 bg-gray-50/80 dark:bg-zinc-800/50 p-3 text-xs sm:text-sm"
                    >
                      <p className="font-semibold text-gray-900 dark:text-zinc-100">{title}</p>
                      <p className="mt-0.5 text-gray-600 dark:text-zinc-300 leading-relaxed">{detail}</p>
                      {activeTab.id === 'dietary' && !isRsvpCurrentlyOpen && idx === 0 && (
                        <a
                          href={`#${contactSectionId}`}
                          onClick={(e) => {
                            e.preventDefault();
                            contactSectionRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
                            contactSectionRef.current?.focus();
                          }}
                          className={cn(
                            'mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-primary-text,var(--color-primary,#B91C1C))] dark:text-red-300 underline',
                            FOCUS_RING
                          )}
                        >
                          <span>Contact the hosts below</span>
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <section
              ref={contactSectionRef}
              id={contactSectionId}
              tabIndex={-1}
              aria-labelledby={contactHeadingId}
              className="rounded-xl border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800/70 p-4 space-y-2.5"
            >
              <h3 id={contactHeadingId} className={cn('text-xs sm:text-sm', HEADING_SM_CLS)}>
                {isRsvpCurrentlyOpen
                  ? 'Still need help? Reach out to the hosts'
                  : 'Need to update a closed RSVP? Contact the hosts'}
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
  openHelp: (_category?: GuestHelpCategory, _configOverride?: GuestHelpConfig | null) => void;
  closeHelp: () => void;
  syncLiveConfig: (_liveConfig: Partial<GuestHelpConfig> | null) => void;
}

const GuestHelpContext = createContext<GuestHelpContextValue>({
  hasProvider: false,
  isOpen: false,
  activeCategory: 'passcode',
  openHelp: () => {},
  closeHelp: () => {},
  syncLiveConfig: () => {},
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
  const [liveConfig, setLiveConfig] = useState<Partial<GuestHelpConfig> | null>(null);
  const [triggerConfig, setTriggerConfig] = useState<GuestHelpConfig | null>(null);

  const openHelp = useCallback(
    (category?: GuestHelpCategory, configOverride?: GuestHelpConfig | null) => {
      setActiveCategory(category ?? resolveHelpCategoryForPath(pathname));
      setTriggerConfig(configOverride ?? null);
      setIsOpen(true);
    },
    [pathname]
  );
  const closeHelp = useCallback(() => {
    setIsOpen(false);
    setTriggerConfig(null);
  }, []);
  const syncLiveConfig = useCallback((nextLiveConfig: Partial<GuestHelpConfig> | null) => {
    setLiveConfig(nextLiveConfig);
  }, []);

  const mergedConfig = useMemo<GuestHelpConfig | null>(() => {
    if (!config && !liveConfig && !triggerConfig) return null;
    const resolvedFaqs = triggerConfig?.faqs ?? liveConfig?.faqs ?? config?.faqs;
    return {
      ...(config ?? {}),
      ...(liveConfig ?? {}),
      ...(triggerConfig ?? {}),
      ...(resolvedFaqs !== undefined ? { faqs: resolvedFaqs } : {}),
    };
  }, [config, liveConfig, triggerConfig]);

  const value = useMemo<GuestHelpContextValue>(
    () => ({ hasProvider: true, isOpen, activeCategory, openHelp, closeHelp, syncLiveConfig }),
    [isOpen, activeCategory, openHelp, closeHelp, syncLiveConfig]
  );

  return (
    <GuestHelpContext.Provider value={value}>
      {children}
      <GuestHelpModal
        isOpen={isOpen}
        onClose={closeHelp}
        initialCategory={activeCategory}
        config={mergedConfig}
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
            if (context.hasProvider) context.openHelp(defaultCategory, config);
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
