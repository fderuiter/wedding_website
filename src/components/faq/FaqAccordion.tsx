'use client';

import React, { useState, useMemo, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CategoryFilter } from '@/components/ui/CategoryFilter';
import { Input, FormGroup, Label } from '@/components/ui/forms';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import type { ContentNodeDTO } from '@/features/content';

interface FAQDataPayload {
  question?: string;
  answer?: string;
  category?: string;
  categoryTags?: string[] | string;
  keywords?: string[] | string;
}

export type FAQItemInput = Extract<ContentNodeDTO, { type: 'FAQ' }> | FAQDataPayload;

interface NormalizedFAQItem {
  id: string;
  question: string;
  answer: string;
  category: string;
  categoryTags: string[];
  keywords: string[];
}

interface FaqAccordionProps {
  faqs: FAQItemInput[];
  className?: string;
}

/**
 * Normalizes an FAQ node or FAQ data payload into a consistent structure.
 */
function normalizeFaqItem(item: FAQItemInput, index: number): NormalizedFAQItem {
  let id = `faq-${index}`;
  let data: FAQDataPayload = {};

  if ('data' in item && item.data) {
    if ('id' in item && typeof item.id === 'string' && item.id) {
      id = item.id;
    }
    data = item.data as FAQDataPayload;
  } else {
    data = item as FAQDataPayload;
  }

  const question = data.question?.trim() || '';
  const answer = data.answer?.trim() || '';
  const category = data.category?.trim() || 'General';

  let categoryTags: string[] = [];
  if (Array.isArray(data.categoryTags)) {
    categoryTags = data.categoryTags.map(t => String(t).trim()).filter(Boolean);
  } else if (typeof data.categoryTags === 'string' && data.categoryTags.trim()) {
    categoryTags = data.categoryTags.split(',').map(t => t.trim()).filter(Boolean);
  }

  if (categoryTags.length === 0 && category && category !== 'General') {
    categoryTags = [category];
  }

  let keywords: string[] = [];
  if (Array.isArray(data.keywords)) {
    keywords = data.keywords.map(k => String(k).trim()).filter(Boolean);
  } else if (typeof data.keywords === 'string' && data.keywords.trim()) {
    keywords = data.keywords.split(',').map(k => k.trim()).filter(Boolean);
  }

  return {
    id,
    question,
    answer,
    category,
    categoryTags,
    keywords,
  };
}

/**
 * An interactive, accessible client-side FAQ Accordion component
 * supporting category filtering, real-time search, expand/collapse toggles,
 * and keyboard navigation (WCAG 2.1 AA compliant).
 */
