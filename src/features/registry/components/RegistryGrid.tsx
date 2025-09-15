'use client';

import React from 'react';
import { motion } from 'framer-motion';
import RegistryCard from './RegistryCard';
import RegistryCardSkeleton from './RegistryCardSkeleton';
import EmptyState from '@/components/EmptyState';
import { RegistryItem } from '../types';

interface RegistryGridProps {
  isLoading: boolean;
  visibleItems: RegistryItem[];
  filteredItems: RegistryItem[];
  isAdmin: boolean;
  handleCardClick: (item: RegistryItem) => void;
  handleEdit: (id: string) => void;
  handleDelete: (id: string) => void;
  loadMoreRef: (node?: Element | null | undefined) => void;
}

const gridVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

export function RegistryGrid({
  isLoading,
  visibleItems,
  filteredItems,
  isAdmin,
  handleCardClick,
  handleEdit,
  handleDelete,
  loadMoreRef,
}: RegistryGridProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-10 max-w-7xl mx-auto">
        {Array.from({ length: 12 }).map((_, index) => (
          <RegistryCardSkeleton key={index} />
        ))}
      </div>
    );
  }

  if (visibleItems.length === 0) {
    return <EmptyState message="No gifts match the current filters. Try adjusting your search!" />;
  }

  return (
    <>
      <motion.div
        className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-10 max-w-7xl mx-auto"
        variants={gridVariants}
        initial="hidden"
        animate="visible"
        aria-live="polite"
      >
        {visibleItems.map((item) => (
          <motion.div key={item.id} variants={cardVariants}>
            <RegistryCard
              item={item}
              onClick={() => handleCardClick(item)}
              isAdmin={isAdmin}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          </motion.div>
        ))}
      </motion.div>

      {visibleItems.length < filteredItems.length && (
        <div ref={loadMoreRef} className="text-center p-4 col-span-full">
          <p className="text-gray-500">Loading more gifts...</p>
        </div>
      )}
    </>
  );
}
