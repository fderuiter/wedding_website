import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { notFound, redirect } from 'next/navigation';
import { isAdminRequest } from '@/core/auth/auth.server';
import { getAppConfig } from '@/lib/config';
import { DEFAULT_MODULE_CONFIG } from '@/lib/modules';
import RegistryRoutePage from '../page';
import RegistryAddItemRoutePage from '../add-item/page';
import RegistryEditItemRoutePage from '../edit-item/[id]/page';

jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  redirect: jest.fn((url: string) => {
    const error = new Error('NEXT_REDIRECT') as Error & { digest?: string };
    error.digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw error;
  }),
}));

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn(),
}));

jest.mock('@/features/registry', () => ({
  RegistryPage: () => <div data-testid="registry-page">Registry Page</div>,
  AddItemPage: () => <div data-testid="add-item-page">Add Item Page</div>,
  EditItemPage: () => <div data-testid="edit-item-page">Edit Item Page</div>,
}));

const mockNotFound = notFound as unknown as jest.Mock;
const mockRedirect = redirect as unknown as jest.Mock;
const mockIsAdminRequest = isAdminRequest as jest.Mock;
const mockGetAppConfig = getAppConfig as jest.Mock;

describe('Registry UI Page Module Guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAdminRequest.mockResolvedValue(true);
  });

  it('calls notFound() on /registry, /registry/add-item, and /registry/edit-item/[id] when registry is disabled', async () => {
    mockGetAppConfig.mockResolvedValue({
      modules: { ...DEFAULT_MODULE_CONFIG, registry: false, groupGifting: false },
    });

    await expect(RegistryRoutePage()).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(RegistryAddItemRoutePage()).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(RegistryEditItemRoutePage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockNotFound).toHaveBeenCalledTimes(3);
  });

  it('renders /registry, /registry/add-item, and /registry/edit-item/[id] when registry is enabled', async () => {
    mockGetAppConfig.mockResolvedValue({
      modules: { ...DEFAULT_MODULE_CONFIG, registry: true },
    });

    const mainView = await RegistryRoutePage();
    render(mainView);
    expect(screen.getByTestId('registry-page')).toBeInTheDocument();

    const addView = await RegistryAddItemRoutePage();
    render(addView);
    expect(screen.getByTestId('add-item-page')).toBeInTheDocument();

    const editView = await RegistryEditItemRoutePage();
    render(editView);
    expect(screen.getByTestId('edit-item-page')).toBeInTheDocument();
  });

  it('redirects unauthenticated callers on /registry/add-item and /registry/edit-item/[id] to /admin/login with HTTP 303', async () => {
    mockIsAdminRequest.mockResolvedValue(false);
    mockGetAppConfig.mockResolvedValue({
      modules: { ...DEFAULT_MODULE_CONFIG, registry: true },
    });

    for (const renderPage of [RegistryAddItemRoutePage, RegistryEditItemRoutePage]) {
      mockRedirect.mockClear();
      let caughtError: (Error & { digest?: string }) | null = null;
      try {
        await renderPage();
      } catch (err) {
        caughtError = err as Error & { digest?: string };
      }
      expect(mockRedirect).toHaveBeenCalledWith('/admin/login');
      expect(caughtError?.digest).toBe('NEXT_REDIRECT;replace;/admin/login;303;');
    }
  });

  it('keeps /registry/add-item and /registry/edit-item/[id] SSR guards inert during STATIC_EXPORT builds', async () => {
    const prevStaticExport = process.env.STATIC_EXPORT;
    process.env.STATIC_EXPORT = 'true';
    mockIsAdminRequest.mockResolvedValue(false);
    mockGetAppConfig.mockResolvedValue({
      modules: { ...DEFAULT_MODULE_CONFIG, registry: true },
    });

    try {
      const addView = await RegistryAddItemRoutePage();
      render(addView);
      expect(screen.getByTestId('add-item-page')).toBeInTheDocument();

      const editView = await RegistryEditItemRoutePage();
      render(editView);
      expect(screen.getByTestId('edit-item-page')).toBeInTheDocument();
      expect(mockRedirect).not.toHaveBeenCalled();
    } finally {
      if (prevStaticExport === undefined) {
        delete process.env.STATIC_EXPORT;
      } else {
        process.env.STATIC_EXPORT = prevStaticExport;
      }
    }
  });
});
