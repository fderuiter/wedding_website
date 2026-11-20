import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { notFound } from 'next/navigation';
import { getAppConfig } from '@/lib/config';
import { DEFAULT_MODULE_CONFIG } from '@/lib/modules';
import RegistryRoutePage from '../page';
import RegistryAddItemRoutePage from '../add-item/page';
import RegistryEditItemRoutePage from '../edit-item/[id]/page';

jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
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
const mockGetAppConfig = getAppConfig as jest.Mock;

describe('Registry UI Page Module Guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
});
