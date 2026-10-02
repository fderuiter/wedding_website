import { generateMetadata } from '@/app/metadata';

describe('Provider Neutrality', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('generates metadata without provider-specific hardcoded strings like Vercel', async () => {
    // Explicitly delete any provider vars
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    delete process.env.NETLIFY;

    const metadata = await generateMetadata();

    expect(metadata.publisher).not.toBe('Vercel');
    expect(metadata.publisher).not.toBe('Netlify');
    expect(typeof metadata.publisher).toBe('string');
  });

  it('operates in an environment stripped of provider-specific environment variables', () => {
    const providerVars = [
      'VERCEL',
      'VERCEL_ENV',
      'VERCEL_URL',
      'NEXT_PUBLIC_VERCEL_ENV',
      'NETLIFY',
      'NETLIFY_IMAGES_CDN_DOMAIN',
      'AWS_LAMBDA_FUNCTION_NAME',
    ];

    for (const v of providerVars) {
      delete process.env[v];
    }

    providerVars.forEach((v) => {
      expect(process.env[v]).toBeUndefined();
    });
  });
});
