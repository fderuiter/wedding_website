import React from 'react';
import { render, screen } from '@testing-library/react';
import EditRegistryItemPage from '../page';

const mockPush = jest.fn();
const mockItem = {
  id: '1',
  name: 'Mock Item',
  description: 'Test description',
  price: 25.5,
  quantity: 3,
  category: 'Kitchen',
  image: 'https://example.com/image.jpg',
  vendorUrl: 'https://vendor.com',
  isGroupGift: false,
};

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useParams: () => ({ id: mockItem.id }),
}));

describe('EditRegistryItemPage', () => {
  beforeEach(() => {
    (global.fetch as jest.Mock) = jest.fn((url: RequestInfo) => {
      if (typeof url === 'string') {
        if (url.includes('/api/admin/me')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ isAdmin: true }),
          });
        }
        if (url.includes(`/api/registry/items/${mockItem.id}`)) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockItem),
          });
        }
      }
      return Promise.reject(new Error('Unknown URL'));
    }) as jest.Mock;
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('prefills form fields with fetched data', async () => {
    render(<EditRegistryItemPage />);

    expect(await screen.findByLabelText(/item name/i)).toHaveValue(mockItem.name);
    expect(screen.getByLabelText(/price/i)).toHaveValue(mockItem.price);
    expect(screen.getByLabelText(/quantity/i)).toHaveValue(mockItem.quantity);
    expect(screen.getByLabelText(/category/i)).toHaveValue(mockItem.category);
  });
});
