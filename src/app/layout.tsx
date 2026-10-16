import './globals.css';
import {
  Geist,
  Geist_Mono,
  Playfair_Display,
  Cormorant_Garamond,
  Inter,
  Lora,
  Cinzel,
  Lato,
} from 'next/font/google';
import RootLayoutClient from '@/components/layout/RootLayoutClient';
import { generateMetadata, generateViewport } from './metadata';
import { getAppConfig, toPublicAppConfig, isSiteInitialized } from '@/lib/config';
import { ThemeProvider, ThemeMode } from '@/components/ThemeProvider';
import SetupWizard from '@/components/setup/SetupWizard';
import { ToastProvider } from '@/components/ui/ToastProvider';
import { cookies } from 'next/headers';
import { getPresetTokens } from '@/lib/theme/presets';

export const dynamic = 'force-dynamic';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const playfair = Playfair_Display({
  variable: '--font-playfair',
  subsets: ['latin'],
});

const cormorant = Cormorant_Garamond({
  variable: '--font-cormorant',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
});

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
});

const lora = Lora({
  variable: '--font-lora',
  subsets: ['latin'],
});

const cinzel = Cinzel({
  variable: '--font-cinzel',
  subsets: ['latin'],
});

const lato = Lato({
  variable: '--font-lato',
  subsets: ['latin'],
  weight: ['400', '700'],
});

const fontClasses = `${geistSans.variable} ${geistMono.variable} ${playfair.variable} ${cormorant.variable} ${inter.variable} ${lora.variable} ${cinzel.variable} ${lato.variable}`;

export { generateMetadata, generateViewport };

/**
 * @layout RootLayout
 * @description The root layout for the entire application.
 *
 * This server component sets up the main HTML document structure, including the `<html>`
 * and `<body>` tags. It configures font variables and wraps page content with the `RootLayoutClient`
 * component.
 *
 * @param {object} props - The component props.
 * @param {React.ReactNode} props.children - The child components to be rendered within the layout.
 * @returns {JSX.Element} The rendered root layout.
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const config = await getAppConfig();
  const publicConfig = toPublicAppConfig(config);
  const isUninitialized = !isSiteInitialized(config);

  const cookieStore = await cookies();
  const rawThemeMode = cookieStore.get('theme_mode')?.value;

  let initialThemeMode: ThemeMode = 'system';
  if (rawThemeMode === 'light' || rawThemeMode === 'dark' || rawThemeMode === 'system') {
    initialThemeMode = rawThemeMode as ThemeMode;
  }

  const initialHtmlClass = initialThemeMode === 'light' ? 'light' : 'dark';

  const colorPrimary = config.colorPrimary || '#B91C1C';
  const colorSecondary = config.colorSecondary || '#B45309';
  const containerMaxW = config.layoutContainerMaxWidth || '64rem';
  const gridGap = config.layoutGridGap || '1.5rem';
  const cardPadding = config.layoutCardPadding || '2rem';
  const borderRadius = config.layoutBorderRadius || '1rem';

  const presetTokens = getPresetTokens(config.themePreset);
  const fontHeading = config.fontHeading || presetTokens['--font-heading'];
  const fontBody = config.fontBody || presetTokens['--font-body'];
  const fontMono = config.fontMono || presetTokens['--font-mono'];

  const serverThemeStyles = `:root {
    --color-primary: ${colorPrimary};
    --color-secondary: ${colorSecondary};
    --color-primary-text: ${colorPrimary};
    --color-secondary-text: ${colorSecondary};
    --container-max-w: ${containerMaxW};
    --grid-gap: ${gridGap};
    --card-padding: ${cardPadding};
    --radius-card: ${borderRadius};
    --font-heading: ${fontHeading};
    --font-body: ${fontBody};
    --font-mono: ${fontMono};
  }`;

  const themeScript = '(function(){var d=false;try{var m=localStorage.getItem(\'theme_mode\');if(m===\'dark\')d=true;else if(m===\'light\')d=false;else d=window.matchMedia&&window.matchMedia(\'(prefers-color-scheme: dark)\').matches;}catch(e){try{d=window.matchMedia&&window.matchMedia(\'(prefers-color-scheme: dark)\').matches;}catch(e2){}}try{var r=document.documentElement;if(d){r.classList.add(\'dark\');r.classList.remove(\'light\');}else{r.classList.add(\'light\');r.classList.remove(\'dark\');}}catch(e3){}})();';

  return (
    <html lang="en" suppressHydrationWarning className={`${initialHtmlClass} ${fontClasses}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <style dangerouslySetInnerHTML={{ __html: serverThemeStyles }} />
      </head>
      <body
        className={`${fontClasses} bg-[var(--color-background)] text-[var(--color-foreground)] selection:bg-[var(--color-primary)]`}
      >
        <a href="#main-content" className="skip-link">Skip to main content</a>
        {isUninitialized ? (
          <SetupWizard />
        ) : (
          <ThemeProvider config={publicConfig} initialThemeMode={initialThemeMode}>
            <ToastProvider>
              <RootLayoutClient config={publicConfig}>{children}</RootLayoutClient>
            </ToastProvider>
          </ThemeProvider>
        )}
      </body>
    </html>
  );
}

