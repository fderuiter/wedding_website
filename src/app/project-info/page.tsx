'use client';

import { motion } from 'framer-motion';

const features = [
  { icon: '📱', label: 'Responsive design for mobile devices' },
  { icon: '🎯', label: 'Search engine optimization' },
  { icon: '🎁', label: 'Structured registry system' },
  { icon: '⚡', label: 'Interactive scroll animations' },
  { icon: '🔍', label: 'Fuzzy search with filtering' },
  { icon: '🛡️', label: 'Protected administrative interface' },
  { icon: '🧩', label: 'MIT-licensed open-source code' },
];

const techStack = [
  { name: 'Next.js (App Router)', type: 'Framework' },
  { name: 'TypeScript & React', type: 'Language' },
  { name: 'Tailwind CSS', type: 'Styling' },
  { name: 'React Three Fiber, Drei', type: '3D Library' },
  { name: 'Fuse.js', type: 'Search Library' },
  { name: 'Node.js API Routes', type: 'Backend' },
  { name: 'Prisma & PostgreSQL (Neon)', type: 'Data Layer' },
];

import { Variants } from 'framer-motion';

const sectionVariants: Variants = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0, 0, 0.58, 1.0] } },
};

const ProjectInfo = () => {
  return (
    <div className="min-h-screen bg-[var(--color-background)] text-[var(--color-foreground)] selection:bg-rose-100 selection:text-rose-900 dark:selection:bg-rose-800 pb-24">
      {/* Hero Section */}
      <motion.div
        className="max-w-3xl mx-auto text-center py-20 px-4"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true }}
        variants={sectionVariants}
      >
        <h1 className="text-5xl font-extrabold mb-4 bg-gradient-to-r from-rose-700 to-amber-500 text-transparent bg-clip-text">About This Project</h1>
        <p className="text-lg text-gray-700 dark:text-gray-300 mb-6">
          This website provides information about our wedding and demonstrates my full-stack development capabilities. It includes a landing page, a functional registry, and open-source code available for reuse.
        </p>
        <a
          href="https://github.com/fderuiter/wedding_website"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-6 py-2 rounded-full bg-gradient-to-r from-rose-700 to-amber-500 text-white font-semibold shadow-lg hover:scale-105 transition-transform"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" /><path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" /></svg>
          View on GitHub
        </a>
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
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-10 flex flex-col items-center border border-rose-100 dark:border-gray-700">
          <h2 className="text-2xl font-bold mb-6 text-rose-700 tracking-tight">Key Features</h2>
          <ul className="space-y-4 w-full">
            {features.map(f => (
              <li key={f.label} className="flex items-center text-lg text-gray-700 dark:text-gray-300">
                <span className="mr-3 text-2xl">{f.icon}</span> {f.label}
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-10 flex flex-col items-center border border-amber-100 dark:border-gray-700">
          <h2 className="text-2xl font-bold mb-6 text-amber-600 tracking-tight">Technology Stack</h2>
          <ul className="space-y-4 w-full">
            {techStack.map(t => (
              <li key={t.name} className="flex items-center text-lg text-gray-700 dark:text-gray-300">
                <span className="font-semibold text-gray-800 dark:text-gray-200 w-40 inline-block">{t.type}:</span> {t.name}
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
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-10 border border-gray-200 dark:border-gray-700">
          <h2 className="text-2xl font-bold mb-4 text-rose-700 tracking-tight">Architecture Overview</h2>
          <ul className="list-disc pl-6 text-gray-700 dark:text-gray-300 space-y-2">
            <li><strong>Landing Page:</strong> A responsive landing page featuring a 3D heart animation.</li>
            <li><strong>Registry Page:</strong> Users can browse, search, and filter gifts with an accompanying administrative interface.</li>
            <li><strong>API Endpoints:</strong> Serverless routes that interact with the database and include a basic web scraper.</li>
            <li><strong>Data Layer:</strong> Powered by Prisma with a PostgreSQL database hosted on Neon.</li>
            <li><strong>Styling:</strong> Styled using Tailwind CSS.</li>
            <li><strong>Open Source:</strong> Distributed under the MIT license.</li>
          </ul>
        </div>
      </motion.div>

      {/* Deployment & Contribution */}
      <div className="max-w-4xl mx-auto mt-12 px-4 grid md:grid-cols-2 gap-8">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 flex flex-col border border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-bold mb-3 text-rose-700">Deployment</h2>
          <ul className="list-disc pl-6 text-gray-700 dark:text-gray-300 space-y-2">
            <li>Deploy to <a href='https://vercel.com/' className='underline text-rose-600 dark:text-rose-400 hover:text-rose-800 dark:hover:text-rose-300' target='_blank' rel='noopener noreferrer'>Vercel</a> or <a href='https://www.netlify.com/' className='underline text-rose-600 dark:text-rose-400 hover:text-rose-800 dark:hover:text-rose-300' target='_blank' rel='noopener noreferrer'>Netlify</a>.</li>
            <li>Run <code>npm install</code> and <code>npm run dev</code> to start locally.</li>
            <li>Configure environment variables via <code>.env.example</code>.</li>
            <li>See <a href='https://github.com/fderuiter/wedding_website#readme' className='underline text-rose-600 dark:text-rose-400 hover:text-rose-800 dark:hover:text-rose-300' target='_blank' rel='noopener noreferrer'>README</a> for full setup instructions.</li>
          </ul>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 flex flex-col border border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-bold mb-3 text-amber-600">Contributing</h2>
          <ul className="list-disc pl-6 text-gray-700 dark:text-gray-300 space-y-2">
            <li>The project is open source and available on GitHub.</li>
            <li>See <a href='https://github.com/fderuiter/wedding_website' className='underline text-rose-600 dark:text-rose-400 hover:text-rose-800 dark:hover:text-rose-300' target='_blank' rel='noopener noreferrer'>CONTRIBUTING.md</a> for guidelines.</li>
            <li>Report issues or submit improvements through pull requests.</li>
          </ul>
        </div>
      </div>

      <div className="text-center text-gray-500 dark:text-gray-400 mt-16 text-sm">
        Made with <span className="text-rose-500">♥</span> &bull; Open Source on <a className="underline text-rose-600 dark:text-rose-400 hover:text-rose-800 dark:hover:text-rose-300" href="https://github.com/fderuiter/wedding_website" target="_blank" rel="noopener noreferrer">GitHub</a>
      </div>
    </div>
  );
};

export default ProjectInfo;
