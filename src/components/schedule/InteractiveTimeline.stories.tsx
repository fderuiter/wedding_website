import type { Meta, StoryObj } from '@storybook/react';
import InteractiveTimeline from './InteractiveTimeline';
import type { ContentNodeDTO } from '@/features/content';

const fallbackNodes: ContentNodeDTO[] = [
  {
    id: 'node-1',
    pageId: 'page-schedule',
    type: 'schedule_item',
    order: 1,
    data: {
      title: 'Welcome Drinks & Rehearsal Dinner',
      startTime: '2026-09-18T18:00:00Z',
      endTime: '2026-09-18T21:00:00Z',
      category: 'Celebration',
      location: 'Sunset Terrace Lawn',
      description: 'Casual arrival drinks and light dinner for traveling guests.',
    },
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  } as any,
  {
    id: 'node-2',
    pageId: 'page-schedule',
    type: 'schedule_item',
    order: 2,
    data: {
      title: 'Wedding Ceremony',
      startTime: '2026-09-19T15:30:00Z',
      endTime: '2026-09-19T16:30:00Z',
      category: 'Ceremony',
      location: 'Grand Oak Grove',
      description: 'Exchange of vows and ceremonial celebration.',
    },
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  } as any,
];

const meta: Meta<typeof InteractiveTimeline> = {
  title: 'Features/Schedule/InteractiveTimeline',
  component: InteractiveTimeline,
  tags: ['autodocs'],
  args: {
    events: fallbackNodes,
    title: 'Wedding Weekend Timeline',
    timezone: 'America/Los_Angeles',
  },
};

export default meta;
type Story = StoryObj<typeof InteractiveTimeline>;

export const DefaultMockedTimeline: Story = {
  args: {
    events: fallbackNodes,
    title: 'Wedding Weekend Schedule',
    timezone: 'America/Los_Angeles',
  },
};

export const CustomTitle: Story = {
  args: {
    events: fallbackNodes,
    title: 'Celebration Events & Itinerary',
    timezone: 'America/New_York',
  },
};
