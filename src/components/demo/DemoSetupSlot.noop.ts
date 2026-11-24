import type React from 'react';

interface DemoSetupSlotProps {
  className?: string;
  resetCounter?: number;
  onDemoComplete?: () => void;
}

export function DemoSetupSlot(
  _props: DemoSetupSlotProps
): React.JSX.Element | null {
  return null;
}
