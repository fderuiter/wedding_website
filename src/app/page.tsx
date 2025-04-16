'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import theme from '@/styles/theme';
import dynamic from 'next/dynamic';
import LoadingScreen from '@/components/LoadingScreen';
const WeddingScene = dynamic<{ onFinish?: () => void }>(
  () => import('@/components/WeddingScene'),
  { ssr: false, loading: () => <LoadingScreen /> }
);

// Dynamically import AddToCalendarButton with SSR disabled
const AddToCalendarButtonClient = dynamic(() => import('add-to-calendar-button-react').then(mod => mod.AddToCalendarButton), {
  ssr: false,
  // Optional: Add a loading state while the component loads
  // loading: () => <p>Loading calendar button...</p> 
});

// Add schema.org Event markup for SEO
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "Event",
  "name": "Abbigayle & Frederick's Wedding",
  "startDate": "2025-04-15T14:00:00-04:00",
  "endDate": "2025-04-15T22:00:00-04:00",
  "eventStatus": "https://schema.org/EventScheduled",
  "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
  "description": "Wedding celebration of Abbigayle Schultz and Frederick de Ruiter",
  "organizer": {
    "@type": "Person",
    "name": "Frederick de Ruiter",
    "url": "https://github.com/FrederickdeRuiter"
  }
};

// Define motion variants for smoother section transitions
const sectionVariants = {
  hidden: { opacity: 0, y: 40 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.15 * i, duration: 0.8, ease: 'easeOut' },
  }),
};

