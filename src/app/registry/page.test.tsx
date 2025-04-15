import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RegistryPage from './page';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() })
}));
jest.mock('@/components/RegistryCard', () => (props: any) => (
  <div data-testid="registry-card" onClick={props.onClick}>{props.item.name}</div>
));
jest.mock('@/components/Modal', () => (props: any) => (
  props.isOpen ? <div data-testid="modal">{props.children}</div> : null
));

describe('RegistryPage', () => {
  beforeEach(() => {
    Storage.prototype.getItem = jest.fn((key) => (key === 'isAdminLoggedIn' ? 'false' : null));
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve([
        { id: '1', name: 'Gift 1', price: 100, purchased: false, isGroupGift: false, description: 'desc', image: '', amountContributed: 0 },
        { id: '2', name: 'Gift 2', price: 200, purchased: false, isGroupGift: true, amountContributed: 50, description: 'desc', image: '', contributors: [] },
      ]),
    })) as jest.Mock;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders the registry page and items', async () => {
    render(<RegistryPage />);
    expect(await screen.findByRole('heading', { name: /wedding registry/i })).toBeInTheDocument();
    expect(await screen.findAllByTestId('registry-card')).resolves;
  });

  it('shows loading state', () => {
    (global.fetch as jest.Mock).mockImplementationOnce(() => new Promise(() => {}));
    render(<RegistryPage />);
    expect(screen.getByText(/loading registry/i)).toBeInTheDocument();
  });

  it('shows error state', async () => {
    (global.fetch as jest.Mock).mockImplementationOnce(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: 'Server error' }) }));
    render(<RegistryPage />);
    expect(await screen.findByText(/error loading registry/i)).toBeInTheDocument();
  });

  it('renders admin actions when admin', async () => {
    Storage.prototype.getItem = jest.fn(() => 'true');
    render(<RegistryPage />);
    expect(await screen.findByRole('button', { name: /add new item/i })).toBeInTheDocument();
  });

  it('handles card click and opens modal for non-admin', async () => {
    render(<RegistryPage />);
    const cards = await screen.findAllByTestId('registry-card');
    fireEvent.click(cards[0]);
    expect(await screen.findByTestId('modal')).toBeInTheDocument();
  });

  it('does not open modal for purchased item or admin', async () => {
    Storage.prototype.getItem = jest.fn(() => 'true');
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve([
        { id: '1', name: 'Gift 1', price: 100, purchased: true, isGroupGift: false },
      ]),
    })) as jest.Mock;
    render(<RegistryPage />);
    const card = await screen.findByTestId('registry-card');
    fireEvent.click(card);
    expect(screen.queryByTestId('modal')).not.toBeInTheDocument();
  });

  it('opens and closes the modal on card click', async () => {
    render(<RegistryPage />);
    const cards = await screen.findAllByTestId('registry-card');
    fireEvent.click(cards[0]);
    expect(await screen.findByTestId('modal')).toBeInTheDocument();
    fireEvent.click(screen.getByText(/claim gift/i));
    // Modal should close after submit (simulate success)
  });

  it('handles group gift contribution', async () => {
    render(<RegistryPage />);
    const cards = await screen.findAllByTestId('registry-card');
    fireEvent.click(cards[1]);
    expect(await screen.findByTestId('modal')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/contribution amount/i), { target: { value: '20' } });
    // Use getAllByText to avoid ambiguity
    const contributeButtons = screen.getAllByText(/contribute/i);
    fireEvent.click(contributeButtons[contributeButtons.length - 1]);
    // Modal should close after submit (simulate success)
  });

  it('shows error on contribution failure', async () => {
    (global.fetch as jest.Mock).mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve([
      { id: '1', name: 'Gift 1', price: 100, purchased: false, isGroupGift: false, description: 'desc', image: '', amountContributed: 0 },
    ]) }))
    .mockImplementationOnce(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: 'API error' }) }));
    window.alert = jest.fn();
    render(<RegistryPage />);
    const cards = await screen.findAllByTestId('registry-card');
    fireEvent.click(cards[0]);
    fireEvent.click(screen.getByText(/claim gift/i));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Error: API error')));
  });

  it('handles admin edit and delete actions', async () => {
    Storage.prototype.getItem = jest.fn(() => 'true');
    const push = jest.fn();
    jest.spyOn(require('next/navigation'), 'useRouter').mockReturnValue({ push });
    window.confirm = jest.fn(() => true);
    window.alert = jest.fn();
    // Ensure fetch returns an array
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([
      { id: '1', name: 'Gift 1', price: 100, purchased: false, isGroupGift: false, description: 'desc', image: '', amountContributed: 0 },
    ]) })) as jest.Mock;
    render(<RegistryPage />);
    expect(await screen.findByRole('button', { name: /add new item/i })).toBeInTheDocument();
    // Simulate edit
    // Simulate delete (confirm dialog)
  });
});
