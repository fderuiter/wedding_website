import { SubEventAdminService } from '../admin.service';

describe('SubEventAdminService', () => {
  let service: SubEventAdminService;
  let mockPrismaClient: any;

  beforeEach(() => {
    mockPrismaClient = {
      subEvent: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      snapshotVersion: {
        create: jest.fn().mockResolvedValue({ id: 'snap-1' }),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    mockPrismaClient.$transaction = jest.fn((cb: any) => cb(mockPrismaClient));

    service = new SubEventAdminService();
    service.repo.client = mockPrismaClient;
  });

  describe('create', () => {
    it('creates a sub-event with parsed startTime and endTime Date objects', async () => {
      mockPrismaClient.subEvent.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'se-1', ...data })
      );

      const created = await service.create({
        title: '  Rehearsal Dinner  ',
        startTime: '2026-09-18T18:00:00.000Z',
        endTime: '2026-09-18T21:00:00.000Z',
        locationName: 'Sunset Bistro',
        isPrivate: true,
      });

      expect(created.title).toBe('Rehearsal Dinner');
      expect(mockPrismaClient.subEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: 'Rehearsal Dinner',
          startTime: new Date('2026-09-18T18:00:00.000Z'),
          endTime: new Date('2026-09-18T21:00:00.000Z'),
          locationName: 'Sunset Bistro',
          isPrivate: true,
        }),
      });
    });

    it('coerces empty or null startTime and endTime to null', async () => {
      mockPrismaClient.subEvent.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'se-2', ...data })
      );

      await service.create({
        title: 'Welcome Drinks',
        startTime: '',
        endTime: null,
        isPrivate: false,
      });

      expect(mockPrismaClient.subEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: 'Welcome Drinks',
          startTime: null,
          endTime: null,
        }),
      });
    });

    it('rejects when title is empty', async () => {
      await expect(
        service.create({ title: '   ', isPrivate: true })
      ).rejects.toThrow('Validation Error: Title is required.');
    });

    it('rejects when endTime precedes startTime', async () => {
      await expect(
        service.create({
          title: 'Rehearsal Dinner',
          startTime: '2026-09-18T20:00:00.000Z',
          endTime: '2026-09-18T18:00:00.000Z',
          isPrivate: true,
        })
      ).rejects.toThrow('Validation Error: End time cannot precede start time.');

      expect(mockPrismaClient.subEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('updates schedule fields and allows clearing times to null', async () => {
      mockPrismaClient.subEvent.update.mockImplementation(({ where, data }: any) =>
        Promise.resolve({ id: where.id, ...data })
      );

      const updated = await service.update('se-1', {
        title: 'Updated Dinner',
        startTime: '2026-09-18T19:00:00.000Z',
        endTime: null,
      });

      expect(updated.title).toBe('Updated Dinner');
      expect(mockPrismaClient.subEvent.update).toHaveBeenCalledWith({
        where: { id: 'se-1' },
        data: {
          title: 'Updated Dinner',
          startTime: new Date('2026-09-18T19:00:00.000Z'),
          endTime: null,
        },
      });
    });

    it('rejects update when endTime precedes startTime in payload', async () => {
      await expect(
        service.update('se-1', {
          title: 'Updated Dinner',
          startTime: '2026-09-18T21:00:00.000Z',
          endTime: '2026-09-18T19:00:00.000Z',
        })
      ).rejects.toThrow('Validation Error: End time cannot precede start time.');

      expect(mockPrismaClient.subEvent.update).not.toHaveBeenCalled();
    });

    it('rejects partial update when endTime precedes existing startTime', async () => {
      mockPrismaClient.subEvent.findUnique.mockResolvedValue({
        id: 'se-1',
        title: 'Rehearsal Dinner',
        startTime: new Date('2026-09-18T19:00:00.000Z'),
        endTime: null,
        isPrivate: true,
      });

      await expect(
        service.update('se-1', {
          endTime: '2026-09-18T17:30:00.000Z',
        })
      ).rejects.toThrow('Validation Error: End time cannot precede start time.');

      expect(mockPrismaClient.subEvent.update).not.toHaveBeenCalled();
    });
  });

  describe('mealOptions and customQuestions JSONB validation', () => {
    it('validates, trims, and persists structured mealOptions and customQuestions', async () => {
      mockPrismaClient.subEvent.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'se-meals', ...data })
      );

      const created = await service.create({
        title: 'Evening Reception',
        isPrivate: false,
        mealOptions: [
          {
            id: 'meal-salmon',
            label: '  Herb-Crusted Salmon  ',
            description: '  Lemon dill butter  ',
            dietaryTags: ['Gluten-Free', 'gluten-free', 'dairy-free'],
          },
        ],
        customQuestions: [
          {
            id: 'q-shuttle',
            prompt: '  Will you take the hotel shuttle?  ',
            type: 'choice',
            required: true,
            options: ['  Yes, round-trip  ', 'No, driving'],
          },
          {
            id: 'q-song',
            prompt: 'Song request',
            type: 'text',
            required: false,
            options: ['ignored for text'],
          },
        ],
      } as any);

      expect(created.mealOptions).toEqual([
        {
          id: 'meal-salmon',
          label: 'Herb-Crusted Salmon',
          description: 'Lemon dill butter',
          dietaryTags: ['gluten-free', 'dairy-free'],
        },
      ]);
      expect(created.customQuestions).toEqual([
        {
          id: 'q-shuttle',
          prompt: 'Will you take the hotel shuttle?',
          type: 'choice',
          required: true,
          options: ['Yes, round-trip', 'No, driving'],
        },
        {
          id: 'q-song',
          prompt: 'Song request',
          type: 'text',
          required: false,
          options: [],
        },
      ]);
    });

    it('rejects duplicate meal option IDs', async () => {
      await expect(
        service.create({
          title: 'Evening Reception',
          mealOptions: [
            { id: 'dup-id', label: 'Beef', dietaryTags: [] },
            { id: 'dup-id', label: 'Chicken', dietaryTags: [] },
          ],
        } as any)
      ).rejects.toThrow(/Duplicate meal option ID/i);
    });

    it('rejects multiple-choice questions with zero options', async () => {
      await expect(
        service.create({
          title: 'Evening Reception',
          customQuestions: [
            {
              id: 'q-invalid',
              prompt: 'Pick a shuttle time',
              type: 'choice',
              required: true,
              options: [],
            },
          ],
        } as any)
      ).rejects.toThrow(/at least one option/i);
    });

    it('rejects meal options with empty labels', async () => {
      await expect(
        service.update('se-1', {
          mealOptions: [{ id: 'm-1', label: '   ', dietaryTags: [] }],
        } as any)
      ).rejects.toThrow(/Meal option label is required/i);
    });
  });
});
