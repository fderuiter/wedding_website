import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import RegistryItemForm from '../RegistryItemForm';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.clearAllMocks();
});

describe('RegistryItemForm', () => {
  it('shows required field message when submitting empty form', async () => {
    const onSubmit = jest.fn();
    render(<RegistryItemForm mode="add" onSubmit={onSubmit} />);

    fireEvent.submit(screen.getByTestId('form'));

    expect(await screen.findByText('Name, price, quantity, and category are required.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits normalized numeric values', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    render(<RegistryItemForm mode="add" onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/Item Name/i), { target: { value: 'Toaster' } });
    fireEvent.change(screen.getByLabelText(/Description/i), { target: { value: 'Toast bread' } });
    fireEvent.change(screen.getByLabelText(/Price/), { target: { value: '12.34' } });
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/Category/), { target: { value: 'Kitchen' } });
    fireEvent.change(screen.getByLabelText(/Image URL/), { target: { value: 'http://example.com/img.jpg' } });
    fireEvent.change(screen.getByLabelText(/Vendor\/Product URL/), { target: { value: 'http://vendor.com/item' } });
    fireEvent.click(screen.getByLabelText(/Allow Group Gifting/));

    fireEvent.submit(screen.getByTestId('form'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Toaster',
      description: 'Toast bread',
      price: 12.34,
      quantity: 2,
      category: 'Kitchen',
      image: 'http://example.com/img.jpg',
      vendorUrl: 'http://vendor.com/item',
      isGroupGift: true,
    });
  });

  it('preloads and submits updated values in edit mode', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    const initialValues = {
      name: 'Mixer',
      price: 99.99,
      quantity: 2,
      category: 'Kitchen',
    };

    render(<RegistryItemForm mode="edit" onSubmit={onSubmit} initialValues={initialValues} />);

    expect(screen.getByLabelText(/Item Name/i)).toHaveValue('Mixer');
    expect(screen.getByLabelText(/Price/)).toHaveValue(99.99);
    expect(screen.getByLabelText(/Quantity/)).toHaveValue(2);
    expect(screen.getByLabelText(/Category/)).toHaveValue('Kitchen');

    fireEvent.change(screen.getByLabelText(/Price/), { target: { value: '120.5' } });

    fireEvent.submit(screen.getByTestId('form'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Mixer',
      description: '',
      price: 120.5,
      quantity: 2,
      category: 'Kitchen',
      image: '',
      vendorUrl: '',
      isGroupGift: false,
    });
  });

  it('populates fields with scraped data on success', async () => {
    const mockFetch = jest
      .fn()
      .mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ name: 'Scraped Item', price: 50, category: 'Home' }),
      } as Response) as jest.Mock;
    global.fetch = mockFetch as unknown as typeof fetch;

    render(<RegistryItemForm mode="add" onSubmit={jest.fn()} />);

    fireEvent.change(screen.getByLabelText(/Import from Product URL/i), { target: { value: 'http://example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /import/i }));

    await waitFor(() => expect(screen.getByLabelText(/Item Name/i)).toHaveValue('Scraped Item'));
    expect(screen.getByLabelText(/Price/)).toHaveValue(50);
    expect(screen.getByLabelText(/Category/)).toHaveValue('Home');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('shows error message when scraping fails', async () => {
    const mockFetch = jest
      .fn()
      .mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'Scrape failed' }),
      } as Response) as jest.Mock;
    global.fetch = mockFetch as unknown as typeof fetch;

    render(<RegistryItemForm mode="add" onSubmit={jest.fn()} />);

    fireEvent.change(screen.getByLabelText(/Import from Product URL/i), { target: { value: 'bad url' } });
    fireEvent.click(screen.getByRole('button', { name: /import/i }));

    expect(await screen.findByText('Scrape failed')).toBeInTheDocument();
  });
});
