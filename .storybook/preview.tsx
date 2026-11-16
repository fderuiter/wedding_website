import React from 'react';
import type { Preview } from '@storybook/react';
import { initialize, mswLoader } from 'msw-storybook-addon';
import '../src/app/globals.css';
import { ThemeProvider } from '../src/components/ThemeProvider';
import { ToastProvider } from '../src/components/ui/ToastProvider';
import { defaultHandlers } from '../src/mocks/handlers';

// Initialize MSW for browser Storybook sandbox
initialize({
  onUnhandledRequest: 'bypass',
  serviceWorker: {
    url: './mockServiceWorker.js',
  },
}, defaultHandlers);

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    msw: {
      handlers: defaultHandlers,
    },
  },
  loaders: [mswLoader],
  decorators: [
    (Story, context) => {
      const themeMode = (context.globals.themeMode as 'light' | 'dark' | 'system') || 'light';
      return (
        <ThemeProvider initialThemeMode={themeMode}>
          <ToastProvider>
            <div className="min-h-[200px] p-4 font-sans text-gray-900 dark:text-gray-100 transition-colors">
              <Story />
            </div>
          </ToastProvider>
        </ThemeProvider>
      );
    },
  ],
  globalTypes: {
    themeMode: {
      name: 'Theme Mode',
      description: 'Global theme for components',
      defaultValue: 'light',
      toolbar: {
        icon: 'circlehollow',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
          { value: 'system', title: 'System' },
        ],
        showName: true,
      },
    },
  },
};

export default preview;
