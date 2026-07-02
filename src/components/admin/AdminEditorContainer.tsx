import React from 'react';

interface AdminEditorContainerProps {
  children: React.ReactNode;
  title?: string;
}

export const AdminEditorContainer: React.FC<AdminEditorContainerProps> = ({ children, title }) => {
  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg mb-8 border border-primary dark:border-gray-700 max-w-4xl mx-auto">
      {title && <h2 className="text-2xl font-bold mb-4">{title}</h2>}
      {children}
    </div>
  );
};
