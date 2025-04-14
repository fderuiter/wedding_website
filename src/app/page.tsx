'use client';

import { motion } from 'framer-motion';
import { AddToCalendarButton } from 'add-to-calendar-button-react'; // Corrected import path again
import theme from '@/styles/theme';
import WeddingScene from '@/components/WeddingScene';

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

export default function Home() {
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
              className="text-6xl md:text-7xl lg:text-8xl font-bold"
              style={{
                background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.secondary})`,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
              initial={{ y: -50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            >
              Abbi & Fred
            </motion.h1>
            <motion.p 
              className="text-2xl md:text-3xl text-gray-700"
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
            >
              April 15, 2025
            </motion.p>
            <motion.div 
              className="pt-8"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.4 }}
            >
              <motion.a 
                href="#story" 
                className="inline-block px-8 py-3 rounded-full font-medium text-white shadow-lg"
                style={{
                  background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.secondary})`,
                }}
                whileHover={{ 
                  scale: 1.05,
                  boxShadow: '0 10px 20px rgba(0,0,0,0.2)',
                }}
                whileTap={{ scale: 0.95 }}
              >
                Our Story
              </motion.a>
            </motion.div>
          </div>
        </section>

        {/* Story Section with Animations */}
        <motion.section 
          id="story" 
          className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto"
          initial={{ opacity: 0, y: 50 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
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
              Our journey began in the tech world, where our shared passion for coding
              and innovation brought us together. What started as collaborative projects
              soon blossomed into something more meaningful. Through countless coffee-fueled
              coding sessions and debugging adventures, we discovered that our best feature
              was the love we share.
            </motion.p>
          </div>
        </motion.section>

        {/* Event Details Section with Enhanced Interactions */}
        <section className="py-20 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
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
              <AddToCalendarButton
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
        </section>

        {/* 3D Wedding Scene Section */}
        <motion.section 
          className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto" 
          id="portfolio"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
        >
          <motion.h2 
            className="text-4xl font-bold text-center mb-12"
            style={{ color: theme.colors.primary }}
            initial={{ y: 30, opacity: 0 }}
            whileInView={{ y: 0, opacity: 1 }}
            viewport={{ once: true }}
          >
            Our Wedding Experience
          </motion.h2>
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            whileInView={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
          >
            <div className="rounded-xl overflow-hidden shadow-2xl">
              <WeddingScene />
            </div>
          </motion.div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[ 
              {
                title: "Tech Stack",
                items: [
                  { icon: "⚡", text: "Next.js & React" },
                  { icon: "📘", text: "TypeScript" },
                  { icon: "🎨", text: "Tailwind CSS" },
                  { icon: "🔄", text: "Full Stack Development" },
                ],
              },
              {
                title: "Website Features",
                items: [
                  { icon: "📱", text: "Responsive Design" },
                  { icon: "🎯", text: "SEO Optimized" },
                  { icon: "🎁", text: "Smart Registry System" },
                  { icon: "⚡", text: "Dynamic Animations" },
                ],
              },
              {
                title: "Open Source",
                content: "This wedding website is open source and available on GitHub. Built with modern web technologies and best practices.",
                link: {
                  text: "View Project",
                  url: "https://github.com/FrederickdeRuiter",
                },
              },
            ].map((card, index) => (
              <motion.div
                key={card.title}
                className="bg-white/80 backdrop-blur-sm p-8 rounded-xl shadow-lg"
                initial={{ y: 50, opacity: 0 }}
                whileInView={{ y: 0, opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.2 }}
                whileHover={{ 
                  scale: 1.03,
                  boxShadow: '0 20px 30px rgba(0,0,0,0.1)',
                }}
              >
                <h3 className="text-xl font-semibold mb-4" style={{ color: theme.colors.primary }}>{card.title}</h3>
                {card.items ? (
                  <ul className="space-y-2 text-gray-600">
                    {card.items.map((item) => (
                      <motion.li
                        key={item.text}
                        className="flex items-center"
                        whileHover={{ x: 5 }}
                      >
                        <span className="mr-2">{item.icon}</span> {item.text}
                      </motion.li>
                    ))}
                  </ul>
                ) : (
                  <>
                    <p className="text-gray-600 mb-4">{card.content}</p>
                    {card.link && (
                      <motion.a
                        href={card.link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center"
                        style={{ color: theme.colors.primary }}
                        whileHover={{ x: 5 }}
                      >
                        <span>{card.link.text}</span>
                        <svg className="ml-2 h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                          <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                        </svg>
                      </motion.a>
                    )}
                  </>
                )}
              </motion.div>
            ))} 
          </div>
        </motion.section>
      </div>
    </>
  );
}
