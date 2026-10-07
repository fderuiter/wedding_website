import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import InteractiveTimeline from '../InteractiveTimeline';
import type { ContentNodeDTO } from '@/features/content/schemas';

describe('InteractiveTimeline Component', () => {
  const sampleEvents: ContentNodeDTO[] = [
    {
      id: 'event-1',
      type: 'Schedule',
      tags: ['Schedule'],
      data: {
        title: 'Rehearsal Dinner',
        startTime: '2026-06-19T18:00:00.000Z',
        endTime: '2026-06-19T21:00:00.000Z',
        categoryTags: ['Rehearsal'],
        locationName: 'The Oak Room',
        attireRules: 'Smart Casual',
        description: 'Welcome dinner for family and wedding party.',
      },
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    },
    {
      id: 'event-2',
      type: 'Schedule',
      tags: ['Schedule'],
      data: {
        title: 'Wedding Ceremony',
        startTime: '2026-06-20T15:00:00.000Z',
        endTime: '2026-06-20T16:00:00.000Z',
        categoryTags: ['Ceremony'],
        locationName: 'St. Mary Church',
        attireRules: 'Formal Black Tie Optional',
        description: 'Exchange of vows.',
      },
      createdAt: new Date('2026-01-02'),
      updatedAt: new Date('2026-01-02'),
    },
    {
      id: 'event-3',
      type: 'Schedule',
      tags: ['Schedule'],
      data: {
        title: 'Evening Reception',
        startTime: '2026-06-20T18:00:00.000Z',
        endTime: '2026-06-20T23:00:00.000Z',
        categoryTags: ['Reception'],
        locationName: 'Grand Crystal Ballroom',
        attireRules: 'Cocktail Attire',
        description: 'Dinner, drinks, and dancing.',
      },
      createdAt: new Date('2026-01-03'),
      updatedAt: new Date('2026-01-03'),
    },
  ];

  it('renders interactive timeline header and filter tabs', () => {
    render(<InteractiveTimeline events={sampleEvents} timezone="UTC" title="Wedding Weekend Schedule" />);

    expect(screen.getByText('Wedding Weekend Schedule')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Rehearsal' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Ceremony' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Reception' })).toBeInTheDocument();
  });

  it('renders event cards in ascending chronological order', () => {
    render(<InteractiveTimeline events={sampleEvents} timezone="UTC" />);

    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual(['Rehearsal Dinner', 'Wedding Ceremony', 'Evening Reception']);
  });

  it('filters events when category filter button is clicked', () => {
    render(<InteractiveTimeline events={sampleEvents} timezone="UTC" />);

    // Click Ceremony tab
    const ceremonyTab = screen.getByRole('tab', { name: 'Ceremony' });
    fireEvent.click(ceremonyTab);

    expect(screen.getByText('Wedding Ceremony')).toBeInTheDocument();
    expect(screen.queryByText('Rehearsal Dinner')).not.toBeInTheDocument();
    expect(screen.queryByText('Evening Reception')).not.toBeInTheDocument();

    // Click All tab
    const allTab = screen.getByRole('tab', { name: 'All' });
    fireEvent.click(allTab);

    expect(screen.getByText('Rehearsal Dinner')).toBeInTheDocument();
    expect(screen.getByText('Wedding Ceremony')).toBeInTheDocument();
    expect(screen.getByText('Evening Reception')).toBeInTheDocument();
  });

  it('displays location, attire rules, and per-event calendar export button', () => {
    render(<InteractiveTimeline events={sampleEvents} timezone="UTC" />);

    expect(screen.getByText('The Oak Room')).toBeInTheDocument();
    expect(screen.getByText('Smart Casual')).toBeInTheDocument();

    const calendarButtons = screen.getAllByRole('button', { name: /add to calendar/i });
    expect(calendarButtons.length).toBe(3);
  });

  it('returns null when no structured events exist', () => {
    const { container } = render(<InteractiveTimeline events={[]} timezone="UTC" />);
    expect(container.firstChild).toBeNull();
  });
});
