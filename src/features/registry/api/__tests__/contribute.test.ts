/** @jest-environment node */

import { POST } from '../contribute';
import { registryService } from '../../service';
import { NextRequest } from 'next/server';
import { isAdminRequest } from '@/core/auth/auth.server';
import { getAppConfig } from '@/lib/config';

jest.mock('../../service', () => ({
  registryService: {
    getItemById: jest.fn(),
    contributeToItem: jest.fn(),
  },
}));

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn(),
}));

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn(),
}));

jest.mock('@/core/auth/guestInviteSession', () => ({
  getGuestInviteSession: jest.fn().mockResolvedValue(null),
}));

describe('POST /api/registry/contribute', () => {
  const mockItem = {
    id: 'item-123',
    name: 'Blender',
    price: 100,
    amountContributed: 0,
    purchased: false,
    isGroupGift: true,
    isSample: false,
    image: { id: 'img-1', url: '/image.jpg' },
    contributors: [],
  };

  const mockUpdatedItem = {
    ...mockItem,
    amountContributed: 50,
    contributors: [
      {
        id: 'c-1',
        name: 'John Wellwisher',
        email: 'john@example.com',
        amount: 50,
        message: 'Congrats!',
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getAppConfig as jest.Mock).mockResolvedValue({
      modules: ['registry', 'groupGifting'],
    });
    (isAdminRequest as jest.Mock).mockResolvedValue(false);
    (registryService.getItemById as jest.Mock).mockResolvedValue(mockItem);
    (registryService.contributeToItem as jest.Mock).mockResolvedValue(mockUpdatedItem);
  });

  it('successfully processes contribution without an invitation code', async () => {
    const request = new NextRequest('http://localhost:3000/api/registry/contribute', {
      method: 'POST',
      body: JSON.stringify({
        itemId: 'item-123',
        name: 'John Wellwisher',
        email: 'john@example.com',
        amount: 50,
        message: 'Best wishes!',
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    expect(registryService.contributeToItem).toHaveBeenCalledWith('item-123', {
      name: 'John Wellwisher',
      email: 'john@example.com',
      amount: 50,
      code: undefined,
      message: 'Best wishes!',
      coverFee: false,
    });
  });

  it('accepts contribution when email is omitted/blank', async () => {
    const request = new NextRequest('http://localhost:3000/api/registry/contribute', {
      method: 'POST',
      body: JSON.stringify({
        itemId: 'item-123',
        name: 'Anonymous Friend',
        amount: 25,
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    expect(registryService.contributeToItem).toHaveBeenCalledWith('item-123', {
      name: 'Anonymous Friend',
      email: undefined,
      amount: 25,
      code: undefined,
      message: undefined,
      coverFee: false,
    });
  });

  it('rejects contribution with invalid email format', async () => {
    const request = new NextRequest('http://localhost:3000/api/registry/contribute', {
      method: 'POST',
      body: JSON.stringify({
        itemId: 'item-123',
        name: 'John Wellwisher',
        email: 'not-an-email',
        amount: 50,
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toContain('Invalid email address.');
  });

  it('rejects contributions on sample registry items', async () => {
    (registryService.getItemById as jest.Mock).mockResolvedValue({
      ...mockItem,
      isSample: true,
    });

    const request = new NextRequest('http://localhost:3000/api/registry/contribute', {
      method: 'POST',
      body: JSON.stringify({
        itemId: 'item-123',
        name: 'Test Contributor',
        amount: 50,
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toContain('Sample registry items do not accept contributions');
  });
});
