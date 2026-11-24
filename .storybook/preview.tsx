import type { Preview } from '@storybook/react';
import { mswLoader } from 'msw-storybook-addon/csf3';
import { setupWorker } from 'msw/browser';
import '../src/app/globals.css';
import { ThemeProvider } from '../src/components/ThemeProvider';
import { ToastProvider } from '../src/components/ui/ToastProvider';
import { defaultHandlers } from '../src/mocks/handlers';

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
  loaders: [
    mswLoader(async () => {
      const worker = setupWorker(...defaultHandlers);
      await worker.start({
        quiet: true,
        onUnhandledFrame: 'bypass',
        serviceWorker: {
          url: './mockServiceWorker.js',
        },
      });
      return worker;
    }),
  ],
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
        title: 'Theme Mode',
        icon: 'circlehollow',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
          { value: 'system', title: 'System' },
        ],
        dynamicTitle: true,
      },
    },
  },
};

export default preview;
