import type { Metadata } from 'next';
import Link from 'next/link';
import { createPageMetadata } from '@/app/metadata';

export const metadata: Metadata = createPageMetadata({
  title: 'Page Not Found',
  description: 'The requested page could not be found.',
  noIndex: true,
});

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 py-16">
      <div className="bg-background p-8 rounded-xl shadow-lg border border-border max-w-md w-full text-center">
        <h2 className="text-3xl font-bold mb-4 text-foreground">404</h2>
        <h3 className="text-xl font-semibold mb-2 text-foreground">Page Not Found</h3>
        <p className="text-foreground opacity-80 mb-6">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link href="/" className="btn-primary w-full h-12 text-lg">
          Return Home
        </Link>
      </div>
    </div>
  );
}
