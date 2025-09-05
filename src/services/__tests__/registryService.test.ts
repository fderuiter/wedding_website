import type { RegistryItem } from '@/types/registry';
import { RegistryRepository } from '@/repositories/registryRepository';
import { RegistryService } from '../registryService';

jest.mock('@/repositories/registryRepository');

const mockGetAllItems = RegistryRepository.getAllItems as jest.Mock;
const mockGetItemById = RegistryRepository.getItemById as jest.Mock;
const mockCreateItem = RegistryRepository.createItem as jest.Mock;
const mockUpdateItem = RegistryRepository.updateItem as jest.Mock;
const mockDeleteItem = RegistryRepository.deleteItem as jest.Mock;
const mockContributeToItem = RegistryRepository.contributeToItem as jest.Mock;

describe('RegistryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getAllItems', () => {
    it('returns all registry items', async () => {
      const items = [{ id: '1' } as RegistryItem];
      mockGetAllItems.mockResolvedValue(items);

      await expect(RegistryService.getAllItems()).resolves.toEqual(items);
      expect(mockGetAllItems).toHaveBeenCalled();
    });

    it('throws when repository fails', async () => {
      const error = new Error('DB error');
      mockGetAllItems.mockRejectedValue(error);

      await expect(RegistryService.getAllItems()).rejects.toThrow(error);
    });
  });

  describe('getItemById', () => {
    it('returns a registry item by id', async () => {
      const item = { id: '1' } as RegistryItem;
      mockGetItemById.mockResolvedValue(item);

      await expect(RegistryService.getItemById('1')).resolves.toEqual(item);
      expect(mockGetItemById).toHaveBeenCalledWith('1');
    });

    it('throws when item lookup fails', async () => {
      const error = new Error('DB error');
      mockGetItemById.mockRejectedValue(error);

      await expect(RegistryService.getItemById('1')).rejects.toThrow(error);
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
      mockCreateItem.mockResolvedValue(created);

      await expect(RegistryService.createItem(input)).resolves.toEqual(created);
      expect(mockCreateItem).toHaveBeenCalledWith(input);
    });

    it('throws when creation fails', async () => {
      const error = new Error('DB error');
      mockCreateItem.mockRejectedValue(error);

      await expect(
        RegistryService.createItem({} as unknown as Omit<RegistryItem, 'id' | 'contributors'>)
      ).rejects.toThrow(error);
    });
  });

  describe('updateItem', () => {
    it('updates a registry item', async () => {
      const updated = { id: '1', title: 'New', contributors: [] } as unknown as RegistryItem;
      mockUpdateItem.mockResolvedValue(updated);

      await expect(
        RegistryService.updateItem('1', { title: 'New' } as Partial<RegistryItem>)
      ).resolves.toEqual(updated);
      expect(mockUpdateItem).toHaveBeenCalledWith('1', { title: 'New' });
    });

    it('throws when update fails', async () => {
      const error = new Error('DB error');
      mockUpdateItem.mockRejectedValue(error);

      await expect(RegistryService.updateItem('1', {})).rejects.toThrow(error);
    });
  });

  describe('deleteItem', () => {
    it('deletes a registry item', async () => {
      const deleted = { id: '1' } as RegistryItem;
      mockDeleteItem.mockResolvedValue(deleted);

      await expect(RegistryService.deleteItem('1')).resolves.toEqual(deleted);
      expect(mockDeleteItem).toHaveBeenCalledWith('1');
    });

    it('throws when delete fails', async () => {
      const error = new Error('DB error');
      mockDeleteItem.mockRejectedValue(error);

      await expect(RegistryService.deleteItem('1')).rejects.toThrow(error);
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

      mockGetItemById.mockResolvedValue(item);
      mockContributeToItem.mockResolvedValue(updated);

      const result = await RegistryService.contributeToItem('1', { name: 'John', amount: 50 });
      expect(result).toEqual(updated);
      expect(mockGetItemById).toHaveBeenCalledWith('1');
      expect(mockContributeToItem).toHaveBeenCalledWith('1', { name: 'John', amount: 50 });
    });

    it('throws when item not found', async () => {
      mockGetItemById.mockResolvedValue(null);

      await expect(
        RegistryService.contributeToItem('1', { name: 'John', amount: 50 })
      ).rejects.toThrow('Item not found');
      expect(mockContributeToItem).not.toHaveBeenCalled();
    });

    it('propagates update failures', async () => {
      const item = {
        id: '1',
        amountContributed: 0,
        price: 100,
        contributors: []
      } as unknown as RegistryItem;
      const error = new Error('Update failed');

      mockGetItemById.mockResolvedValue(item);
      mockContributeToItem.mockRejectedValue(error);

      await expect(
        RegistryService.contributeToItem('1', { name: 'John', amount: 50 })
      ).rejects.toThrow(error);
      expect(mockGetItemById).toHaveBeenCalledTimes(1);
      expect(mockContributeToItem).toHaveBeenCalledTimes(1);
    });

    it('throws when contribution is greater than remaining amount', async () => {
      const item = {
        id: '1',
        amountContributed: 80,
        price: 100,
        contributors: []
      } as unknown as RegistryItem;

      mockGetItemById.mockResolvedValue(item);

      await expect(
        RegistryService.contributeToItem('1', { name: 'John', amount: 50 })
      ).rejects.toThrow('Contribution cannot be greater than the remaining amount.');
      expect(mockContributeToItem).not.toHaveBeenCalled();
    });
  });
});

