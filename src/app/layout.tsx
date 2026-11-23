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
import { generateThemeStylesheet } from '@/lib/theme/stylesheet';
import { enforceActiveGuestPageSession } from '@/core/auth/guestInviteSession';
import { logisticsService } from '@/features/logistics';
import { withPageQuery } from '@/lib/query-wrapper';

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
  const visibleFaqs = isUninitialized
    ? []
    : await withPageQuery(() => logisticsService.getVisibleFaqs(), []);

  const isStaticExport = process.env.STATIC_EXPORT === 'true' ||
                         process.env.STATIC_EXPORT === '1' ||
                         process.env.npm_lifecycle_event === 'build:export';

  let initialThemeMode: ThemeMode = 'system';
  if (!isStaticExport) {
    await enforceActiveGuestPageSession();

    try {
      const cookieStore = await cookies();
      const rawThemeMode = cookieStore.get('theme_mode')?.value;

      if (rawThemeMode === 'light' || rawThemeMode === 'dark' || rawThemeMode === 'system') {
        initialThemeMode = rawThemeMode as ThemeMode;
      }
    } catch {
      // Ignore if cookies are unavailable
    }
  }

  const initialHtmlClass =
    initialThemeMode === 'dark' ? 'dark' : initialThemeMode === 'light' ? 'light' : '';

  const serverThemeStyles = generateThemeStylesheet(publicConfig);

  const themeScript =
    '(function(){var m=null;try{m=localStorage.getItem(\'theme_mode\');}catch(e){}if(m!==\'dark\'&&m!==\'light\'&&m!==\'system\'){try{var c=document.cookie.match(/(?:^|;\\s*)theme_mode=(dark|light|system)(?:;|$)/);if(c)m=c[1];}catch(e2){}}var d=false;if(m===\'dark\')d=true;else if(m===\'light\')d=false;else{try{d=!!(window.matchMedia&&window.matchMedia(\'(prefers-color-scheme: dark)\').matches);}catch(e3){d=false;}}try{var r=document.documentElement;if(d){r.classList.add(\'dark\');r.classList.remove(\'light\');}else{r.classList.add(\'light\');r.classList.remove(\'dark\');}}catch(e4){}})();';

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={[initialHtmlClass, fontClasses].filter(Boolean).join(' ')}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <style id="dynamic-theme-style" dangerouslySetInnerHTML={{ __html: serverThemeStyles }} />
      </head>
      <body
        className={`${fontClasses} bg-[var(--color-background)] text-[var(--color-foreground)] selection:bg-[var(--color-primary)]`}
      >
        <a href="#main-content" className="skip-link">Skip to main content</a>
        <ThemeProvider config={publicConfig} initialThemeMode={initialThemeMode} hasServerStylesheet>
          {isUninitialized ? (
            <SetupWizard />
          ) : (
            <ToastProvider>
              <RootLayoutClient config={publicConfig} faqs={visibleFaqs}>{children}</RootLayoutClient>
            </ToastProvider>
          )}
        </ThemeProvider>
      </body>
    </html>
  );
}

