import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import WeddingPartyPage, { metadata } from '../page';

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn().mockResolvedValue({
    modules: { weddingParty: true },
  }),
}));

jest.mock('@/lib/modules', () => ({
  isFeatureEnabled: jest.fn().mockReturnValue(true),
}));

jest.mock('@/features/wedding-party', () => ({
  weddingPartyRepository: {
    getMembers: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('@/components/WeddingPartyList', () => {
  return function DummyWeddingPartyList() {
    return <div data-testid="wedding-party-list" />;
  };
});

describe('WeddingPartyPage', () => {
  it('defines canonical alternate metadata', () => {
    expect(metadata.alternates?.canonical).toBe('/wedding-party');
  });

  it('renders the wedding party page heading and list', async () => {
    const Component = await WeddingPartyPage();
    render(Component);
    expect(screen.getByRole('heading', { level: 1, name: 'Wedding Party' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Wedding Party Members' })
    ).toBeInTheDocument();
    expect(screen.getByTestId('wedding-party-list')).toBeInTheDocument();
  });
});
