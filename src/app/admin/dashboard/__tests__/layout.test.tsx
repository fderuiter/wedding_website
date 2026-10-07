import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import AdminDashboardLayout from '../layout';
import { AdminNav } from '../AdminNav';

let mockPathname = '/admin/dashboard';

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn().mockResolvedValue({
    modules: {},
  }),
}));

describe('AdminDashboardLayout and AdminNav', () => {
  beforeEach(() => {
    mockPathname = '/admin/dashboard';
  });

  const sampleItems = [
    { href: '/admin/dashboard', label: 'Registry' },
    { href: '/admin/dashboard/invitation-codes', label: 'Invitation Codes' },
    { href: '/admin/dashboard/settings', label: 'Settings' },
  ];

  it('sets aria-current="page" on the active link for exact root path', () => {
    mockPathname = '/admin/dashboard';
    render(<AdminNav items={sampleItems} />);

    const registryLink = screen.getByRole('link', { name: 'Registry' });
    const invitationLink = screen.getByRole('link', { name: 'Invitation Codes' });
    const settingsLink = screen.getByRole('link', { name: 'Settings' });

    expect(registryLink).toHaveAttribute('aria-current', 'page');
    expect(invitationLink).not.toHaveAttribute('aria-current');
    expect(settingsLink).not.toHaveAttribute('aria-current');
  });

  it('sets aria-current="page" on sub-route link and not on root path', () => {
    mockPathname = '/admin/dashboard/invitation-codes';
    render(<AdminNav items={sampleItems} />);

    const registryLink = screen.getByRole('link', { name: 'Registry' });
    const invitationLink = screen.getByRole('link', { name: 'Invitation Codes' });
    const settingsLink = screen.getByRole('link', { name: 'Settings' });

    expect(registryLink).not.toHaveAttribute('aria-current');
    expect(invitationLink).toHaveAttribute('aria-current', 'page');
    expect(settingsLink).not.toHaveAttribute('aria-current');
  });

  it('renders a semantic <main> landmark element in layout', async () => {
    const layoutElement = await AdminDashboardLayout({
      children: <div data-testid="test-child">Admin Content</div>,
    });

    render(layoutElement);

    const mainElement = screen.getByRole('main');
    expect(mainElement).toBeInTheDocument();
    expect(mainElement).toHaveTextContent('Admin Content');
  });

  it('renders admin navigation with banner header in layout', async () => {
    const layoutElement = await AdminDashboardLayout({
      children: <div>Content</div>,
    });

    render(layoutElement);

    const navElement = screen.getByRole('navigation', { name: 'Admin Navigation' });
    expect(navElement).toBeInTheDocument();
  });
});
