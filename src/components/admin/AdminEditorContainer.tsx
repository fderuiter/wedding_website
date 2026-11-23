import React from 'react';
import { Heading, type HeadingLevel } from '@/components/ui/Layout';

interface AdminEditorContainerProps {
  children: React.ReactNode;
  title?: string;
  headingLevel?: HeadingLevel;
}

export const AdminEditorContainer: React.FC<AdminEditorContainerProps> = ({
  children,
  title,
  headingLevel = 'h2',
}) => {
  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg mb-8 border border-primary dark:border-gray-700 max-w-4xl mx-auto">
      {title && (
        <Heading as={headingLevel} variant="none" unstyledColor className="text-2xl font-bold mb-4">
          {title}
        </Heading>
      )}
      {children}
    </div>
  );
};
