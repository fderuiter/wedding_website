import type { RegistryItem, IRegistryRepository } from '@/features/registry/types';
import { RegistryService } from '@/features/registry/service';

// Mock the repository interface
const mockRepository: jest.Mocked<IRegistryRepository> = {
  getAllItems: jest.fn(),
  getItemById: jest.fn(),
  createItem: jest.fn(),
  updateItem: jest.fn(),
  deleteItem: jest.fn(),
  contributeToItem: jest.fn(),
};

describe('RegistryService', () => {
  let registryService: RegistryService;

  beforeEach(() => {
    jest.clearAllMocks();
    registryService = new RegistryService(mockRepository);
  });

  describe('getAllItems', () => {
    it('returns all registry items', async () => {
      const items = [{ id: '1' } as RegistryItem];
      mockRepository.getAllItems.mockResolvedValue(items);

      await expect(registryService.getAllItems()).resolves.toEqual(items);
      expect(mockRepository.getAllItems).toHaveBeenCalled();
    });

    it('throws when repository fails', async () => {
      const error = new Error('DB error');
      mockRepository.getAllItems.mockRejectedValue(error);

      await expect(registryService.getAllItems()).rejects.toThrow(error);
    });
  });

  describe('getItemById', () => {
    it('returns a registry item by id', async () => {
      const item = { id: '1' } as RegistryItem;
      mockRepository.getItemById.mockResolvedValue(item);

      await expect(registryService.getItemById('1')).resolves.toEqual(item);
      expect(mockRepository.getItemById).toHaveBeenCalledWith('1');
    });

    it('throws when item lookup fails', async () => {
      const error = new Error('DB error');
      mockRepository.getItemById.mockRejectedValue(error);

      await expect(registryService.getItemById('1')).rejects.toThrow(error);
    });
  });

  describe('createItem', () => {
    it('creates a new registry item', async () => {
      const input = {
        title: 'Item',
        price: 100,
        link: '',
        description: '',
        image: '',
        amountContributed: 0,
      } as unknown as Omit<RegistryItem, 'id' | 'contributors'>;
      const created = { id: '1', ...input, contributors: [] } as unknown as RegistryItem;
      mockRepository.createItem.mockResolvedValue(created);

      await expect(registryService.createItem(input)).resolves.toEqual(created);
      expect(mockRepository.createItem).toHaveBeenCalledWith(input);
    });

    it('throws when creation fails', async () => {
      const error = new Error('DB error');
      mockRepository.createItem.mockRejectedValue(error);

      await expect(
        registryService.createItem({} as unknown as Omit<RegistryItem, 'id' | 'contributors'>)
      ).rejects.toThrow(error);
    });
  });

  describe('updateItem', () => {
    it('updates a registry item', async () => {
      const updated = { id: '1', title: 'New', contributors: [] } as unknown as RegistryItem;
      mockRepository.updateItem.mockResolvedValue(updated);

      await expect(
        registryService.updateItem('1', { title: 'New' } as Partial<RegistryItem>)
      ).resolves.toEqual(updated);
      expect(mockRepository.updateItem).toHaveBeenCalledWith('1', { title: 'New' });
    });

    it('throws when update fails', async () => {
      const error = new Error('DB error');
      mockRepository.updateItem.mockRejectedValue(error);

      await expect(registryService.updateItem('1', {})).rejects.toThrow(error);
    });
  });

  describe('deleteItem', () => {
    it('deletes a registry item', async () => {
      const deleted = { id: '1' } as RegistryItem;
      mockRepository.deleteItem.mockResolvedValue(deleted);

      await expect(registryService.deleteItem('1')).resolves.toEqual(deleted);
      expect(mockRepository.deleteItem).toHaveBeenCalledWith('1');
    });

    it('throws when delete fails', async () => {
      const error = new Error('DB error');
      mockRepository.deleteItem.mockRejectedValue(error);

      await expect(registryService.deleteItem('1')).rejects.toThrow(error);
    });
  });

  describe('contributeToItem', () => {
    it('adds a contribution to an item', async () => {
      const item = { id: '1', amountContributed: 0, price: 100, contributors: [] } as unknown as RegistryItem;
      const updated = {
        ...item,
        amountContributed: 50,
        contributors: [{ name: 'John', amount: 50, date: new Date() }],
        purchased: false,
      } as unknown as RegistryItem;

      mockRepository.getItemById.mockResolvedValue(item);
      mockRepository.contributeToItem.mockResolvedValue(updated);

      const result = await registryService.contributeToItem('1', { name: 'John', amount: 50 });
      expect(result).toEqual(updated);
      expect(mockRepository.getItemById).toHaveBeenCalledWith('1');
      expect(mockRepository.contributeToItem).toHaveBeenCalledWith('1', { name: 'John', amount: 50 });
    });

    it('throws when contribution amount is not positive', async () => {
      await expect(
        registryService.contributeToItem('1', { name: 'John', amount: 0 })
      ).rejects.toThrow('Contribution must be a positive number.');

      await expect(
        registryService.contributeToItem('1', { name: 'John', amount: -10 })
      ).rejects.toThrow('Contribution must be a positive number.');

      expect(mockRepository.getItemById).not.toHaveBeenCalled();
      expect(mockRepository.contributeToItem).not.toHaveBeenCalled();
    });

    it('throws when item not found', async () => {
      mockRepository.getItemById.mockResolvedValue(null);

      await expect(
        registryService.contributeToItem('1', { name: 'John', amount: 50 })
      ).rejects.toThrow('Item not found');
      expect(mockRepository.contributeToItem).not.toHaveBeenCalled();
    });

    it('throws when item has already been purchased', async () => {
      const item = {
        id: '1',
        amountContributed: 100,
        price: 100,
        contributors: [],
        purchased: true
      } as unknown as RegistryItem;

      mockRepository.getItemById.mockResolvedValue(item);

      await expect(
        registryService.contributeToItem('1', { name: 'John', amount: 50 })
      ).rejects.toThrow('This item has already been purchased.');
      expect(mockRepository.contributeToItem).not.toHaveBeenCalled();
    });

    it('propagates update failures', async () => {
      const item = {
        id: '1',
        amountContributed: 0,
        price: 100,
        contributors: []
      } as unknown as RegistryItem;
      const error = new Error('Update failed');

      mockRepository.getItemById.mockResolvedValue(item);
      mockRepository.contributeToItem.mockRejectedValue(error);

      await expect(
        registryService.contributeToItem('1', { name: 'John', amount: 50 })
      ).rejects.toThrow(error);
      expect(mockRepository.getItemById).toHaveBeenCalledTimes(1);
      expect(mockRepository.contributeToItem).toHaveBeenCalledTimes(1);
    });

    it('throws when contribution is greater than remaining amount', async () => {
      const item = {
        id: '1',
        amountContributed: 80,
        price: 100,
        contributors: []
      } as unknown as RegistryItem;

      mockRepository.getItemById.mockResolvedValue(item);

      await expect(
        registryService.contributeToItem('1', { name: 'John', amount: 50 })
      ).rejects.toThrow('Contribution cannot be greater than the remaining amount.');
      expect(mockRepository.contributeToItem).not.toHaveBeenCalled();
    });
  });
});
