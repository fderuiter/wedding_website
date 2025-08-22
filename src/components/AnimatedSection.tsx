'use client'

import { motion, HTMLMotionProps } from 'framer-motion'
import React from 'react'

const fadeUp = {
  hidden: { opacity: 0, y: 40 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.15 * i, duration: 0.8 },
  }),
}

interface AnimatedSectionProps extends HTMLMotionProps<'section'> {
  children: React.ReactNode
  custom?: number
}

export default function AnimatedSection({
  children,
  custom = 0,
  ...props
}: AnimatedSectionProps) {
  return (
    <motion.section
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true }}
      variants={fadeUp}
      custom={custom}
      {...props}
    >
      {children}
    </motion.section>
  )
}
