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

    expect(await screen.findByText('Item name is required and must be under 255 characters.')).toBeInTheDocument();
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
      itemType: 'PHYSICAL',
      name: 'Toaster',
      description: 'Toast bread',
      price: 12.34,
      quantity: 2,
      category: 'Kitchen',
      imageUrl: 'http://example.com/img.jpg',
      vendorUrl: 'http://vendor.com/item',
      isGroupGift: true,
      paymentHandleType: undefined,
      paymentHandle: undefined,
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
      itemType: 'PHYSICAL',
      name: 'Mixer',
      description: '',
      price: 120.5,
      quantity: 2,
      category: 'Kitchen',
      imageUrl: '',
      vendorUrl: '',
      isGroupGift: false,
      paymentHandleType: undefined,
      paymentHandle: undefined,
    });
  });

  it('supports creating a cash fund with target goal amount and payment handle', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    render(<RegistryItemForm mode="add" onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/Item Type/i), { target: { value: 'CASH_FUND' } });

    expect(screen.queryByLabelText(/Import from Product URL/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Quantity/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Target Goal Amount/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Item Name/i), { target: { value: 'Honeymoon Fund' } });
    fireEvent.change(screen.getByLabelText(/Target Goal Amount/i), { target: { value: '2500' } });
    fireEvent.change(screen.getByLabelText(/Payment Service/i), { target: { value: 'Venmo' } });
    fireEvent.change(screen.getByLabelText(/Payment Handle/i), { target: { value: '@our-honeymoon' } });

    fireEvent.submit(screen.getByTestId('form'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith({
      itemType: 'CASH_FUND',
      name: 'Honeymoon Fund',
      category: 'Cash Fund',
      price: 2500,
      quantity: 1,
      isGroupGift: true,
      paymentHandleType: 'Venmo',
      paymentHandle: '@our-honeymoon',
      description: '',
      imageUrl: '',
      vendorUrl: undefined,
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

  it('displays contextual site advice when scraper encounters BLOCKED_BY_VENDOR error for Costco and focuses Item Name', async () => {
    const mockFetch = jest
      .fn()
      .mockResolvedValue({
        ok: false,
        status: 422,
        json: () => Promise.resolve({
          error: 'BLOCKED_BY_VENDOR: Access to this retailer website was blocked.',
          details: { errorDomain: 'BLOCKED_BY_VENDOR' }
        }),
      } as Response) as jest.Mock;
    global.fetch = mockFetch as unknown as typeof fetch;

    render(<RegistryItemForm mode="add" onSubmit={jest.fn()} />);

    fireEvent.change(screen.getByLabelText(/Import from Product URL/i), { target: { value: 'https://www.costco.com/sample-item' } });
    fireEvent.click(screen.getByRole('button', { name: /import/i }));

    expect(await screen.findByText('Costco blocks automated product imports. Please enter item details manually below.')).toBeInTheDocument();
    
    await waitFor(() => {
      expect(screen.getByLabelText(/Item Name/i)).toHaveFocus();
    });
  });

  it('notifies about missing image and allows applying default placeholder image or site favicon', async () => {
    const mockFetch = jest
      .fn()
      .mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          name: 'Item without image',
          imageUrl: '',
          faviconUrl: 'https://www.example.com/favicon.ico',
        }),
      } as Response) as jest.Mock;
    global.fetch = mockFetch as unknown as typeof fetch;

    render(<RegistryItemForm mode="add" onSubmit={jest.fn()} />);

    fireEvent.change(screen.getByLabelText(/Import from Product URL/i), { target: { value: 'https://www.example.com/no-image' } });
    fireEvent.click(screen.getByRole('button', { name: /import/i }));

    await waitFor(() => expect(screen.getByLabelText(/Item Name/i)).toHaveValue('Item without image'));
    expect(screen.getByTestId('scrape-warning-banner')).toBeInTheDocument();

    // Click Use Default Image button in warning banner
    fireEvent.click(screen.getByTestId('btn-apply-placeholder-image'));
    expect(screen.getByLabelText(/Image URL/i)).toHaveValue('/images/placeholder.png');
  });

  it('allows applying site favicon image fallback', async () => {
    const mockFetch = jest
      .fn()
      .mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          name: 'Item with Favicon',
          imageUrl: '',
          faviconUrl: 'https://www.example.com/favicon.ico',
        }),
      } as Response) as jest.Mock;
    global.fetch = mockFetch as unknown as typeof fetch;

    render(<RegistryItemForm mode="add" onSubmit={jest.fn()} />);

    fireEvent.change(screen.getByLabelText(/Import from Product URL/i), { target: { value: 'https://www.example.com/no-image' } });
    fireEvent.click(screen.getByRole('button', { name: /import/i }));

    await waitFor(() => expect(screen.getByTestId('btn-apply-favicon-image')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('btn-apply-favicon-image'));
    expect(screen.getByLabelText(/Image URL/i)).toHaveValue('https://www.example.com/favicon.ico');
  });

  it('persists draft attributes and scrapeUrl to sessionStorage and restores on remount', async () => {
    window.sessionStorage.clear();

    const { unmount } = render(<RegistryItemForm mode="add" onSubmit={jest.fn()} />);

    fireEvent.change(screen.getByLabelText(/Import from Product URL/i), {
      target: { value: 'https://example.com/draft-product' },
    });
    fireEvent.change(screen.getByLabelText(/Item Name/i), {
      target: { value: 'Espresso Machine' },
    });
    fireEvent.change(screen.getByLabelText(/Price/i), {
      target: { value: '299.99' },
    });

    // Check sessionStorage
    const saved = window.sessionStorage.getItem('registry_item_form_add');
    expect(saved).not.toBeNull();
    const parsed = JSON.parse(saved!);
    expect(parsed.scrapeUrl).toBe('https://example.com/draft-product');
    expect(parsed.values.name).toBe('Espresso Machine');
    expect(parsed.values.price).toBe('299.99');

    // Unmount and remount
    unmount();

    render(<RegistryItemForm mode="add" onSubmit={jest.fn()} />);

    expect(screen.getByLabelText(/Import from Product URL/i)).toHaveValue('https://example.com/draft-product');
    expect(screen.getByLabelText(/Item Name/i)).toHaveValue('Espresso Machine');
    expect(screen.getByLabelText(/Price/i)).toHaveValue(299.99);
  });

  it('populates vendorUrl with scrapeUrl when scraping fails and vendorUrl is empty', async () => {
    const mockFetch = jest
      .fn()
      .mockResolvedValue({
        ok: false,
        status: 422,
        json: () =>
          Promise.resolve({
            error: 'BLOCKED_BY_VENDOR: Access blocked.',
            details: { errorDomain: 'BLOCKED_BY_VENDOR' },
          }),
      } as Response) as jest.Mock;
    global.fetch = mockFetch as unknown as typeof fetch;

    render(<RegistryItemForm mode="add" onSubmit={jest.fn()} />);

    const scrapeUrlInput = screen.getByLabelText(/Import from Product URL/i);
    const vendorUrlInput = screen.getByLabelText(/Vendor\/Product URL/i);

    expect(vendorUrlInput).toHaveValue('');

    fireEvent.change(scrapeUrlInput, {
      target: { value: 'https://www.target.com/p/sample-item' },
    });
    fireEvent.click(screen.getByRole('button', { name: /import/i }));

    await waitFor(() => {
      expect(vendorUrlInput).toHaveValue('https://www.target.com/p/sample-item');
    });
    expect(scrapeUrlInput).toHaveValue('https://www.target.com/p/sample-item');
    expect(
      screen.getByText('Target blocks automated product imports. Please enter item details manually below.')
    ).toBeInTheDocument();
  });

  it('does not overwrite vendorUrl when scraping fails if vendorUrl was already entered by user', async () => {
    const mockFetch = jest
      .fn()
      .mockResolvedValue({
        ok: false,
        status: 404,
        json: () =>
          Promise.resolve({
            error: 'URL_NOT_FOUND: Product page not found',
            details: { errorDomain: 'URL_NOT_FOUND' },
          }),
      } as Response) as jest.Mock;
    global.fetch = mockFetch as unknown as typeof fetch;

    render(<RegistryItemForm mode="add" onSubmit={jest.fn()} />);

    const scrapeUrlInput = screen.getByLabelText(/Import from Product URL/i);
    const vendorUrlInput = screen.getByLabelText(/Vendor\/Product URL/i);

    fireEvent.change(vendorUrlInput, {
      target: { value: 'https://custom-vendor.com/already-typed' },
    });
    fireEvent.change(scrapeUrlInput, {
      target: { value: 'https://example.com/bad-link' },
    });
    fireEvent.click(screen.getByRole('button', { name: /import/i }));

    await waitFor(() => {
      expect(screen.getByText(/product page could not be found/i)).toBeInTheDocument();
    });
    expect(vendorUrlInput).toHaveValue('https://custom-vendor.com/already-typed');
  });
});
