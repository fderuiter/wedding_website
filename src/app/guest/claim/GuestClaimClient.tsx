'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Container } from '@/components/ui/Layout';
import { ClaimFulfillmentHub } from '@/features/registry';

function GuestClaimContent() {
  const searchParams = useSearchParams();
  const token = searchParams?.get('token')?.trim() || '';

  return (
    <Container className="max-w-none bg-[var(--color-background,#f8fafc)] text-[var(--color-foreground,#0f172a)] py-12 sm:py-16 px-4">
      <ClaimFulfillmentHub mode="page" initialToken={token} />
    </Container>
  );
}

export default function GuestClaimClient() {
  return (
    <Suspense
      fallback={
        <Container className="max-w-none bg-[var(--color-background,#f8fafc)] text-[var(--color-foreground,#0f172a)] py-16 px-4">
          <div className="w-full max-w-5xl mx-auto rounded-2xl bg-white dark:bg-gray-800 border border-stone-200 dark:border-gray-700 shadow-xl p-8 text-center">
            <p role="status" className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Loading gift reservation...
            </p>
          </div>
        </Container>
      }
    >
      <GuestClaimContent />
    </Suspense>
  );
}
