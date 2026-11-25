'use client';

import { motion } from 'framer-motion';
import { useOptionalDemo } from '@/components/demo/DemoContext';
import { AccessibleExternalLink } from '@/components/ui/AccessibleExternalLink';
import { Icon } from '@/components/ui/Icon';
import { resolveShowcasePath } from '@/lib/basePath';

const features = [
  { icon: '📱', label: 'Responsive design for mobile devices' },
  { icon: '🎯', label: 'Search engine optimization' },
  { icon: '🎁', label: 'Structured registry system' },
  { icon: '⚡', label: 'Interactive scroll animations' },
  { icon: '🔍', label: 'Search and category filtering' },
  { icon: '🛡️', label: 'Protected administrative interface' },
  { icon: '🧩', label: 'AGPL-licensed open-source code' },
];

const techStack = [
  { name: 'Next.js (App Router)', type: 'Framework' },
  { name: 'TypeScript & React', type: 'Language' },
  { name: 'Tailwind CSS', type: 'Styling' },
  { name: 'React Three Fiber, Drei & Rapier', type: '3D & Physics' },
  { name: 'TanStack Query & Zod', type: 'State & Validation' },
  { name: 'Node.js API Routes', type: 'Backend' },
  { name: 'Prisma & PostgreSQL', type: 'Data Layer' },
];

const SHOWCASE_ACTION_CLASS =
  'inline-flex items-center gap-1.5 min-h-[32px] min-w-[32px] px-4 py-2 rounded-lg text-sm font-semibold border border-slate-300 dark:border-slate-600 bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-slate-100';

const INLINE_EXTERNAL_LINK_CLASS =
  'underline font-medium text-slate-900 dark:text-slate-100 hover:text-slate-700 dark:hover:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-slate-100 rounded-xs';

const sectionVariants = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.7 } },
};

/**
 * @page ProjectInfo
 * @description A page that provides detailed information about the wedding website project itself.
 *
 * This component serves as a portfolio piece, outlining the project's key features,
 * the technology stack used, an overview of the architecture, and information on
 * deployment and contributing to the open-source project.
 *
 * @returns {JSX.Element} The rendered project information page.
 */
