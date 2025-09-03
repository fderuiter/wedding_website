import { Geist } from "next/font/google";
import "./globals.css";
import RootLayoutClient from "@/components/layout/RootLayoutClient";
import { metadata } from './metadata';

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

export { metadata };

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
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${geist.variable}`}>
      <body
        className={`${geist.variable} bg-[var(--color-background)] text-[var(--color-foreground)] selection:bg-rose-800`}
      >
        <RootLayoutClient>{children}</RootLayoutClient>
      </body>
    </html>
  );
}
