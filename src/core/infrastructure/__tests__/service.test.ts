/** @jest-environment node */

import { BaseService } from '../service';
import { createAuditSnapshot } from '@/lib/audit';

jest.mock('@/lib/audit', () => ({
  createAuditSnapshot: jest.fn(),
}));

class TestEntityService extends BaseService<{ id: string; name: string }> {
  protected defaultQueryArgs = {
    include: { relation: true },
    orderBy: { createdAt: 'desc' },
  };

  public validateMock = jest.fn();
  public preSaveMock = jest.fn();

  protected async validate(data: any, client?: any): Promise<void> {
    await this.validateMock(data, client);
  }

  protected async preSave(data: any, client?: any, author?: string): Promise<any> {
    return this.preSaveMock(data, client, author);
  }
}

describe('BaseService Enhancements', () => {
  let mockRepo: any;
  let service: TestEntityService;

  beforeEach(() => {
    mockRepo = {
      findMany: jest.fn(),
      transaction: jest.fn(async (cb) => {
        const txRepo = {
          client: 'mock-tx-client',
          create: jest.fn(async (data) => ({ id: 'new-id', ...data })),
          update: jest.fn(async (id, data) => ({ id, ...data })),
        };
        return cb(txRepo);
      }),
    };

    service = new TestEntityService(mockRepo as any, 'TestEntity');
    jest.clearAllMocks();
  });

  describe('findMany merging logic', () => {
    it('should use defaultQueryArgs if no args are passed', async () => {
      mockRepo.findMany.mockResolvedValue([]);
      await service.findMany();
      expect(mockRepo.findMany).toHaveBeenCalledWith({
        include: { relation: true },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should correctly merge user-supplied include and orderBy parameters', async () => {
      mockRepo.findMany.mockResolvedValue([]);
      await service.findMany({
        include: { anotherRelation: true },
        orderBy: { updatedAt: 'asc' },
      });
      expect(mockRepo.findMany).toHaveBeenCalledWith({
        include: { relation: true, anotherRelation: true },
        orderBy: [{ updatedAt: 'asc' }, { createdAt: 'desc' }],
      });
    });

    it('should override default options with user-supplied ones if keys collide', async () => {
      mockRepo.findMany.mockResolvedValue([]);
      await service.findMany({
        orderBy: { createdAt: 'asc' },
      });
      expect(mockRepo.findMany).toHaveBeenCalledWith({
        include: { relation: true },
        orderBy: { createdAt: 'asc' },
      });
    });
  });

  describe('validate and preSave hooks inside transactions', () => {
    it('should call validate and preSave with the transaction client and save successfully', async () => {
      service.preSaveMock.mockImplementation(async (data) => ({ ...data, processed: true }));

      const data = { name: 'Test Object' };
      const result = await service.create(data, 'TestAuthor');

      expect(service.validateMock).toHaveBeenCalledWith(data, 'mock-tx-client');
      expect(service.preSaveMock).toHaveBeenCalledWith(data, 'mock-tx-client', 'TestAuthor');
      expect(result).toEqual({ id: 'new-id', name: 'Test Object', processed: true });
      expect(createAuditSnapshot).toHaveBeenCalledWith(
        'TestEntity',
        'new-id',
        { id: 'new-id', name: 'Test Object', processed: true },
        'TestAuthor',
        'mock-tx-client'
      );
    });

    it('should prevent mutation and roll back if validate throws an error', async () => {
      service.validateMock.mockRejectedValue(new Error('Validation Failed'));

      await expect(service.create({ name: 'Invalid' })).rejects.toThrow('Validation Failed');
      expect(service.preSaveMock).not.toHaveBeenCalled();
      expect(createAuditSnapshot).not.toHaveBeenCalled();
    });

    it('should prevent mutation and roll back if preSave throws an error', async () => {
      service.preSaveMock.mockRejectedValue(new Error('PreSave Error'));

      await expect(service.create({ name: 'Valid' })).rejects.toThrow('PreSave Error');
      expect(createAuditSnapshot).not.toHaveBeenCalled();
    });
  });

  describe('reorder', () => {
    it('should dispatch txRepo.update calls concurrently inside a transaction', async () => {
      let txRepoUpdateMock: jest.Mock;

      mockRepo.transaction.mockImplementationOnce(async (cb: any) => {
        txRepoUpdateMock = jest.fn().mockImplementation((id, data) => Promise.resolve({ id, ...data }));
        const txRepo = {
          client: 'mock-tx-client',
          update: txRepoUpdateMock,
        };
        return cb(txRepo);
      });

      const orderedIds = ['id-1', 'id-2', 'id-3'];
      await service.reorder(orderedIds);

      expect(mockRepo.transaction).toHaveBeenCalledTimes(1);
      expect(txRepoUpdateMock!).toHaveBeenCalledTimes(3);
      expect(txRepoUpdateMock!).toHaveBeenNthCalledWith(1, 'id-1', { order: 0 });
      expect(txRepoUpdateMock!).toHaveBeenNthCalledWith(2, 'id-2', { order: 1 });
      expect(txRepoUpdateMock!).toHaveBeenNthCalledWith(3, 'id-3', { order: 2 });
    });

    it('should reject and roll back atomically if any concurrent update fails', async () => {
      mockRepo.transaction.mockImplementationOnce(async (cb: any) => {
        const txRepo = {
          client: 'mock-tx-client',
          update: jest.fn().mockImplementation(async (id: string) => {
            if (id === 'invalid-id') {
              throw new Error('Entity not found');
            }
            return { id };
          }),
        };
        return cb(txRepo);
      });

      const orderedIds = ['id-1', 'invalid-id', 'id-3'];
      await expect(service.reorder(orderedIds)).rejects.toThrow('Entity not found');
    });

    it('should complete successfully for empty orderedIds list', async () => {
      let txRepoUpdateMock: jest.Mock;

      mockRepo.transaction.mockImplementationOnce(async (cb: any) => {
        txRepoUpdateMock = jest.fn();
        const txRepo = {
          client: 'mock-tx-client',
          update: txRepoUpdateMock,
        };
        return cb(txRepo);
      });

      await service.reorder([]);

      expect(mockRepo.transaction).toHaveBeenCalledTimes(1);
      expect(txRepoUpdateMock!).not.toHaveBeenCalled();
    });
  });
});
