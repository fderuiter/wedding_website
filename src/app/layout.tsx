import { Geist } from "next/font/google";
import RootLayoutClient from "@/components/layout/RootLayoutClient";
import { generateMetadata } from './metadata';
import { getAppConfig, toPublicAppConfig } from "@/lib/config";
import { ThemeProvider } from "@/components/ThemeProvider";
import SetupWizard from "@/components/setup/SetupWizard";
import { ToastProvider } from "@/components/ui/ToastProvider";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

export { generateMetadata };

/**
 * @layout RootLayout
 * @description The root layout for the entire application.
 *
 * This server component sets up the main HTML document structure, including the `<html>`
 * and `<body>` tags. It configures the primary font (`Geist`) and wraps the page content
 * with the `RootLayoutClient` component, which handles client-side logic like state
 * management and event handling.
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
  const isUninitialized = !config.brideName || !config.groomName || !config.baseUrl;

  return (
    <html lang="en" className={`dark ${geist.variable}`}>
      <body
        className={`${geist.variable} bg-[var(--color-background)] text-[var(--color-foreground)] selection:bg-[var(--color-primary)]`}
      >
        {isUninitialized ? (
          <SetupWizard />
        ) : (
          <ThemeProvider
            themePrimary={config?.themePrimary}
            themeSecondary={config?.themeSecondary}
            themeAccent={config?.themeAccent}
          >
            <ToastProvider>
              <a href="#main-content" className="skip-link">Skip to main content</a>
              <RootLayoutClient config={publicConfig}>{children}</RootLayoutClient>
            </ToastProvider>
          </ThemeProvider>
        )}
      </body>
    </html>
  );
}
