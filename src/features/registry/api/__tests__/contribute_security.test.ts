import { POST } from '@/app/api/registry/contribute/route';
import { RegistryService } from '@/features/registry/service';

// Mock RegistryService
jest.mock('@/features/registry/service', () => ({
  RegistryService: {
    contributeToItem: jest.fn(),
  },
}));

describe('POST /api/registry/contribute - Security', () => {
  const mockContributeToItem = RegistryService.contributeToItem as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    // Spy on console.error to suppress expected error logs
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should NOT leak sensitive error details', async () => {
    // Simulate a database error with sensitive info
    const sensitiveError = new Error('Database connection failed: user "postgres" password mismatch');
    mockContributeToItem.mockRejectedValue(sensitiveError);

    const body = {
      itemId: 'test-id',
      name: 'Test User',
      amount: 100
    };

    const req = new Request('http://localhost/api/registry/contribute', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(500);
    // Verified: Should return generic message
    expect(data.error).toBe('An error occurred while processing your request.');
  });

  it('should pass through safe business logic errors', async () => {
    // Simulate a business logic error
    const logicError = new Error('This item has already been purchased.');
    mockContributeToItem.mockRejectedValue(logicError);

    const body = {
      itemId: 'test-id',
      name: 'Test User',
      amount: 100
    };

    const req = new Request('http://localhost/api/registry/contribute', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400); // Business errors are 400
    // Verified: Should return specific message
    expect(data.error).toBe('This item has already been purchased.');
  });
});
