/** @jest-environment node */

import { BaseService } from '../service';
import { createAuditSnapshot, createBatchAuditSnapshots } from '@/lib/audit';
import { z } from 'zod';

jest.mock('@/lib/audit', () => ({
  createAuditSnapshot: jest.fn(),
  createBatchAuditSnapshots: jest.fn(),
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
          findMany: jest.fn(async (args) => {
            const ids = args?.where?.id?.in || [];
            return ids.map((id: string) => ({ id, name: `Record ${id}` }));
          }),
          updateManyAndReturn: jest.fn(async ({ where, data }) => {
            const ids = where?.id?.in || [];
            return ids.map((id: string) => ({ id, ...data }));
          }),
          deleteMany: jest.fn(async () => ({ count: 2 })),
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
        orderBy: { createdAt: 'desc', updatedAt: 'asc' },
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

  describe('updateBatch', () => {
    it('should throw validation error if ids array is empty', async () => {
      await expect(service.updateBatch([], { name: 'Batch' })).rejects.toThrow(
        'Validation Error: At least one ID is required.'
      );
    });

    it('should throw validation error if ids array exceeds 100 items', async () => {
      const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`);
      await expect(service.updateBatch(ids, { name: 'Batch' })).rejects.toThrow(
        'Validation Error: Maximum of 100 items allowed per batch request.'
      );
    });

    it('should update items using set-based query and create bulk audit snapshot', async () => {
      service.preSaveMock.mockImplementation(async (data) => ({ ...data, saved: true }));

      const ids = ['id-1', 'id-2'];
      const data = { name: 'Batch Updated' };

      const results = await service.updateBatch(ids, data, 'TestAuthor');

      expect(mockRepo.transaction).toHaveBeenCalledTimes(1);
      expect(service.validateMock).toHaveBeenCalledTimes(1);
      expect(service.validateMock).toHaveBeenCalledWith(data, 'mock-tx-client');
      expect(service.preSaveMock).toHaveBeenCalledTimes(1);
      expect(service.preSaveMock).toHaveBeenCalledWith(data, 'mock-tx-client', 'TestAuthor');

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({ id: 'id-1', name: 'Batch Updated', saved: true });
      expect(results[1]).toEqual({ id: 'id-2', name: 'Batch Updated', saved: true });

      expect(createAuditSnapshot).not.toHaveBeenCalled();
      expect(createBatchAuditSnapshots).toHaveBeenCalledTimes(1);
      expect(createBatchAuditSnapshots).toHaveBeenCalledWith(
        'TestEntity',
        results,
        'TestAuthor',
        'mock-tx-client'
      );
    });

    it('should roll back completely if batch update encounters a database failure', async () => {
      mockRepo.transaction.mockImplementationOnce(async (cb: any) => {
        const txRepo = {
          client: 'mock-tx-client',
          updateManyAndReturn: jest.fn().mockImplementation(async () => {
            throw new Error('Database constraint violation: duplicate unique index');
          }),
        };
        return cb(txRepo);
      });

      const ids = ['id-1', 'fail-id', 'id-3'];
      await expect(service.updateBatch(ids, { name: 'Will Fail' })).rejects.toThrow(
        'Database constraint violation: duplicate unique index'
      );
      expect(createBatchAuditSnapshots).not.toHaveBeenCalled();
    });
  });

  describe('deleteBatch', () => {
    it('should throw validation error if ids array is empty', async () => {
      await expect(service.deleteBatch([])).rejects.toThrow(
        'Validation Error: At least one ID is required.'
      );
    });

    it('should throw validation error if ids array exceeds 100 items', async () => {
      const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`);
      await expect(service.deleteBatch(ids)).rejects.toThrow(
        'Validation Error: Maximum of 100 items allowed per batch request.'
      );
    });

    it('should capture target records, delete them in bulk, and create bulk audit snapshots', async () => {
      const ids = ['id-1', 'id-2'];
      const results = await service.deleteBatch(ids, 'Admin');

      expect(mockRepo.transaction).toHaveBeenCalledTimes(1);
      expect(results).toEqual([
        { id: 'id-1', name: 'Record id-1' },
        { id: 'id-2', name: 'Record id-2' },
      ]);

      expect(createAuditSnapshot).not.toHaveBeenCalled();
      expect(createBatchAuditSnapshots).toHaveBeenCalledTimes(1);
      expect(createBatchAuditSnapshots).toHaveBeenCalledWith(
        'TestEntity',
        [
          { deleted: true, id: 'id-1', name: 'Record id-1' },
          { deleted: true, id: 'id-2', name: 'Record id-2' },
        ],
        'Admin',
        'mock-tx-client'
      );
    });

    it('should return empty array and skip bulk delete and audit snapshot if no target records exist', async () => {
      mockRepo.transaction.mockImplementationOnce(async (cb: any) => {
        const deleteManyMock = jest.fn();
        const txRepo = {
          client: 'mock-tx-client',
          findMany: jest.fn().mockResolvedValue([]),
          deleteMany: deleteManyMock,
        };
        const res = await cb(txRepo);
        expect(deleteManyMock).not.toHaveBeenCalled();
        return res;
      });

      const ids = ['non-existent-1', 'non-existent-2'];
      const results = await service.deleteBatch(ids, 'Admin');

      expect(results).toEqual([]);
      expect(createBatchAuditSnapshots).not.toHaveBeenCalled();
    });

    it('should roll back completely if bulk deletion encounters a database failure', async () => {
      mockRepo.transaction.mockImplementationOnce(async (cb: any) => {
        const txRepo = {
          client: 'mock-tx-client',
          findMany: jest.fn().mockResolvedValue([{ id: 'id-1' }]),
          deleteMany: jest.fn().mockRejectedValue(new Error('Foreign key constraint violation')),
        };
        return cb(txRepo);
      });

      const ids = ['id-1'];
      await expect(service.deleteBatch(ids, 'Admin')).rejects.toThrow(
        'Foreign key constraint violation'
      );
      expect(createBatchAuditSnapshots).not.toHaveBeenCalled();
    });
  });

  describe('schema validation in BaseService', () => {
    const TestSchema = z.object({
      name: z.string().min(1, 'Name is required'),
      age: z.number().int().positive('Age must be a positive integer'),
    });

    it('should validate and create successfully when input data satisfies schema', async () => {
      const serviceWithSchema = new BaseService<any>(mockRepo, 'TestEntity', TestSchema);
      const validData = { name: 'Alice', age: 30 };

      const result = await serviceWithSchema.create(validData);

      expect(result).toEqual({ id: 'new-id', name: 'Alice', age: 30 });
      expect(createAuditSnapshot).toHaveBeenCalledWith(
        'TestEntity',
        'new-id',
        { id: 'new-id', name: 'Alice', age: 30 },
        'Admin',
        'mock-tx-client'
      );
    });

    it('should validate and update successfully when input data satisfies schema', async () => {
      const serviceWithSchema = new BaseService<any>(mockRepo, 'TestEntity', TestSchema);
      const validData = { name: 'Alice', age: 31 };

      const result = await serviceWithSchema.update('entity-1', validData);

      expect(result).toEqual({ id: 'entity-1', name: 'Alice', age: 31 });
    });

    it('should reject create and throw formatted error with "Validation Error: " prefix on schema failure', async () => {
      const serviceWithSchema = new BaseService<any>(mockRepo, 'TestEntity', TestSchema);
      const invalidData = { name: '', age: -5 };

      await expect(serviceWithSchema.create(invalidData)).rejects.toThrow(
        /^Validation Error: name: Name is required, age: Age must be a positive integer/
      );
      expect(createAuditSnapshot).not.toHaveBeenCalled();
    });

    it('should reject update and throw formatted error with "Validation Error: " prefix on schema failure', async () => {
      const serviceWithSchema = new BaseService<any>(mockRepo, 'TestEntity', TestSchema);
      const invalidData = { name: 'Bob', age: 'invalid' };

      await expect(serviceWithSchema.update('entity-1', invalidData)).rejects.toThrow(
        /^Validation Error: age:/
      );
      expect(createAuditSnapshot).not.toHaveBeenCalled();
    });

    it('should operate as no-op when no schema is provided (backwards compatibility)', async () => {
      const serviceWithoutSchema = new BaseService<any>(mockRepo, 'TestEntity');
      const arbitraryData = { unvalidatedField: 'anything', nested: { foo: 123 } };

      const result = await serviceWithoutSchema.create(arbitraryData);

      expect(result).toEqual({ id: 'new-id', ...arbitraryData });
    });

    it('should allow subclasses to extend validate by calling super.validate(data, client)', async () => {
      class ExtendedService extends BaseService<any> {
        constructor() {
          super(mockRepo, 'ExtendedEntity', TestSchema);
        }

        protected async validate(data: any, client?: any): Promise<void> {
          await super.validate(data, client);
          if (data.name === 'Forbidden') {
            throw new Error('Custom Error: Forbidden name');
          }
        }
      }

      const extendedService = new ExtendedService();

      // Fails schema first
      await expect(extendedService.create({ name: '', age: 25 })).rejects.toThrow(
        /^Validation Error: name: Name is required/
      );

      // Passes schema, but fails custom logic
      await expect(extendedService.create({ name: 'Forbidden', age: 25 })).rejects.toThrow(
        'Custom Error: Forbidden name'
      );

      // Passes both
      const valid = await extendedService.create({ name: 'Allowed', age: 25 });
      expect(valid).toEqual({ id: 'new-id', name: 'Allowed', age: 25 });
    });
  });
});
