'use client';

import { motion } from 'framer-motion';

const features = [
  { icon: '📱', label: 'Looks Okay on Phones (Probably)' },
  { icon: '🎯', label: 'SEO? Sure, I Put Keywords Somewhere' },
  { icon: '🎁', label: 'Over-Engineered Registry System' },
  { icon: '⚡', label: 'Things Move When You Scroll (Ooh! Aaah!)' },
  { icon: '🔍', label: 'Search That Mostly Works' },
  { icon: '🛡️', label: 'Admin Area (Password Not Included)' },
  { icon: '🧩', label: 'Code You Can Steal (MIT License)' },
];

const techStack = [
  { name: 'Next.js (App Router)', type: 'Framework' }, // Because Hype
  { name: 'TypeScript & React', type: 'Language' }, // For the Type Safety Theater
  { name: 'Tailwind CSS', type: 'Styling' }, // Utility Classes Galore
  { name: 'React Three Fiber, Drei', type: '3D Stuff' }, // That One Heart Animation
  { name: 'Fuse.js', type: 'Search Thingy' }, // Client-Side Fuzzy Search
  { name: 'Node.js API Routes', type: 'Backend-ish' }, // Serverless Functions, Basically
  { name: 'Prisma & SQLite', type: 'Data Layer' }, // Used to be JSON, Now Fancy
];

const sectionVariants = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: 'easeOut' } },
};

const ProjectInfo = () => {
  return (
    <div className="min-h-screen bg-[#fffdfc] text-[#374151] selection:bg-rose-100 selection:text-rose-900 pb-24">
      {/* Hero Section */}
      <motion.div
        className="max-w-3xl mx-auto text-center py-20 px-4"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true }}
        variants={sectionVariants}
      >
        <h1 className="text-5xl font-extrabold mb-4 bg-gradient-to-r from-rose-700 to-amber-500 text-transparent bg-clip-text">About This Thing I Built</h1>
        <p className="text-lg text-gray-700 mb-6">
          Behold! A website. For a wedding. That also doubles as a desperate plea for someone to hire me based on this single, slightly overcooked project. It has a landing page, a registry that actually works (mostly), and code you can borrow if you promise not to look too closely.
        </p>
        <a
          href="https://github.com/FrederickdeRuiter"
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
        <div className="bg-white rounded-2xl shadow-xl p-10 flex flex-col items-center border border-rose-100">
          <h2 className="text-2xl font-bold mb-6 text-rose-700 tracking-tight">&quot;Features&quot; (Allegedly)</h2>
          <ul className="space-y-4 w-full">
            {features.map(f => (
              <li key={f.label} className="flex items-center text-lg text-gray-700">
                <span className="mr-3 text-2xl">{f.icon}</span> {f.label}
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-white rounded-2xl shadow-xl p-10 flex flex-col items-center border border-amber-100">
          <h2 className="text-2xl font-bold mb-6 text-amber-600 tracking-tight">Tech I Used (And Sometimes Regretted)</h2>
          <ul className="space-y-4 w-full">
            {techStack.map(t => (
              <li key={t.name} className="flex items-center text-lg text-gray-700">
                <span className="font-semibold text-gray-800 w-40 inline-block">{t.type}:</span> {t.name}
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
        <div className="bg-white rounded-2xl shadow-xl p-10 border border-gray-200">
          <h2 className="text-2xl font-bold mb-4 text-rose-700 tracking-tight">How It&apos;s Cobbled Together</h2>
          <ul className="list-disc pl-6 text-gray-700 space-y-2">
            <li><strong>Landing Page:</strong> Standard wedding stuff, plus a heart that spins. Fancy.</li>
            <li><strong>Registry Page:</strong> Click buttons, maybe buy us stuff. Search and filter if you&apos;re picky. Admin area for us to fix your mistakes.</li>
            <li><strong>API Endpoints:</strong> Some server-side code that talks to the database. Includes a web scraper that barely works.</li>
            <li><strong>Data Layer:</strong> Started with JSON, got ambitious, now it&apos;s Prisma and SQLite. Probably overkill.</li>
            <li><strong>Styling:</strong> Tailwind CSS, because writing actual CSS is hard.</li>
            <li><strong>Open Source:</strong> Yeah, it&apos;s MIT licensed. Go nuts. Structure is... present.</li>
          </ul>
        </div>
      </motion.div>

      {/* Deployment & Contribution */}
      <div className="max-w-4xl mx-auto mt-12 px-4 grid md:grid-cols-2 gap-8">
        <div className="bg-white rounded-2xl shadow-xl p-8 flex flex-col border border-gray-200">
          <h2 className="text-xl font-bold mb-3 text-rose-700">Making It Go Live (Good Luck)</h2>
          <ul className="list-disc pl-6 text-gray-700 space-y-2">
            <li>Deploy easily to <a href='https://vercel.com/' className='underline text-rose-600 hover:text-rose-800' target='_blank' rel='noopener noreferrer'>Vercel</a> or <a href='https://www.netlify.com/' className='underline text-rose-600 hover:text-rose-800' target='_blank' rel='noopener noreferrer'>Netlify</a>.</li>
            <li>Run <code>npm install</code> and <code>npm run dev</code> to start locally.</li>
            <li>Configure environment variables via <code>.env.example</code>.</li>
            <li>See <a href='https://github.com/fderuiter/wedding_website#readme' className='underline text-rose-600 hover:text-rose-800' target='_blank' rel='noopener noreferrer'>README</a> for full setup instructions.</li>
          </ul>
        </div>
        <div className="bg-white rounded-2xl shadow-xl p-8 flex flex-col border border-gray-200">
          <h2 className="text-xl font-bold mb-3 text-amber-600">&quot;Contributing&quot; (Why?)</h2>
          <ul className="list-disc pl-6 text-gray-700 space-y-2">
            <li>It&apos;s open source. Feel free to point and laugh on GitHub.</li>
            <li>See <a href='https://github.com/fderuiter/wedding_website' className='underline text-rose-600 hover:text-rose-800' target='_blank' rel='noopener noreferrer'>CONTRIBUTING.md</a> for guidelines.</li>
            <li>If you find a bug, maybe fix it? Or just open an issue and complain.</li>
          </ul>
        </div>
      </div>

      <div className="text-center text-gray-500 mt-16 text-sm">
        Made with <span className="text-rose-500">♥</span> &bull; Open Source on <a className="underline text-rose-600 hover:text-rose-800" href="https://github.com/fderuiter/wedding_website" target="_blank" rel="noopener noreferrer">GitHub</a>
      </div>
    </div>
  );
};

export default ProjectInfo;
