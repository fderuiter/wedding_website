'use client'
import dynamic from 'next/dynamic'
const MotionDiv = dynamic(() => import('framer-motion').then(mod => mod.motion.div), {
  ssr: false,
})

export const AnimatedHeart = () => (
  <MotionDiv
    initial={{ rotate: 0 }}
    animate={{ rotate: 360 }}
    transition={{ duration: 20, repeat: Infinity }}
    className="text-pink-500"
  >
    ❤️
  </MotionDiv>
)
