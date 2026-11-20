import type { Meta, StoryObj } from '@storybook/react';
import { http, HttpResponse } from 'msw';
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

const platedDinnerNodes: ContentNodeDTO[] = [
  {
    id: 'sub-3',
    pageId: 'page-schedule',
    type: 'Schedule',
    tags: ['Schedule'],
    data: {
      title: 'Evening Dinner & Reception',
      startTime: '2026-09-19T18:00:00Z',
      endTime: '2026-09-19T23:00:00Z',
      category: 'Reception',
      locationName: 'Grand Pavilion Ballroom',
      attireRules: 'Black Tie Optional',
      description: 'Plated dinner, celebratory toasts, and dancing.',
      mealOptions: [
        {
          id: 'meal-salmon',
          label: 'Herb-Crusted Salmon',
          description: 'Wild rice pilaf & lemon dill butter',
          dietaryTags: ['gluten-free'],
        },
        {
          id: 'meal-short-rib',
          label: 'Braised Short Rib',
          description: 'Garlic potato purée & red wine jus',
          dietaryTags: ['gluten-free'],
        },
        {
          id: 'meal-gnocchi',
          label: 'Truffle Wild Mushroom Gnocchi',
          description: 'Roasted wild mushrooms & herb emulsion',
          dietaryTags: ['vegan', 'dairy-free'],
        },
      ],
      customQuestions: [
        {
          id: 'q-shuttle',
          prompt: 'Will you use the complimentary hotel shuttle?',
          type: 'choice',
          required: true,
          options: ['Yes, round-trip', 'One-way only', 'No, driving ourselves'],
        },
        {
          id: 'q-song',
          prompt: 'Any song requests for the reception DJ?',
          type: 'text',
          required: false,
          options: [],
        },
      ],
      userRsvp: {
        status: 'attending',
        plusOneCount: 1,
        dietaryNotes: 'No shellfish',
        mealSelections: ['meal-salmon', 'meal-gnocchi'],
        customAnswers: {
          'q-shuttle': 'Yes, round-trip',
          'q-song': 'September - Earth, Wind & Fire',
        },
        plusOneNames: ['Jordan Taylor'],
      },
    },
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  } as any,
];

export const PlatedDinnerRsvpWithMealsAndQuestions: Story = {
  args: {
    events: platedDinnerNodes,
    title: 'Guest RSVP Schedule',
    timezone: 'America/Chicago',
  },
  parameters: {
    msw: {
      handlers: [
        http.get('*/api/schedule', () =>
          HttpResponse.json({
            success: true,
            data: [
              {
                id: 'sub-3',
                ...(platedDinnerNodes[0].data as Record<string, unknown>),
              },
            ],
            isGuest: true,
            guestName: 'Alex Rivera',
            plusOneAllocations: 2,
            savedPlusOneNames: ['Jordan Taylor'],
            rsvpOpen: true,
            rsvpDeadlineDate: null,
            rsvpFormattedDeadline: null,
            timezone: 'America/Chicago',
            rsvpClosedMessage:
              'Online RSVPs are now closed. Please contact the hosts directly if your plans or dietary needs have changed.',
          })
        ),
      ],
    },
  },
};
