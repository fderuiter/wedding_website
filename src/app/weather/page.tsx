import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Forecast } from '@/features/weather';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { formatDate } from '@/utils/intl';
import { enforceActiveGuestPageSession } from '@/core/auth/guestInviteSession';

export const metadata: Metadata = {
  title: 'Weather Forecast',
  description: 'The weather forecast for our big day!',
};

/**
 * @page WeatherPage
 * @description A page to display the weather forecast for the wedding day.
 *
 * @returns {JSX.Element} The rendered WeatherPage component.
 */
export default async function WeatherPage() {
  await enforceActiveGuestPageSession();
  const config = await getAppConfig();
  if (!isFeatureEnabled('weather', config.modules)) {
    notFound();
  }

  const hasValidWeddingDate = Boolean(
    config.weddingDate && !isNaN(new Date(config.weddingDate).getTime())
  );
  const formattedDate = hasValidWeddingDate ? formatDate(config.weddingDate) : null;

  return (
    <div className="container mx-auto px-4 py-12 sm:py-16 md:py-20">
      <h1 className="text-4xl sm:text-5xl font-extrabold text-center mb-4 text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">
        The Forecast for Our Big Day
      </h1>
      {formattedDate && (
        <p className="text-center text-lg sm:text-xl text-[var(--color-muted-text,#4b5563)] mb-10">
          {formattedDate}
        </p>
      )}
      <ErrorBoundary title="Weather Forecast Error" message="An error occurred while loading the weather forecast widget.">
        <Forecast />
      </ErrorBoundary>
    </div>
  );
}
