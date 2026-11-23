import type { Meta, StoryObj } from '@storybook/react';
import { FormGroup, Label, Input, Textarea, Select, Checkbox, FormMessage } from './forms';

const meta: Meta<typeof FormGroup> = {
  title: 'UI Primitives/Forms',
  component: FormGroup,
  tags: ['autodocs'],
  argTypes: {
    state: {
      control: 'select',
      options: ['default', 'error', 'success', 'warning'],
    },
  },
  args: {
    state: 'default',
  },
};

export default meta;
type Story = StoryObj<typeof FormGroup>;

export const DefaultInput: Story = {
  render: (args) => (
    <div className="max-w-md">
      <FormGroup {...args}>
        <Label>Guest Full Name</Label>
        <Input placeholder="e.g. Jane Doe" />
        <FormMessage>Please enter your name as it appears on your invitation.</FormMessage>
      </FormGroup>
    </div>
  ),
};

export const ErrorState: Story = {
  render: () => (
    <div className="max-w-md">
      <FormGroup state="error">
        <Label>Invitation Code</Label>
        <Input defaultValue="INVALID123" />
        <FormMessage>Invitation code was not found. Please double-check your invite card.</FormMessage>
      </FormGroup>
    </div>
  ),
};

export const SuccessState: Story = {
  render: () => (
    <div className="max-w-md">
      <FormGroup state="success">
        <Label>Email Address</Label>
        <Input defaultValue="guest@example.com" />
        <FormMessage>Email address verified successfully.</FormMessage>
      </FormGroup>
    </div>
  ),
};

export const WarningState: Story = {
  render: () => (
    <div className="max-w-md">
      <FormGroup state="warning">
        <Label>Plus-One Dietary Notes</Label>
        <Input defaultValue="May contain peanuts" />
        <FormMessage>Please verify specific allergy severity with catering staff.</FormMessage>
      </FormGroup>
    </div>
  ),
};

export const CompactSize: Story = {
  render: () => (
    <div className="max-w-md space-y-4">
      <FormGroup>
        <Label>Default Input</Label>
        <Input sizeVariant="default" placeholder="Default height (40px)" />
      </FormGroup>
      <FormGroup>
        <Label>Compact Input</Label>
        <Input sizeVariant="compact" placeholder="Compact height (28px)" />
      </FormGroup>
    </div>
  ),
};

export const TextareaField: Story = {
  render: () => (
    <div className="max-w-md">
      <FormGroup>
        <Label>Song Requests & Well Wishes</Label>
        <Textarea placeholder="Leave a note or request your favorite song..." rows={4} />
        <FormMessage>We will do our best to include your tunes in the playlist!</FormMessage>
      </FormGroup>
    </div>
  ),
};

export const SelectAndCheckbox: Story = {
  render: () => (
    <div className="max-w-md space-y-4">
      <FormGroup>
        <Label>Meal Preference</Label>
        <Select defaultValue="beef">
          <option value="beef">Filet Mignon & Roasted Asparagus</option>
          <option value="salmon">Pacific King Salmon & Wild Rice</option>
          <option value="vegetarian">Wild Mushroom Risotto (Vegetarian)</option>
          <option value="vegan">Roasted Butternut Squash (Vegan)</option>
        </Select>
        <FormMessage>Contact us for custom dietary requirements.</FormMessage>
      </FormGroup>

      <FormGroup className="flex items-center space-x-2">
        <Checkbox id="shuttle" />
        <Label htmlFor="shuttle" className="cursor-pointer">
          Request seat on hotel shuttle bus
        </Label>
      </FormGroup>
    </div>
  ),
};

export const RequiredField: Story = {
  render: () => (
    <div className="max-w-md space-y-4">
      <FormGroup required>
        <Label>Your Name</Label>
        <Input placeholder="Jane Doe" autoComplete="name" />
        <FormMessage>Required fields expose programmatic aria-required and hide visual asterisks.</FormMessage>
      </FormGroup>
    </div>
  ),
};

export const BusyReadOnlyLock: Story = {
  render: () => (
    <div className="max-w-md space-y-4">
      <FormGroup busy required>
        <Label>Invitation Code</Label>
        <Input defaultValue="LOVE2026" />
        <FormMessage>Busy inputs remain focusable via readOnly without dropping focus to body.</FormMessage>
      </FormGroup>
    </div>
  ),
};
