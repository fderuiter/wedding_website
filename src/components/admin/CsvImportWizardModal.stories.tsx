import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { CsvImportWizardModal } from './CsvImportWizardModal';
import { Button } from '@/components/ui/Button';

function CsvWizardWrapper({ initialOpen = false }: { initialOpen?: boolean }) {
  const [isOpen, setIsOpen] = useState(initialOpen);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-4">
        <Button onClick={() => setIsOpen(true)}>
          Open CSV Import Wizard
        </Button>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          Status: {isOpen ? 'Modal Open' : 'Modal Closed'}
        </span>
      </div>

      <CsvImportWizardModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        onImportComplete={() => {
          console.log('Import completed!');
          setIsOpen(false);
        }}
        existingCodes={['GUEST1', 'ALEX2026', 'JORDAN2026']}
      />
    </div>
  );
}

const meta: Meta<typeof CsvImportWizardModal> = {
  title: 'Admin/CsvImportWizardModal',
  component: CsvImportWizardModal,
  tags: ['autodocs'],
  args: {
    isOpen: true,
    existingCodes: ['GUEST1', 'ALEX2026'],
  },
};

export default meta;
type Story = StoryObj<typeof CsvImportWizardModal>;

export const InteractiveLauncher: Story = {
  render: () => <CsvWizardWrapper initialOpen={false} />,
};

export const OpenModal: Story = {
  render: () => <CsvWizardWrapper initialOpen={true} />,
};