export default function Home() {
  const [showIntro, setShowIntro] = useState(true);
  if (showIntro) {
    return <WeddingScene onFinish={() => setShowIntro(false)} />;
  }
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="flex flex-col min-h-screen">
        {/* Hero Section with Enhanced Animations */}
        <section className="relative h-screen flex items-center justify-center overflow-hidden">
          <motion.div 
            className="absolute inset-0 bg-gradient-to-b from-red-50 to-yellow-50 z-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1.5 }}
          />
          <motion.div
            className="absolute inset-0"
            style={{
              background: `radial-gradient(circle at 50% 50%, ${theme.colors.primaryLight}15, ${theme.colors.secondaryLight}15)`,
            }}
            animate={{
              scale: [1, 1.1, 1],
              opacity: [0.5, 0.3, 0.5],
            }}
            transition={{
              duration: 8,
              repeat: Infinity,
              repeatType: "reverse",
            }}
          />
          <div className="relative z-20 text-center space-y-6">
            <motion.h1 
              className="text-6xl md:text-7xl lg:text-8xl font-bold drop-shadow-xl"
              style={{
                background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.secondary})`,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
              initial="hidden"
              animate="visible"
              variants={sectionVariants}
              custom={0}
            >
              Abbi & Fred
            </motion.h1>
            <motion.p 
              className="text-2xl md:text-3xl text-gray-700"
              initial="hidden"
              animate="visible"
              variants={sectionVariants}
              custom={1}
            >
              April 15, 2025
            </motion.p>
            <motion.div 
              className="pt-8"
              initial="hidden"
              animate="visible"
              variants={sectionVariants}
              custom={2}
            >
              <motion.a 
                href="/project-info" 
                className="inline-block px-8 py-3 rounded-full font-medium text-white shadow-lg transition-transform"
                style={{
                  background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.secondary})`,
                }}
                whileHover={{ scale: 1.07, boxShadow: '0 10px 24px rgba(0,0,0,0.18)' }}
                whileTap={{ scale: 0.97 }}
              >
                Project Info
              </motion.a>
            </motion.div>
          </div>
        </section>
        {/* Story Section with Smoother Animation */}
        <motion.section 
          id="story" 
          className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={sectionVariants}
          custom={3}
        >
          <h2 className="text-4xl font-bold text-center mb-12" style={{ color: theme.colors.primary }}>Our Story</h2>
          <div className="prose lg:prose-lg mx-auto">
            <motion.p 
              className="text-lg text-gray-700 leading-relaxed"
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
            >
              Once upon a swipe, Abbi and Fred found each other on Hinge—two souls searching for the same spark. Their first conversations were sprinkled with laughter, stories of late-night hot dog runs, and a shared reverence for kindness and humility. 
              <br /><br />
              Abbi, a nurse practitioner with a heart for healing, and Fred, a tech developer who builds with both code and care, quickly discovered that love is best written in moments both big and small. Together, they cherish the simple joys: a perfectly grilled hot dog, a clever joke, and the comfort of knowing they are truly seen.
              <br /><br />
              Their story is one of laughter echoing through city streets, of gentle encouragement through life’s challenges, and of two hearts choosing each other—again and again. Today, they invite you to celebrate the beautiful adventure that began with a swipe and blossomed into a lifetime of love.
            </motion.p>
          </div>
        </motion.section>
        {/* Event Details Section with Enhanced Interactions */}
        <motion.section
          className="py-20 px-4 sm:px-6 lg:px-8 relative overflow-hidden"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={sectionVariants}
          custom={4}
        >
          <motion.div 
            className="absolute inset-0" 
            style={{
              background: `linear-gradient(135deg, ${theme.colors.primaryLight}15, ${theme.colors.secondaryLight}15)`,
            }}
            animate={{
              backgroundPosition: ['0% 0%', '100% 100%'],
            }}
            transition={{
              duration: 20,
              repeat: Infinity,
              repeatType: "reverse",
            }}
          />
          <div className="max-w-7xl mx-auto relative z-10">
            <motion.h2 
              className="text-4xl font-bold text-center mb-12"
              style={{ color: theme.colors.primary }}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
            >
              Celebration Details
            </motion.h2>
            <div className="grid md:grid-cols-2 gap-8">
              <motion.div 
                className="bg-white/80 backdrop-blur-sm p-8 rounded-xl shadow-lg"
                whileHover={{ 
                  scale: 1.05,
                  boxShadow: '0 20px 30px rgba(0,0,0,0.1)',
                }}
                initial={{ x: -50, opacity: 0 }}
                whileInView={{ x: 0, opacity: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5 }}
              >
                <h3 className="text-2xl font-semibold mb-4" style={{ color: theme.colors.primary }}>Ceremony</h3>
                <div className="space-y-2 text-gray-600">
                  <p>2:00 PM - 3:00 PM</p>
                  <p>St. Mary's Church</p>
                  <p>123 Wedding Ave</p>
                </div>
              </motion.div>
              <motion.div 
                className="bg-white/80 backdrop-blur-sm p-8 rounded-xl shadow-lg"
                whileHover={{ 
                  scale: 1.05,
                  boxShadow: '0 20px 30px rgba(0,0,0,0.1)',
                }}
                initial={{ x: 50, opacity: 0 }}
                whileInView={{ x: 0, opacity: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5 }}
              >
                <h3 className="text-2xl font-semibold mb-4" style={{ color: theme.colors.secondary }}>Reception</h3>
                <div className="space-y-2 text-gray-600">
                  <p>4:00 PM - 10:00 PM</p>
                  <p>Grand Hotel Ballroom</p>
                  <p>456 Celebration Blvd</p>
                </div>
              </motion.div>
            </div>
            {/* Add to Calendar Button */}
            <motion.div
              className="text-center mt-12"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.4 }}
            >
              {/* Use the dynamically imported component */}
              <AddToCalendarButtonClient
                name={jsonLd.name}
                startDate={jsonLd.startDate.split('T')[0]} // Extract YYYY-MM-DD
                startTime={jsonLd.startDate.split('T')[1].substring(0, 5)} // Extract HH:MM
                endDate={jsonLd.endDate.split('T')[0]} // Extract YYYY-MM-DD
                endTime={jsonLd.endDate.split('T')[1].substring(0, 5)} // Extract HH:MM
                timeZone="America/New_York" // Adjust if needed
                location="St. Mary's Church, 123 Wedding Ave & Grand Hotel Ballroom, 456 Celebration Blvd" // Combine locations or choose primary
                description={jsonLd.description}
                options={['Apple', 'Google', 'Outlook.com', 'Yahoo', 'iCal']}
                buttonStyle="round"
                styleLight="--btn-background: linear-gradient(135deg, var(--primary-color), var(--secondary-color)); --btn-text: #ffffff; --btn-shadow: 0 4px 6px rgba(0,0,0,0.1); --btn-hover-scale: 1.05;"
                styleDark="--btn-background: linear-gradient(135deg, var(--primary-color), var(--secondary-color)); --btn-text: #ffffff; --btn-shadow: 0 4px 6px rgba(0,0,0,0.1); --btn-hover-scale: 1.05;"
                trigger="click"
                inline
                label="Add to Calendar"
                size="2" // Adjust size as needed (0-4)
                customCss={`
                  :root {
                    --primary-color: ${theme.colors.primary};
                    --secondary-color: ${theme.colors.secondary};
                  }
                  .atcb-button {
                    font-weight: 500;
                    padding: 0.75rem 1.5rem;
                    border-radius: 9999px; /* full */
                    transition: all 0.2s ease-in-out;
                  }
                  .atcb-button:hover {
                     box-shadow: 0 10px 20px rgba(0,0,0,0.2);
                  }
                `}
              />
            </motion.div>
          </div>
        </motion.section>
        {/* Floating Project Info Button */}
        <motion.a
          href="/project-info"
          className="fixed bottom-6 right-6 z-50 px-6 py-3 rounded-full shadow-lg bg-gradient-to-r from-red-400 to-yellow-400 text-white font-semibold text-lg transition-transform hover:scale-105 hover:shadow-2xl"
          style={{ boxShadow: '0 8px 24px rgba(230,57,70,0.15)' }}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, delay: 1.2 }}
        >
          Project Info
        </motion.a>
      </div>
    </>
  );
}
