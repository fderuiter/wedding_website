import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RegistryClient from '@/features/registry/pages/index';
import { RegistryItem } from '@/features/registry/types';
import * as actions from '@/features/registry/actions';

const pushMock = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

jest.mock('@/features/registry/actions', () => ({
  deleteRegistryItem: jest.fn(),
  contributeToRegistryItem: jest.fn(),
}));

jest.mock('framer-motion', () => ({
  __esModule: true,
  motion: new Proxy(
    {},
    {
      get: (_target, prop) =>
        (props: any) => React.createElement(prop as string, props),
    }
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('RegistryPage', () => {
  const items: RegistryItem[] = [
    {
      id: '1',
      name: 'Toaster',
      description: 'Makes toast',
      category: 'Kitchen',
      price: 30,
      image: '/img1',
      vendorUrl: null,
      quantity: 1,
      isGroupGift: false,
      purchased: false,
      purchaserName: null,
      amountContributed: 0,
      contributors: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: '2',
      name: 'Lamp',
      description: 'Lights room',
      category: 'Bedroom',
      price: 50,
      image: '/img2',
      vendorUrl: null,
      quantity: 1,
      isGroupGift: false,
      purchased: false,
      purchaserName: null,
      amountContributed: 0,
      contributors: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: '3',
      name: 'Mixer',
      description: 'Mixes things',
      category: 'Kitchen',
      price: 150,
      image: '/img3',
      vendorUrl: null,
      quantity: 1,
      isGroupGift: true,
      purchased: false,
      purchaserName: null,
      amountContributed: 0,
      contributors: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  beforeEach(() => {
    pushMock.mockReset();
    jest.spyOn(window, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function setup(initialIsAdmin = false) {
    return render(<RegistryClient initialItems={items} initialIsAdmin={initialIsAdmin} />);
  }

  it('renders items and filters by category and price', async () => {
    setup();

    expect(screen.getByText('Toaster')).toBeInTheDocument();
    expect(screen.getByText('Lamp')).toBeInTheDocument();
    expect(screen.getByText('Mixer')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Kitchen'));
    expect(screen.getByText('Toaster')).toBeInTheDocument();
    expect(screen.getByText('Mixer')).toBeInTheDocument();
    expect(screen.queryByText('Lamp')).not.toBeInTheDocument();

    const sliders = screen.getAllByRole('slider');
    fireEvent.change(sliders[1], { target: { value: '100' } });

    expect(screen.getByText('Toaster')).toBeInTheDocument();
    expect(screen.queryByText('Mixer')).not.toBeInTheDocument();
  });

  it('navigates to edit page when Edit is clicked', async () => {
    setup(true);
    fireEvent.click(screen.getByLabelText('Edit Toaster'));
    expect(pushMock).toHaveBeenCalledWith(`/registry/edit-item/1`);
  });

  it('deletes item when confirmed', async () => {
    (actions.deleteRegistryItem as jest.Mock).mockResolvedValue(undefined);
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
    
    setup(true);
    fireEvent.click(screen.getByLabelText('Delete Toaster'));

    await waitFor(() => {
      expect(actions.deleteRegistryItem).toHaveBeenCalledWith('1');
      expect(alertSpy).toHaveBeenCalledWith('Item deleted successfully.');
    });
  });

  it('shows error when delete fails', async () => {
    (actions.deleteRegistryItem as jest.Mock).mockRejectedValue(new Error('fail'));
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});

    setup(true);
    fireEvent.click(screen.getByLabelText('Delete Toaster'));

    await waitFor(() => {
      expect(actions.deleteRegistryItem).toHaveBeenCalledWith('1');
      expect(alertSpy).toHaveBeenCalledWith('Error deleting item: fail');
    });
  });
});

