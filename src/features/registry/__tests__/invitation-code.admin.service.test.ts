import { InvitationCodeAdminService } from '../invitation-code.admin.service';

describe('InvitationCodeAdminService', () => {
  let service: InvitationCodeAdminService;
  let mockPrismaClient: any;

  beforeEach(() => {
    mockPrismaClient = {
      invitationCode: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    service = new InvitationCodeAdminService();
    // Inject mock client into repo
    service.repo.client = mockPrismaClient;
  });

  describe('validate', () => {
    it('passes for valid invitation code data', async () => {
      await expect(
        (service as any).validate({ guestName: 'Alice Smith', code: 'ALICE123' })
      ).resolves.not.toThrow();
    });

    it('throws error when guestName is missing or empty', async () => {
      await expect(
        (service as any).validate({ guestName: '', code: 'ALICE123' })
      ).rejects.toThrow('Validation Error: Guest name is required.');

      await expect(
        (service as any).validate({ code: 'ALICE123' })
      ).rejects.toThrow('Validation Error: Guest name is required.');
    });

    it('throws error when code is empty string', async () => {
      await expect(
        (service as any).validate({ guestName: 'Alice Smith', code: '' })
      ).rejects.toThrow('Validation Error: Code cannot be empty.');
    });
  });

  describe('preSave', () => {
    it('trims and converts custom code to uppercase', async () => {
      mockPrismaClient.invitationCode.findUnique.mockResolvedValue(null);
      const data = { guestName: 'Alice', code: '  alice999  ' };
      const processed = await (service as any).preSave(data, mockPrismaClient);

      expect(processed.code).toBe('ALICE999');
      expect(mockPrismaClient.invitationCode.findUnique).toHaveBeenCalledWith({
        where: { code: 'ALICE999' },
      });
    });

    it('generates a random 8-character uppercase alphanumeric code if code is not provided', async () => {
      mockPrismaClient.invitationCode.findUnique.mockResolvedValue(null);
      const data = { guestName: 'Bob' };
      const processed = await (service as any).preSave(data, mockPrismaClient);

      expect(processed.code).toHaveLength(8);
      expect(processed.code).toMatch(/^[A-Z0-9]{8}$/);
      expect(mockPrismaClient.invitationCode.findUnique).toHaveBeenCalledWith({
        where: { code: processed.code },
      });
    });

    it('retries up to 10 times if generated random code collides with an existing one', async () => {
      // First 2 calls return an existing invitation code record, 3rd returns null (unique)
      mockPrismaClient.invitationCode.findUnique
        .mockResolvedValueOnce({ id: 'collided-1', code: 'ABC' })
        .mockResolvedValueOnce({ id: 'collided-2', code: 'DEF' })
        .mockResolvedValue(null);

      const data = { guestName: 'Bob' };
      const processed = await (service as any).preSave(data, mockPrismaClient);

      expect(processed.code).toHaveLength(8);
      expect(mockPrismaClient.invitationCode.findUnique).toHaveBeenCalledTimes(3);
    });

    it('throws error if random code generation fails after 10 attempts', async () => {
      // Always return an existing record to simulate collision 10 times
      mockPrismaClient.invitationCode.findUnique.mockResolvedValue({ id: 'always-collided' });

      const data = { guestName: 'Bob' };
      await expect(
        (service as any).preSave(data, mockPrismaClient)
      ).rejects.toThrow('Failed to generate a unique invitation code.');
    });
  });
});