const ProjectInfo = () => {
  const demo = useOptionalDemo();
  const isDemoMode = Boolean(demo?.isDemoMode);
  const docsHref = resolveShowcasePath('/');
  const apiHref = resolveShowcasePath('/api/');
  const storybookHref = resolveShowcasePath('/storybook/');

  return (
    <div className="min-h-screen bg-[var(--color-background)] text-[var(--color-foreground)] selection:bg-primary selection:text-[var(--color-text-on-primary)] dark:selection:bg-primary pb-24">
      {/* Hero Section */}
      <motion.div
        className="max-w-3xl mx-auto text-center py-20 px-4"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true }}
        variants={sectionVariants}
      >
        <h1 className="text-5xl font-extrabold mb-4 bg-gradient-to-r from-primary to-secondary text-transparent bg-clip-text">About This Project</h1>
        <p className="text-lg text-gray-700 dark:text-gray-300 mb-6">
          This website provides information about our wedding and demonstrates full-stack application architecture. It includes a landing page, multi-event RSVPs, a customizable gift registry, and open-source code available for reuse.
        </p>
        <AccessibleExternalLink
          href="https://github.com/fderuiter/wedding_website"
          className="inline-flex items-center gap-2 min-h-[32px] min-w-[32px] px-6 py-2 rounded-full bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-950 font-semibold shadow-lg hover:scale-105 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-slate-900 dark:focus-visible:ring-slate-100"
        >
          <svg aria-hidden="true" className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" /><path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" /></svg>
          View on GitHub
        </AccessibleExternalLink>

        {isDemoMode && (
          <nav
            aria-label="Project showcase navigation"
            data-testid="project-info-showcase-links"
            className="mt-8 p-4 rounded-2xl border border-slate-300 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-900/80 flex flex-wrap items-center justify-center gap-3"
          >
            <a
              href={docsHref}
              data-testid="project-info-link-docs"
              data-static-demo-bypass="true"
              className={SHOWCASE_ACTION_CLASS}
            >
              <Icon name="ArrowLeft" className="w-4 h-4" />
              <span>Documentation Portal</span>
            </a>
            <a
              href={apiHref}
              data-testid="project-info-link-api"
              data-static-demo-bypass="true"
              className={SHOWCASE_ACTION_CLASS}
            >
              <Icon name="Globe" className="w-4 h-4" />
              <span>API Explorer</span>
            </a>
            <AccessibleExternalLink
              href={storybookHref}
              data-testid="project-info-link-storybook"
              data-static-demo-bypass="true"
              showIcon
              iconClassName="w-4 h-4 ml-0.5"
              className={SHOWCASE_ACTION_CLASS}
            >
              <span>Storybook</span>
            </AccessibleExternalLink>
          </nav>
        )}
      </motion.div>

      {/* Features & Tech Stack */}
      <motion.div
        className="max-w-5xl mx-auto grid md:grid-cols-2 gap-10 px-4"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true }}
        variants={sectionVariants}
        custom={1}
      >
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-6 sm:p-10 min-w-0 flex flex-col items-center border border-primary dark:border-gray-700">
          <h2 className="text-2xl font-bold mb-6 text-gray-900 dark:text-gray-100 tracking-tight">Key Features</h2>
          <ul className="space-y-4 w-full">
            {features.map(f => (
              <li key={f.label} className="flex items-start text-base sm:text-lg text-gray-700 dark:text-gray-300">
                <span aria-hidden="true" className="mr-3 text-2xl shrink-0">{f.icon}</span>
                <span className="min-w-0 break-words">{f.label}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-6 sm:p-10 min-w-0 flex flex-col items-center border border-secondary dark:border-gray-700">
          <h2 className="text-2xl font-bold mb-6 text-gray-900 dark:text-gray-100 tracking-tight">Technology Stack</h2>
          <ul className="space-y-4 w-full">
            {techStack.map(t => (
              <li key={t.name} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-base sm:text-lg text-gray-700 dark:text-gray-300">
                <span className="font-semibold text-gray-800 dark:text-gray-200 w-full max-w-44">{t.type}:</span>
                <span className="min-w-0 break-words">{t.name}</span>
              </li>
            ))}
          </ul>
        </div>
      </motion.div>

      {/* Architecture & Structure */}
      <motion.div
        className="max-w-4xl mx-auto mt-16 px-4"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true }}
        variants={sectionVariants}
        custom={2}
      >
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-6 sm:p-10 min-w-0 border border-gray-200 dark:border-gray-700">
          <h2 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100 tracking-tight">Architecture Overview</h2>
          <ul className="list-disc pl-6 text-gray-700 dark:text-gray-300 space-y-2">
            <li><strong>Landing Page:</strong> A responsive landing page featuring a 3D heart animation.</li>
            <li><strong>Registry Page:</strong> Users can browse, search, and filter gifts with an accompanying administrative interface.</li>
            <li><strong>API Endpoints:</strong> Server Route Handlers that interact with PostgreSQL and include a product metadata scraper.</li>
            <li><strong>Data Layer:</strong> Powered by Prisma with portable PostgreSQL database support (compatible with local PostgreSQL, Neon, Supabase, RDS, etc.).</li>
            <li><strong>Styling:</strong> Styled using Tailwind CSS.</li>
            <li><strong>Open Source:</strong> Distributed under the GNU AGPLv3 license.</li>
          </ul>
        </div>
      </motion.div>

      {/* Deployment & Contribution */}
      <div className="max-w-4xl mx-auto mt-12 px-4 grid md:grid-cols-2 gap-8">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-6 sm:p-8 min-w-0 flex flex-col border border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-bold mb-3 text-gray-900 dark:text-gray-100">Deployment</h2>
          <ul className="list-disc pl-6 text-gray-700 dark:text-gray-300 space-y-2">
            <li>Deploy on Docker / VPS, <AccessibleExternalLink href="https://cloud.google.com/run" className={INLINE_EXTERNAL_LINK_CLASS}>Google Cloud Run</AccessibleExternalLink>, <AccessibleExternalLink href="https://vercel.com/" className={INLINE_EXTERNAL_LINK_CLASS}>Vercel</AccessibleExternalLink>, or Railway &amp; Render.</li>
            <li>Run <code>npm ci</code> and <code>npm run dev</code> to start locally.</li>
            <li>Configure environment variables via <code>.env.example</code>.</li>
            <li>See <AccessibleExternalLink href="https://github.com/fderuiter/wedding_website#readme" className={INLINE_EXTERNAL_LINK_CLASS}>README</AccessibleExternalLink> for full setup instructions.</li>
          </ul>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-6 sm:p-8 min-w-0 flex flex-col border border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-bold mb-3 text-gray-900 dark:text-gray-100">Contributing</h2>
          <ul className="list-disc pl-6 text-gray-700 dark:text-gray-300 space-y-2">
            <li>The project is open source and available on GitHub.</li>
            <li>See <AccessibleExternalLink href="https://github.com/fderuiter/wedding_website/blob/main/.github/CONTRIBUTING.md" className={INLINE_EXTERNAL_LINK_CLASS}>CONTRIBUTING.md</AccessibleExternalLink> for guidelines.</li>
            <li>Report issues or submit improvements through pull requests.</li>
          </ul>
        </div>
      </div>

      <div className="text-center text-gray-600 dark:text-gray-300 mt-16 text-sm">
        Made with <span aria-hidden="true" className="text-rose-700 dark:text-rose-400">♥</span> &bull; Open Source on <AccessibleExternalLink className={INLINE_EXTERNAL_LINK_CLASS} href="https://github.com/fderuiter/wedding_website">GitHub</AccessibleExternalLink>
      </div>
    </div>
  );
};

export default ProjectInfo;
