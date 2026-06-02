import { Geist } from "next/font/google";
import "./globals.css";
import RootLayoutClient from "@/components/layout/RootLayoutClient";
import { generateMetadata } from './metadata';
import { getAppConfig } from "@/lib/config";
import { ThemeProvider } from "@/components/ThemeProvider";

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
  return (
    <html lang="en" className={`dark ${geist.variable}`}>
      <body
        className={`${geist.variable} bg-[var(--color-background)] text-[var(--color-foreground)] selection:bg-[var(--color-primary)]`}
      >
        <ThemeProvider 
          themePrimary={config?.themePrimary} 
          themeSecondary={config?.themeSecondary} 
          themeAccent={config?.themeAccent}
        >
          <a href="#main-content" className="skip-link">Skip to main content</a>
          <RootLayoutClient config={config}>{children}</RootLayoutClient>
        </ThemeProvider>
      </body>
    </html>
  );
}
