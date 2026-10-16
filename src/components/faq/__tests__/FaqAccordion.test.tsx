import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { FaqAccordion, FAQItemInput } from '../FaqAccordion';

describe('FaqAccordion Component', () => {
  const sampleFaqs: FAQItemInput[] = [
    {
      id: 'faq-1',
      type: 'FAQ',
      tags: ['homepage'],
      data: {
        question: 'What is the dress code?',
        answer: 'Black tie optional. Please wear formal attire.',
        category: 'Dress Code',
        keywords: ['attire', 'clothing', 'suits', 'dresses'],
      },
    },
    {
      id: 'faq-2',
      type: 'FAQ',
      tags: ['homepage'],
      data: {
        question: 'Is transportation provided to the venue?',
        answer: 'Yes, shuttles will run every 15 minutes from the partner hotels.',
        category: 'Travel',
        keywords: ['shuttle', 'bus', 'parking'],
      },
    },
    {
      id: 'faq-3',
      type: 'FAQ',
      tags: ['homepage'],
      data: {
        question: 'Can I bring a plus one?',
        answer: 'Please check your invitation for plus one details.',
        // Uncategorized legacy item - should default to General
      },
    },
  ];

  it('renders accordion items with correct ARIA attributes', () => {
    render(<FaqAccordion faqs={sampleFaqs} />);

    const trigger1 = screen.getByRole('button', { name: /what is the dress code\?/i });
    expect(trigger1).toBeInTheDocument();
    expect(trigger1).toHaveAttribute('aria-expanded', 'false');
    
    const controlsId = trigger1.getAttribute('aria-controls');
    expect(controlsId).toBe('faq-answer-faq-1');

    // Panel is closed initially
    expect(screen.queryByText(/black tie optional/i)).not.toBeInTheDocument();
  });

  it('expands and collapses individual accordion items on click', async () => {
    render(<FaqAccordion faqs={sampleFaqs} />);

    const trigger1 = screen.getByRole('button', { name: /what is the dress code\?/i });
    
    // Click to expand
    fireEvent.click(trigger1);
    expect(trigger1).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/black tie optional/i)).toBeInTheDocument();

    // Click to collapse
    fireEvent.click(trigger1);
    expect(trigger1).toHaveAttribute('aria-expanded', 'false');
  });

  it('expands all and collapses all items using toggle controls', () => {
    render(<FaqAccordion faqs={sampleFaqs} />);

    const expandAllBtn = screen.getByRole('button', { name: /expand all faq items/i });
    const collapseAllBtn = screen.getByRole('button', { name: /collapse all faq items/i });

    const trigger1 = screen.getByRole('button', { name: /what is the dress code\?/i });
    const trigger2 = screen.getByRole('button', { name: /transportation provided/i });
    const trigger3 = screen.getByRole('button', { name: /plus one\?/i });

    // Click Expand All
    fireEvent.click(expandAllBtn);
    expect(trigger1).toHaveAttribute('aria-expanded', 'true');
    expect(trigger2).toHaveAttribute('aria-expanded', 'true');
    expect(trigger3).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/black tie optional/i)).toBeInTheDocument();

    // Click Collapse All
    fireEvent.click(collapseAllBtn);
    expect(trigger1).toHaveAttribute('aria-expanded', 'false');
    expect(trigger2).toHaveAttribute('aria-expanded', 'false');
    expect(trigger3).toHaveAttribute('aria-expanded', 'false');
  });

  it('filters visible FAQ items when category pills are toggled', () => {
    render(<FaqAccordion faqs={sampleFaqs} />);

    // Checkbox rendered by CategoryFilter
    const dressCodeCheckbox = screen.getByRole('checkbox', { name: /dress code/i });
    expect(dressCodeCheckbox).toBeInTheDocument();

    // Toggle Dress Code category checkbox
    fireEvent.click(dressCodeCheckbox);

    // Only Dress Code question should be visible
    expect(screen.getByText(/what is the dress code\?/i)).toBeInTheDocument();
    expect(screen.queryByText(/transportation provided/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/plus one\?/i)).not.toBeInTheDocument();
  });

  it('filters FAQs in real time based on search input query', () => {
    render(<FaqAccordion faqs={sampleFaqs} />);

    const searchInput = screen.getByRole('searchbox', { name: /search faqs/i });

    // Search for "shuttle"
    fireEvent.change(searchInput, { target: { value: 'shuttle' } });

    // Only transportation question matches
    expect(screen.getByText(/transportation provided/i)).toBeInTheDocument();
    expect(screen.queryByText(/what is the dress code\?/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/plus one\?/i)).not.toBeInTheDocument();

    // Auto-expanded when searching
    expect(screen.getByText(/shuttles will run every 15 minutes/i)).toBeInTheDocument();
  });

  it('defaults uncategorized legacy FAQs to General category', () => {
    render(<FaqAccordion faqs={sampleFaqs} />);

    // General category checkbox should exist for uncategorized legacy items
    const generalCheckbox = screen.getByRole('checkbox', { name: /general/i });
    expect(generalCheckbox).toBeInTheDocument();

    // Select General category filter
    fireEvent.click(generalCheckbox);

    // Only legacy plus one question should be visible
    expect(screen.getByText(/plus one\?/i)).toBeInTheDocument();
    expect(screen.queryByText(/what is the dress code\?/i)).not.toBeInTheDocument();
  });

  it('supports keyboard navigation across accordion triggers with arrow keys', () => {
    render(<FaqAccordion faqs={sampleFaqs} />);

    const btn1 = screen.getByRole('button', { name: /what is the dress code\?/i });
    const btn2 = screen.getByRole('button', { name: /transportation provided/i });

    btn1.focus();
    expect(document.activeElement).toBe(btn1);

    // Press ArrowDown -> moves focus to btn2
    fireEvent.keyDown(btn1, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(btn2);

    // Press ArrowUp -> moves focus back to btn1
    fireEvent.keyDown(btn2, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(btn1);
  });

  it('renders empty state when no FAQs match search query', () => {
    render(<FaqAccordion faqs={sampleFaqs} />);

    const searchInput = screen.getByRole('searchbox', { name: /search faqs/i });
    fireEvent.change(searchInput, { target: { value: 'nonexistentquery123' } });

    expect(screen.getByText(/no matching faqs found/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear search & filters/i })).toBeInTheDocument();
  });
});
