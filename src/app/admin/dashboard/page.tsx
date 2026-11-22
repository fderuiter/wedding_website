'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { OnboardingChecklist } from '@/components/admin/OnboardingChecklist';
import { Icon, type IconName } from '@/components/ui/Icon';
import { FeatureId, isFeatureEnabled } from '@/lib/modules';

interface OverviewWorkflowCard {
  id: string;
  title: string;
  description: string;
  href: string;
  icon: IconName;
  actionLabel: string;
  featureId?: FeatureId;
}

const OVERVIEW_WORKFLOWS: OverviewWorkflowCard[] = [
  {
    id: 'invitations',
    title: 'Guest Invitations & Broadcasts',
    description:
      'Import guest lists via CSV, manage RSVP invitation codes, print QR labels, and send email broadcasts.',
    href: '/admin/dashboard/invitation-codes',
    icon: 'Mail',
    actionLabel: 'Manage Invitations',
  },
  {
    id: 'registry',
    title: 'Gift Registry',
    description:
      'Add physical gifts or cash funds, highlight Most Wanted items, and track guest contributions.',
    href: '/admin/dashboard/registry',
    icon: 'Gift',
    actionLabel: 'Manage Registry',
    featureId: 'registry',
  },
  {
    id: 'seating',
    title: 'Seating Chart',
    description:
      'Arrange reception tables, assign confirmed guests, and export printable seating layouts.',
    href: '/admin/dashboard/seating-chart',
    icon: 'Users',
    actionLabel: 'Open Seating Chart',
  },
  {
    id: 'sub-events',
    title: 'Sub-Events Matrix',
    description:
      'Coordinate welcome drinks, rehearsal dinners, and farewell brunches across guest groups.',
    href: '/admin/dashboard/sub-events',
    icon: 'Calendar',
    actionLabel: 'Manage Sub-Events',
  },
  {
    id: 'content',
    title: 'Content Hub & Wedding Q&A',
    description:
      'Publish guest FAQs, organize day-of logistics, and customize homepage Q&A display order.',
    href: '/admin/dashboard/content',
    icon: 'HelpCircle',
    actionLabel: 'Manage FAQs & Content',
  },
  {
    id: 'media',
    title: 'Media Library',
    description:
      'Curate wedding albums, moderate guest photo uploads, and launch the live reception slideshow.',
    href: '/admin/dashboard/media',
    icon: 'Camera',
    actionLabel: 'Open Media Library',
    featureId: 'gallery',
  },
  {
    id: 'settings',
    title: 'Website Settings & Modules',
    description:
      'Configure partner names, venue details, visual theme presets, and optional feature modules.',
    href: '/admin/dashboard/settings',
    icon: 'Globe',
    actionLabel: 'Configure Settings',
  },
];

/**
 * @page AdminDashboardPage
 * @description Decoupled administrative overview displaying setup progress (`OnboardingChecklist`)
 * and module-aware quick navigation to active wedding planning workflows.
 */
export default function AdminDashboardPage() {
  const [moduleConfig, setModuleConfig] = useState<unknown>(undefined);

  useEffect(() => {
    let cancelled = false;

    const loadModuleConfig = async () => {
      try {
        const res = await fetch('/api/admin/settings');
        if (!res || !res.ok || typeof res.json !== 'function' || cancelled) return;
        const raw = await res.json();
        if (cancelled) return;
        const payload =
          raw && typeof raw === 'object' && 'data' in raw && raw.data ? raw.data : raw;
        if (payload && typeof payload === 'object' && 'modules' in payload) {
          setModuleConfig((payload as { modules?: unknown }).modules);
        }
      } catch {
        // Gracefully ignore network or mock errors so overview remains available
      }
    };

    void loadModuleConfig();

    return () => {
      cancelled = true;
    };
  }, []);

  const visibleWorkflows = OVERVIEW_WORKFLOWS.filter((workflow) => {
    if (!workflow.featureId) return true;
    return isFeatureEnabled(workflow.featureId, moduleConfig);
  });

  return (
    <div className="py-10">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-wrap justify-between items-center gap-4 mb-8">
          <div>
            <h1 className="text-4xl font-extrabold text-primary tracking-tight drop-shadow-lg">
              Admin Overview
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
              Review setup milestones and jump directly to your active wedding tools.
            </p>
          </div>
        </div>

        <OnboardingChecklist />

        <section aria-labelledby="admin-workflows-heading" data-testid="admin-overview-workflows">
          <h2
            id="admin-workflows-heading"
            className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4"
          >
            Planning Workflows
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {visibleWorkflows.map((workflow) => (
              <Link
                key={workflow.id}
                href={workflow.href}
                data-testid={`overview-card-${workflow.id}`}
                className="group flex flex-col justify-between rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-5 shadow-md hover:shadow-lg hover:border-primary dark:hover:border-primary transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                <div>
                  <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-stone-100 dark:bg-gray-700 text-primary mb-3">
                    <Icon name={workflow.icon} className="w-5 h-5" />
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 group-hover:text-primary transition-colors">
                    {workflow.title}
                  </h3>
                  <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                    {workflow.description}
                  </p>
                </div>
                <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
                  <span>{workflow.actionLabel}</span>
                  <Icon
                    name="ChevronRight"
                    className="w-4 h-4 transition-transform group-hover:translate-x-0.5"
                  />
                </span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
