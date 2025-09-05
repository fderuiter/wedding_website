import React from 'react';
import { motion } from 'framer-motion';

/**
 * @interface RegistryItemProgressBarProps
 * @description Defines the props for the RegistryItemProgressBar component.
 * @property {number} contributed - The amount that has been contributed towards the item.
 * @property {number} total - The total price of the item.
 * @property {string} [className] - Optional CSS class names to apply to the component.
 */
interface RegistryItemProgressBarProps {
  contributed: number;
  total: number;
  className?: string;
}

/**
 * @function RegistryItemProgressBar
 * @description A React component that displays a progress bar indicating how much of a group gift has been funded.
 * @param {RegistryItemProgressBarProps} props - The props for the component.
 * @returns {JSX.Element} The rendered RegistryItemProgressBar component.
 */
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
