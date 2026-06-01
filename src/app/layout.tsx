import { Geist } from "next/font/google";
import "./globals.css";
import RootLayoutClient from "@/components/layout/RootLayoutClient";
import { generateMetadata } from './metadata';
import { getAppConfig } from "@/lib/config";
import { theme } from "@/styles/theme";

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
  
  // Inject theme variables so Tailwind v4 automatically picks them up
  const themeVars = {
    '--color-primary': theme?.colors?.primary || '#f43f5e',
    '--color-secondary': theme?.colors?.secondary || '#fbbf24',
    '--color-accent-from': theme?.colors?.accent || theme?.colors?.primary || '#f43f5e',
    '--color-accent-to': theme?.colors?.secondary || '#fbbf24',
    '--color-text-on-primary': theme?.colors?.textOnPrimary || '#ffffff',
    '--color-text-on-secondary': theme?.colors?.textOnSecondary || '#1f2937',
    '--background': theme?.colors?.background || '#111827',
    '--foreground': theme?.colors?.text || '#f9fafb',
  } as React.CSSProperties;

  return (
    <html lang="en" className={`dark ${geist.variable}`} style={themeVars}>
      <body
        className={`${geist.variable} bg-[var(--color-background)] text-[var(--color-foreground)] selection:bg-rose-800`}
      >
        <a href="#main-content" className="skip-link">Skip to main content</a>
        <RootLayoutClient config={config}>{children}</RootLayoutClient>
      </body>
    </html>
  );
}
