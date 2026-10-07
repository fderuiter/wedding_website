import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe } from 'jest-axe';
import WeddingPartyList from '../WeddingPartyList';
import type { WeddingPartyMemberDTO } from '@/features/wedding-party';

describe('WeddingPartyList', () => {
  const mockMembers: WeddingPartyMemberDTO[] = [
    {
      id: 'member-1',
      name: 'John Doe',
      role: 'Best Man',
      bio: 'Groom\'s best friend since high school.',
      side: 'GROOM',
      photoId: 'media-1',
      photoUrl: 'https://example.com/john.jpg',
      photoAlt: 'John smiling',
      photoDecorative: false,
      photo: {
        id: 'media-1',
        url: 'https://example.com/john.jpg',
        altText: 'John smiling',
        isDecorative: false,
      },
      link: 'https://example.com/john',
      order: 1,
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    },
    {
      id: 'member-2',
      name: 'Jane Smith',
      role: 'Maid of Honor',
      bio: 'Bride\'s sister.',
      side: 'BRIDE',
      photoId: undefined,
      photoUrl: '',
      photoAlt: null,
      photoDecorative: false,
      photo: undefined,
      link: '',
      order: 2,
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    },
    {
      id: 'member-3',
      name: 'Sam Wilson',
      role: 'Officiant',
      bio: 'Mutual friend.',
      side: 'JOINT',
      photoId: undefined,
      photoUrl: '',
      photoAlt: null,
      photoDecorative: false,
      photo: undefined,
      link: '',
      order: 3,
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    },
    {
      id: 'member-4',
      name: 'Alex Taylor',
      role: 'Usher',
      bio: 'Family friend.',
      side: null,
      photoId: undefined,
      photoUrl: '',
      photoAlt: null,
      photoDecorative: false,
      photo: undefined,
      link: '',
      order: 4,
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    },
  ];

  let originalParent: any;

  beforeAll(() => {
    originalParent = window.parent;
    Object.defineProperty(window, 'parent', {
      value: {}, // some different object to make window !== window.parent true
      configurable: true,
      writable: true,
    });
  });

  afterAll(() => {
    Object.defineProperty(window, 'parent', {
      value: originalParent,
      configurable: true,
      writable: true,
    });
  });

  it('renders all member cards inside a grid layout correctly under default "All" tab', () => {
    render(<WeddingPartyList members={mockMembers} />);

    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('Best Man')).toBeInTheDocument();
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    expect(screen.getByText('Maid of Honor')).toBeInTheDocument();
    expect(screen.getByText('Sam Wilson')).toBeInTheDocument();
    expect(screen.getByText('Alex Taylor')).toBeInTheDocument();
  });

  it('filters wedding party members interactively when clicking side tabs', () => {
    render(<WeddingPartyList members={mockMembers} />);

    // Click "Bride's Side" tab
    fireEvent.click(screen.getByRole('tab', { name: "Bride's Side" }));
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    expect(screen.queryByText('John Doe')).not.toBeInTheDocument();
    expect(screen.queryByText('Sam Wilson')).not.toBeInTheDocument();
    expect(screen.queryByText('Alex Taylor')).not.toBeInTheDocument();

    // Click "Groom's Side" tab
    fireEvent.click(screen.getByRole('tab', { name: "Groom's Side" }));
    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.queryByText('Jane Smith')).not.toBeInTheDocument();
    expect(screen.queryByText('Sam Wilson')).not.toBeInTheDocument();
    expect(screen.queryByText('Alex Taylor')).not.toBeInTheDocument();

    // Click "Joint" tab
    fireEvent.click(screen.getByRole('tab', { name: 'Joint' }));
    expect(screen.getByText('Sam Wilson')).toBeInTheDocument();
    expect(screen.queryByText('John Doe')).not.toBeInTheDocument();
    expect(screen.queryByText('Jane Smith')).not.toBeInTheDocument();
    expect(screen.queryByText('Alex Taylor')).not.toBeInTheDocument();

    // Switch back to "All" tab - all members including null side should be displayed
    fireEvent.click(screen.getByRole('tab', { name: 'All' }));
    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    expect(screen.getByText('Sam Wilson')).toBeInTheDocument();
    expect(screen.getByText('Alex Taylor')).toBeInTheDocument();
  });

  it('matches the grid markup changes using baseline Jest snapshot assertions', () => {
    const { container } = render(<WeddingPartyList members={mockMembers} />);
    expect(container).toMatchSnapshot();
  });

  it('updates dynamically when list receives verified draft update events via postMessage', () => {
    render(<WeddingPartyList members={mockMembers} />);

    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.queryByText('Alice Johnson')).not.toBeInTheDocument();

    const updatedMembers: WeddingPartyMemberDTO[] = [
      {
        id: 'member-3',
        name: 'Alice Johnson',
        role: 'Bridesmaid',
        bio: 'Bride\'s college friend.',
        photoId: undefined,
        photoUrl: '',
        photoAlt: null,
        photoDecorative: false,
        photo: undefined,
        link: '',
        order: 1,
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        updatedAt: new Date('2025-01-01T00:00:00.000Z'),
      },
    ];

    // Simulate verified admin update postMessage event
    act(() => {
      const messageEvent = new MessageEvent('message', {
        data: {
          type: 'DRAFT_UPDATE',
          draftType: 'wedding-party',
          draftData: updatedMembers,
        },
      });
      window.dispatchEvent(messageEvent);
    });

    // Verify it updated correctly
    expect(screen.queryByText('John Doe')).not.toBeInTheDocument();
    expect(screen.getByText('Alice Johnson')).toBeInTheDocument();
    expect(screen.getByText('Bridesmaid')).toBeInTheDocument();
  });

  it('does not respond to events not matching verified administrative formats', () => {
    render(<WeddingPartyList members={mockMembers} />);

    expect(screen.getByText('John Doe')).toBeInTheDocument();

    // Event with incorrect type
    act(() => {
      const wrongTypeEvent = new MessageEvent('message', {
        data: {
          type: 'OTHER_UPDATE',
          draftType: 'wedding-party',
          draftData: [],
        },
      });
      window.dispatchEvent(wrongTypeEvent);
    });
    expect(screen.getByText('John Doe')).toBeInTheDocument();

    // Event with incorrect draftType
    act(() => {
      const wrongDraftTypeEvent = new MessageEvent('message', {
        data: {
          type: 'DRAFT_UPDATE',
          draftType: 'attractions',
          draftData: [],
        },
      });
      window.dispatchEvent(wrongDraftTypeEvent);
    });
    expect(screen.getByText('John Doe')).toBeInTheDocument();

    // Event with malformed data
    act(() => {
      const malformedEvent = new MessageEvent('message', {
        data: null,
      });
      window.dispatchEvent(malformedEvent);
    });
    expect(screen.getByText('John Doe')).toBeInTheDocument();
  });

  it('evaluates rendered list markup with zero accessibility warnings', async () => {
    const { container } = render(<WeddingPartyList members={mockMembers} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
