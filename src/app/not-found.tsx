import type { Metadata } from 'next';
import Link from 'next/link';
import { createPageMetadata } from '@/app/metadata';
import { Heading } from '@/components/ui/Layout';

export const metadata: Metadata = createPageMetadata({
  title: 'Page Not Found',
  description: 'The requested page could not be found.',
  noIndex: true,
});

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 py-16">
      <div className="bg-background p-8 rounded-xl shadow-lg border border-border max-w-md w-full text-center">
        <Heading as="h1" variant="none" unstyledColor className="mb-2 text-foreground">
          <span className="block text-3xl font-bold mb-4">404</span>{' '}
          <span className="block text-xl font-semibold">Page Not Found</span>
        </Heading>
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
