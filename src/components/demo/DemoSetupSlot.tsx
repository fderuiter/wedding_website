'use client';

import type React from 'react';
import SetupWizard from '@/components/setup/SetupWizard';

interface DemoSetupSlotProps {
  className?: string;
  resetCounter?: number;
  onDemoComplete?: () => void;
}

export function DemoSetupSlot({
  className,
  resetCounter = 0,
  onDemoComplete,
}: DemoSetupSlotProps): React.JSX.Element | null {
  return (
    <div className={className}>
      <SetupWizard
        key={`demo-setup-${resetCounter}`}
        onDemoComplete={onDemoComplete}
      />
    </div>
  );
}
