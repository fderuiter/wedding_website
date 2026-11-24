import { redirect } from 'next/navigation';
import { isAdminRequest } from './auth.server';

export function isStaticExportBuild(): boolean {
  return (
    process.env.STATIC_EXPORT === 'true' ||
    process.env.STATIC_EXPORT === '1' ||
    process.env.npm_lifecycle_event === 'build:export'
  );
}

export function redirectWithSeeOther(url: string): never {
  try {
    redirect(url);
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      'digest' in err &&
      typeof (err as { digest?: unknown }).digest === 'string' &&
      (err as { digest: string }).digest.startsWith('NEXT_REDIRECT;')
    ) {
      (err as { digest: string }).digest = (err as { digest: string }).digest.replace(
        /;30[78];$/,
        ';303;'
      );
    }
    throw err;
  }
  throw new Error(`NEXT_REDIRECT:${url}`);
}

/**
 * Server-side rendering guard for admin-only pages and layouts.
 * Enforces `isAdminRequest()` with an HTTP 303 redirect to `/admin/login` while remaining
 * inert during `STATIC_EXPORT` builds.
 */
export async function enforceAdminPageSession(): Promise<void> {
  if (isStaticExportBuild()) {
    return;
  }

  if (!(await isAdminRequest())) {
    redirectWithSeeOther('/admin/login');
  }
}
