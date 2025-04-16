'use client';

import { motion } from 'framer-motion';

const features = [
  { icon: '📱', label: 'Responsive Design' },
  { icon: '🎯', label: 'SEO Optimized' },
  { icon: '🎁', label: 'Smart Registry System' },
  { icon: '⚡', label: 'Dynamic Animations' },
  { icon: '🔍', label: 'Instant Search & Filtering' },
  { icon: '🛡️', label: 'Admin Dashboard & Gift Tracking' },
  { icon: '🧩', label: 'Modular, Open Source Structure' },
];

const techStack = [
  { name: 'Next.js (App Router)', type: 'Framework' },
  { name: 'TypeScript & React', type: 'Language' },
  { name: 'Tailwind CSS', type: 'Styling' },
  { name: 'React Three Fiber, Drei', type: '3D Animation' },
  { name: 'Fuse.js', type: 'Client-side Search' },
  { name: 'Node.js API Routes', type: 'Backend' },
  { name: 'File/JSON Storage', type: 'Data Layer' },
];

const sectionVariants = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: 'easeOut' } },
};

const ProjectInfo = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 to-yellow-50 pb-24">
      {/* Hero Section */}
      <motion.div
        className="max-w-3xl mx-auto text-center py-20 px-4"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true }}
        variants={sectionVariants}
      >
        <h1 className="text-5xl font-extrabold mb-4 bg-gradient-to-r from-red-400 to-yellow-400 text-transparent bg-clip-text">Project Overview</h1>
        <p className="text-lg text-gray-700 mb-6">
          <strong>Abbigayle & Frederick's Wedding Website & Registry</strong> is a modern, open source web application that serves as both a wedding site and a developer portfolio template. It features a beautiful landing page, a robust registry system, and a clean, modular codebase designed for easy reuse and extension.
        </p>
        <a
          href="https://github.com/FrederickdeRuiter"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-6 py-2 rounded-full bg-gradient-to-r from-red-400 to-yellow-400 text-white font-semibold shadow-lg hover:scale-105 transition-transform"
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
        <div className="bg-white/90 rounded-2xl shadow-xl p-10 flex flex-col items-center">
          <h2 className="text-2xl font-bold mb-6 text-red-500 tracking-tight">Key Features</h2>
          <ul className="space-y-4 w-full">
            {features.map(f => (
              <li key={f.label} className="flex items-center text-lg text-gray-700">
                <span className="mr-3 text-2xl">{f.icon}</span> {f.label}
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-white/90 rounded-2xl shadow-xl p-10 flex flex-col items-center">
          <h2 className="text-2xl font-bold mb-6 text-yellow-500 tracking-tight">Tech Stack</h2>
          <ul className="space-y-4 w-full">
            {techStack.map(t => (
              <li key={t.name} className="flex items-center text-lg text-gray-700">
                <span className="font-semibold text-gray-900 w-40 inline-block">{t.type}:</span> {t.name}
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
        <div className="bg-white/90 rounded-2xl shadow-xl p-10">
          <h2 className="text-2xl font-bold mb-4 text-yellow-600 tracking-tight">Architecture & Structure</h2>
          <ul className="list-disc pl-6 text-gray-700 space-y-2">
            <li><strong>Landing Page:</strong> Animated hero, event info, and a 3D scene (React Three Fiber).</li>
            <li><strong>Registry Page:</strong> Search, filter, and claim/contribute to gifts. Item detail modals and admin dashboard for management.</li>
            <li><strong>API Endpoints:</strong> RESTful routes for registry items, contributions, and web scraping (for adding gifts by URL).</li>
            <li><strong>Data Layer:</strong> JSON file storage for registry items and contributions (easy to migrate to a database).</li>
            <li><strong>Styling:</strong> Tailwind CSS for rapid, responsive design.</li>
            <li><strong>Open Source:</strong> MIT License, clear project structure, and documentation for easy reuse.</li>
          </ul>
        </div>
      </motion.div>

      {/* Deployment & Contribution */}
      <div className="max-w-4xl mx-auto mt-12 px-4 grid md:grid-cols-2 gap-8">
        <div className="bg-white/90 rounded-2xl shadow-xl p-8 flex flex-col">
          <h2 className="text-xl font-bold mb-3 text-green-600">Deployment</h2>
          <ul className="list-disc pl-6 text-gray-700 space-y-2">
            <li>Deploy easily to <a href='https://vercel.com/' className='underline text-green-700' target='_blank' rel='noopener noreferrer'>Vercel</a> or <a href='https://www.netlify.com/' className='underline text-green-700' target='_blank' rel='noopener noreferrer'>Netlify</a>.</li>
            <li>Run <code>npm install</code> and <code>npm run dev</code> to start locally.</li>
            <li>Configure environment variables via <code>.env.example</code>.</li>
            <li>See <a href='https://github.com/FrederickdeRuiter/wedding_website#readme' className='underline text-green-700' target='_blank' rel='noopener noreferrer'>README</a> for full setup instructions.</li>
          </ul>
        </div>
        <div className="bg-white/90 rounded-2xl shadow-xl p-8 flex flex-col">
          <h2 className="text-xl font-bold mb-3 text-blue-600">Contributing</h2>
          <ul className="list-disc pl-6 text-gray-700 space-y-2">
            <li>Open source under MIT. Fork, star, and contribute on GitHub.</li>
            <li>See <a href='https://github.com/FrederickdeRuiter/wedding_website/blob/main/CONTRIBUTING.md' className='underline text-blue-700' target='_blank' rel='noopener noreferrer'>CONTRIBUTING.md</a> for guidelines.</li>
            <li>Issues and feature requests welcome!</li>
          </ul>
        </div>
      </div>

      {/* Footer Note */}
      <div className="text-center text-gray-500 mt-16 text-sm">
        Made with <span className="text-red-400">♥</span> &bull; Open Source on <a className="underline" href="https://github.com/FrederickdeRuiter/wedding_website" target="_blank" rel="noopener noreferrer">GitHub</a>
      </div>
    </div>
  );
};

export default ProjectInfo;
