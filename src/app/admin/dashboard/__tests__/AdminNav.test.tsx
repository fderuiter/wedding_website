import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AdminNav } from '../AdminNav';

let mockPathname = '/admin/dashboard';

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

describe('AdminNav Target Size and Accessibility Styling', () => {
  const sampleItems = [
    { href: '/admin/dashboard', label: 'Registry' },
    { href: '/admin/dashboard/invitation-codes', label: 'Invitation Codes' },
    { href: '/admin/dashboard/site-manager', label: 'Site Manager' },
  ];

  beforeEach(() => {
    mockPathname = '/admin/dashboard';
  });

  it('enforces minimum target dimensions, padding, and focus/hover classes on navigation links', () => {
    render(<AdminNav items={sampleItems} />);

    const registryLink = screen.getByRole('link', { name: 'Registry' });
    const invitationLink = screen.getByRole('link', { name: 'Invitation Codes' });

    // Minimum target height and width under WCAG 2.2 SC 2.5.8
    expect(registryLink).toHaveClass('min-h-[32px]');
    expect(registryLink).toHaveClass('min-w-[24px]');
    expect(invitationLink).toHaveClass('min-h-[32px]');
    expect(invitationLink).toHaveClass('min-w-[24px]');

    // Padding for clear hit targets
    expect(registryLink).toHaveClass('px-3');
    expect(registryLink).toHaveClass('py-1.5');
    expect(invitationLink).toHaveClass('px-3');
    expect(invitationLink).toHaveClass('py-1.5');

    // Matching focus-visible and hover styles
    expect(registryLink).toHaveClass('focus-visible:ring-2');
    expect(invitationLink).toHaveClass('focus-visible:ring-2');
    expect(invitationLink).toHaveClass('hover:bg-[var(--btn-ghost-hover-bg,rgba(0,0,0,0.05))]');
  });

  it('renders a flex container with gap spacing to prevent clipping on wrap', () => {
    render(<AdminNav items={sampleItems} />);

    const listElement = screen.getByRole('list');
    expect(listElement).toHaveClass('flex-wrap');
    expect(listElement).toHaveClass('gap-2');
  });
});
