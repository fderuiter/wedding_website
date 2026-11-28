import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Button } from '@/components/ui/Button';
import { SubEventEditorModal, type EditableSubEvent } from './SubEventEditorModal';

const samplePlatedEvent: EditableSubEvent = {
  id: 'se-reception-1',
  title: 'Evening Dinner & Reception',
  description: 'Plated three-course dinner, toasts, and dancing.',
  startTime: '2026-09-19T18:00:00.000Z',
  endTime: '2026-09-19T23:00:00.000Z',
  locationName: 'Grand Pavilion Ballroom',
  category: 'Reception',
  isPrivate: false,
  mealOptions: [
    {
      id: 'meal-salmon',
      label: 'Herb-Crusted Atlantic Salmon',
      description: 'Wild rice pilaf, asparagus & lemon dill butter',
      dietaryTags: ['gluten-free'],
    },
    {
      id: 'meal-short-rib',
      label: 'Braised Beef Short Rib',
      description: 'Garlic potato purée & red wine jus',
      dietaryTags: ['gluten-free'],
    },
    {
      id: 'meal-gnocchi',
      label: 'Roasted Wild Mushroom Gnocchi',
      description: 'Truffle herb emulsion & baby spinach',
      dietaryTags: ['vegan', 'dairy-free', 'nut-free'],
    },
  ],
  customQuestions: [
    {
      id: 'q-shuttle',
      prompt: 'Will you use the complimentary hotel shuttle?',
      type: 'choice',
      required: true,
      options: ['Yes, round-trip', 'One-way only', 'No, arranging own transit'],
    },
    {
      id: 'q-song',
      prompt: 'What song will get you on the dance floor?',
      type: 'text',
      required: false,
      options: [],
    },
  ],
};

function SubEventEditorStoryWrapper({ initialOpen = true }: { initialOpen?: boolean }) {
  const [isOpen, setIsOpen] = useState(initialOpen);

  return (
    <div className="p-6 space-y-4">
      <Button onClick={() => setIsOpen(true)}>Edit Plated Reception Event</Button>
      <SubEventEditorModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        editingEvent={samplePlatedEvent}
        existingSubEvents={[samplePlatedEvent]}
        onSelectEdit={() => {}}
        onSave={async () => {}}
      />
    </div>
  );
}

const meta: Meta<typeof SubEventEditorModal> = {
  title: 'Admin/SubEventEditorModal',
  component: SubEventEditorModal,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof SubEventEditorModal>;

export const WithMealsAndCustomQuestions: Story = {
  render: () => <SubEventEditorStoryWrapper initialOpen={true} />,
};
