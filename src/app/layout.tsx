import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Abbi & Fred's Wedding - Software Engineer Portfolio",
  description: "Join Abbigayle Schultz and Frederick de Ruiter in celebrating their special day. A modern wedding website showcasing full-stack development, React, Next.js, and innovative web design.",
  keywords: ["Abbigayle Schultz", "Frederick de Ruiter", "wedding", "wedding website", "software engineer", "full-stack developer", "React", "Next.js", "web development"],
  openGraph: {
    title: "Abbi & Fred's Wedding Celebration",
    description: "Join us in celebrating the wedding of Abbigayle Schultz and Frederick de Ruiter",
    url: "https://abbi-and-fred.com",
    siteName: "Abbi & Fred's Wedding",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Abbi & Fred's Wedding",
    description: "Join us in celebrating the wedding of Abbigayle Schultz and Frederick de Ruiter",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={geist.variable}>
      <body>
        <nav className="fixed top-0 w-full bg-white/80 backdrop-blur-sm border-b z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between h-16">
              <div className="flex">
                <Link href="/" className="flex items-center font-medium">
                  A&F
                </Link>
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/registry" className="px-4 py-2 rounded-md text-sm font-medium text-gray-900 hover:bg-gray-100">
                  Registry
                </Link>
              </div>
            </div>
          </div>
        </nav>
        <main className="pt-16">
          {children}
        </main>
      </body>
    </html>
  );
}