const FaqAccordion: React.FC<FaqAccordionProps> = ({ faqs, className = '' }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [openItemIds, setOpenItemIds] = useState<Record<string, boolean>>({});

  const buttonRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());

  // Normalize all input FAQ items
  const normalizedFaqs = useMemo(() => {
    return faqs.map((faq, idx) => normalizeFaqItem(faq, idx));
  }, [faqs]);

  // Aggregate all unique categories
  const categories = useMemo(() => {
    const set = new Set<string>();
    normalizedFaqs.forEach(faq => {
      if (faq.category) set.add(faq.category);
      faq.categoryTags.forEach(tag => set.add(tag));
    });
    if (set.size === 0) {
      set.add('General');
    }
    return Array.from(set).sort();
  }, [normalizedFaqs]);

  // Filter FAQs based on selected categories and search query
  const visibleFaqs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return normalizedFaqs.filter(faq => {
      // Category filter check
      if (selectedCategories.length > 0) {
        const itemCats = [faq.category, ...faq.categoryTags];
        const matchesCategory = selectedCategories.some(cat => itemCats.includes(cat));
        if (!matchesCategory) return false;
      }

      // Search query check
      if (query) {
        const inQuestion = faq.question.toLowerCase().includes(query);
        const inAnswer = faq.answer.toLowerCase().includes(query);
        const inCategory = faq.category.toLowerCase().includes(query);
        const inCategoryTags = faq.categoryTags.some(tag => tag.toLowerCase().includes(query));
        const inKeywords = faq.keywords.some(kw => kw.toLowerCase().includes(query));

        if (!inQuestion && !inAnswer && !inCategory && !inCategoryTags && !inKeywords) {
          return false;
        }
      }

      return true;
    });
  }, [normalizedFaqs, selectedCategories, searchQuery]);

  // Auto-expand items when searching if a query is present
  const isSearchActive = searchQuery.trim().length > 0;

  const isItemOpen = useCallback((id: string) => {
    if (isSearchActive) return true;
    return !!openItemIds[id];
  }, [isSearchActive, openItemIds]);

  const toggleItem = (id: string) => {
    setOpenItemIds(prev => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const handleExpandAll = () => {
    const newMap: Record<string, boolean> = { ...openItemIds };
    visibleFaqs.forEach(faq => {
      newMap[faq.id] = true;
    });
    setOpenItemIds(newMap);
  };

  const handleCollapseAll = () => {
    const newMap: Record<string, boolean> = { ...openItemIds };
    visibleFaqs.forEach(faq => {
      newMap[faq.id] = false;
    });
    setOpenItemIds(newMap);
  };

  // Keyboard navigation across accordion headers
  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    const total = visibleFaqs.length;
    if (total === 0) return;

    let targetIndex: number | null = null;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        targetIndex = (currentIndex + 1) % total;
        break;
      case 'ArrowUp':
        e.preventDefault();
        targetIndex = (currentIndex - 1 + total) % total;
        break;
      case 'Home':
        e.preventDefault();
        targetIndex = 0;
        break;
      case 'End':
        e.preventDefault();
        targetIndex = total - 1;
        break;
      default:
        break;
    }

    if (targetIndex !== null) {
      const targetFaq = visibleFaqs[targetIndex];
      const targetBtn = buttonRefs.current.get(targetFaq.id);
      targetBtn?.focus();
    }
  };

  if (normalizedFaqs.length === 0) {
    return (
      <div className={`text-center py-8 text-gray-500 dark:text-gray-400 ${className}`}>
        No FAQs available yet.
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Live Search and Expand/Collapse Controls */}
      <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center justify-between">
        <FormGroup className="flex-1 mb-0 space-y-1">
          <Label htmlFor="faq-search-input" className="sr-only">
            Search FAQs
          </Label>
          <div className="relative">
            <Input
              id="faq-search-input"
              type="search"
              placeholder="Search FAQs by question, answer, or topic..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pr-10"
              aria-label="Search FAQs"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary rounded p-1"
                aria-label="Clear search query"
              >
                ✕
              </button>
            )}
          </div>
        </FormGroup>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleExpandAll}
            aria-label="Expand all FAQ items"
          >
            Expand All
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCollapseAll}
            aria-label="Collapse all FAQ items"
          >
            Collapse All
          </Button>
        </div>
      </div>

      {/* Category Filter Pills */}
      {categories.length > 0 && (
        <div className="flex flex-col space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Filter by Category:
            </span>
            {selectedCategories.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedCategories([])}
                className="text-xs text-primary hover:underline font-medium"
              >
                Clear filter ({selectedCategories.length})
              </button>
            )}
          </div>
          <CategoryFilter
            categories={categories}
            selected={selectedCategories}
            onChange={setSelectedCategories}
          />
        </div>
      )}

      {/* Screen Reader Status Announcement */}
      <div className="sr-only" role="status" aria-live="polite">
        Showing {visibleFaqs.length} of {normalizedFaqs.length} FAQs
      </div>

      {/* Accordion List */}
      <div className="space-y-3">
        {visibleFaqs.length > 0 ? (
          visibleFaqs.map((faq, index) => {
            const isOpen = isItemOpen(faq.id);
            const headerId = `faq-header-${faq.id}`;
            const answerId = `faq-answer-${faq.id}`;

            return (
              <div
                key={faq.id}
                className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden transition-colors"
              >
                <h3>
                  <button
                    type="button"
                    ref={(el) => {
                      if (el) buttonRefs.current.set(faq.id, el);
                      else buttonRefs.current.delete(faq.id);
                    }}
                    id={headerId}
                    aria-expanded={isOpen}
                    aria-controls={answerId}
                    onClick={() => toggleItem(faq.id)}
                    onKeyDown={(e) => handleKeyDown(e, index)}
                    className="w-full flex items-center justify-between p-4 text-left font-semibold text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-750 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-colors cursor-pointer"
                  >
                    <span className="flex-1 pr-4">{faq.question}</span>
                    <span className="flex items-center gap-2">
                      {faq.category && faq.category !== 'General' && (
                        <span className="hidden sm:inline-block px-2.5 py-0.5 text-xs rounded-full bg-primary/10 text-primary font-medium">
                          {faq.category}
                        </span>
                      )}
                      <span
                        className={`transform transition-transform duration-200 text-gray-500 dark:text-gray-400 ${
                          isOpen ? 'rotate-180' : ''
                        }`}
                        aria-hidden="true"
                      >
                        <Icon name="ChevronDown" className="w-5 h-5" />
                      </span>
                    </span>
                  </button>
                </h3>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      id={answerId}
                      role="region"
                      aria-labelledby={headerId}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: 'easeInOut' }}
                      className="overflow-hidden"
                    >
                      <div className="p-4 pt-1 border-t border-gray-100 dark:border-gray-700/50 text-gray-700 dark:text-gray-300 leading-relaxed">
                        <p className="whitespace-pre-wrap">{faq.answer}</p>
                        {faq.keywords.length > 0 && (
                          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                            <span className="font-medium">Keywords:</span>
                            {faq.keywords.map((kw, kIdx) => (
                              <span
                                key={kIdx}
                                className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-gray-600 dark:text-gray-300"
                              >
                                {kw}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })
        ) : (
          <div className="text-center py-12 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
            <p className="text-gray-600 dark:text-gray-400 font-medium">
              No matching FAQs found.
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-500 mt-1">
              Try adjusting your search query or clearing category filters.
            </p>
            {(searchQuery || selectedCategories.length > 0) && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategories([]);
                }}
              >
                Clear Search & Filters
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export { FaqAccordion };
export default FaqAccordion;
