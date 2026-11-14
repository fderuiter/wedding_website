import { BaseService } from '@/core/infrastructure/service';
import { BaseRepository } from '@/core/infrastructure/repository';
import { ContentNodeSchema } from './schemas';
import { z } from 'zod';

const ContentNodeInputSchema = z.union(
  ContentNodeSchema.options.map((opt) =>
    (opt as any).omit({ id: true, createdAt: true, updatedAt: true })
  ) as [any, any, ...any[]]
);

export class ContentNodeAdminService extends BaseService<any> {
  static ENTITY_KEY = 'content-nodes';
    
  constructor() {
    super(new BaseRepository('contentNode'), 'ContentNode', ContentNodeInputSchema);
  }
}
