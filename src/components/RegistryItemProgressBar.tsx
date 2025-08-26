import React from 'react';
import { motion } from 'framer-motion';

interface RegistryItemProgressBarProps {
  contributed: number;
  total: number;
  className?: string;
}

const RegistryItemProgressBar: React.FC<RegistryItemProgressBarProps> = ({ contributed, total, className }) => {
  const percent = total > 0 ? Math.min(100, (contributed / total) * 100) : 0;
  return (
    <div className={`w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 mt-1 ${className || ''}`.trim()} role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Gift funding progress">
      <motion.div
        className="bg-blue-600 dark:bg-blue-400 h-2.5 rounded-full"
        initial={{ width: 0 }}
        animate={{ width: `${percent}%` }}
        transition={{ duration: 0.8, ease: "easeInOut" }}
      />
    </div>
  );
};

export default RegistryItemProgressBar;
