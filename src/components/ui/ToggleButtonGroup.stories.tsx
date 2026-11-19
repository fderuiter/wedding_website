import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { ToggleButtonGroup, type ToggleButtonOption } from './ToggleButtonGroup';

const meta: Meta<typeof ToggleButtonGroup> = {
  title: 'UI Primitives/ToggleButtonGroup',
  component: ToggleButtonGroup,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof ToggleButtonGroup>;

function RadioGroupDemo() {
  const [status, setStatus] = useState<'attending' | 'declined' | 'pending'>('attending');
  const options: ToggleButtonOption<'attending' | 'declined' | 'pending'>[] = [
    { value: 'attending', label: 'Attending' },
    { value: 'declined', label: 'Declined' },
    { value: 'pending', label: 'Pending' },
  ];

  return (
    <div className="space-y-2 p-4">
      <span id="demo-rsvp-label" className="block text-sm font-bold">
        Your RSVP for Evening Reception
      </span>
      <ToggleButtonGroup
        mode="radiogroup"
        aria-labelledby="demo-rsvp-label"
        value={status}
        onChange={setStatus}
        options={options}
      />
    </div>
  );
}

export const RadioGroup: Story = {
  render: () => <RadioGroupDemo />,
};

function CardRadioGroupDemo() {
  const [preset, setPreset] = useState<'classic' | 'modern' | 'destination'>('classic');
  return (
    <div className="space-y-2 p-4 max-w-2xl">
      <span id="demo-preset-label" className="block text-sm font-semibold">
        Starter Archetype Preset
      </span>
      <ToggleButtonGroup
        mode="radiogroup"
        aria-labelledby="demo-preset-label"
        value={preset}
        onChange={setPreset}
        className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-transparent dark:bg-transparent p-0 border-0"
        options={[
          {
            value: 'classic',
            label: 'Classic Traditional',
            description: 'Timeless ceremony, cocktail hour, and formal seated reception.',
          },
          {
            value: 'modern',
            label: 'Modern Minimalist',
            description: 'Streamlined urban celebration with lounge seating and late-night bites.',
          },
          {
            value: 'destination',
            label: 'Destination Weekend',
            description: 'Multi-day itinerary with welcome drinks, ceremony, and farewell brunch.',
          },
        ]}
      />
    </div>
  );
}

export const CardPresetsRadioGroup: Story = {
  render: () => <CardRadioGroupDemo />,
};

function MultiGroupDemo() {
  const [selectedTags, setSelectedTags] = useState<string[]>(['vip']);
  return (
    <div className="space-y-2 p-4">
      <span id="demo-tags-label" className="block text-xs font-semibold uppercase tracking-wider text-gray-500">
        Party Tags
      </span>
      <ToggleButtonGroup
        mode="group"
        multiple
        aria-labelledby="demo-tags-label"
        value={selectedTags}
        onChange={setSelectedTags}
        options={[
          { value: 'vip', label: '#VIP' },
          { value: 'family', label: '#Family' },
          { value: 'rehearsal', label: '#Rehearsal' },
        ]}
      />
    </div>
  );
}

export const MultiSelectToggleGroup: Story = {
  render: () => <MultiGroupDemo />,
};
