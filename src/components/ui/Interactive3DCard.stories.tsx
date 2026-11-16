import type { Meta, StoryObj } from '@storybook/react';
import { Interactive3DCard } from './Interactive3DCard';
import { Button } from './Button';

const meta: Meta<typeof Interactive3DCard> = {
  title: 'UI Primitives/Interactive3DCard',
  component: Interactive3DCard,
  tags: ['autodocs'],
  argTypes: {
    className: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof Interactive3DCard>;

export const DefaultCard: Story = {
  render: () => (
    <div className="flex justify-center p-8">
      <Interactive3DCard className="w-80 rounded-2xl bg-white dark:bg-gray-800 p-6 shadow-xl border border-gray-200 dark:border-gray-700">
        <div className="space-y-4">
          <div className="h-40 rounded-xl bg-gradient-to-tr from-amber-500 to-rose-500 flex items-center justify-center text-white text-3xl font-serif">
            Save The Date
          </div>
          <div>
            <h3 className="text-xl font-bold font-serif text-gray-900 dark:text-gray-100">
              Alex & Jordan
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              September 19, 2026 &bull; Napa Valley, CA
            </p>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Hover and drag over this card to experience the 3D perspective tilt physics.
          </p>
          <Button variant="primary" className="w-full">
            RSVP Online
          </Button>
        </div>
      </Interactive3DCard>
    </div>
  ),
};

export const ClickableCard: Story = {
  render: () => (
    <div className="flex justify-center p-8">
      <Interactive3DCard
        onClick={() => alert('Card clicked!')}
        className="w-80 rounded-2xl bg-gradient-to-br from-red-900 to-amber-900 text-white p-6 shadow-2xl cursor-pointer hover:shadow-red-500/30 transition-shadow"
      >
        <div className="space-y-3">
          <span className="text-xs font-semibold tracking-wider uppercase text-amber-300">
            VIP Invitation
          </span>
          <h3 className="text-2xl font-serif font-bold">Rehearsal Dinner</h3>
          <p className="text-sm text-amber-100/90">
            Friday, September 18 at 6:00 PM
          </p>
          <p className="text-xs text-amber-200/70">
            Click this card or use keyboard Enter/Space to activate.
          </p>
        </div>
      </Interactive3DCard>
    </div>
  ),
};
