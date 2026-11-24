'use client';

import dynamic from 'next/dynamic';
import type { SetupWizardSavedConfig } from './SetupWizard';

interface LazySetupWizardProps {
  initialSavedConfig?: SetupWizardSavedConfig;
  onDemoComplete?: () => void;
}

const DynamicSetupWizard = dynamic(() => import('./SetupWizard'));

export default function SetupWizard(props: LazySetupWizardProps) {
  return <DynamicSetupWizard {...props} />;
}
