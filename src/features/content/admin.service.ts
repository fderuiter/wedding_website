import { BaseService } from '@/core/infrastructure/service';
import { BaseRepository } from '@/core/infrastructure/repository';
import { ContentNodeSchema } from './schemas';
import { z } from 'zod';

const ContentNodeInputSchema = z.union([
  ContentNodeSchema.options[0].omit({ id: true, createdAt: true, updatedAt: true }),
  ContentNodeSchema.options[1].omit({ id: true, createdAt: true, updatedAt: true }),
  ContentNodeSchema.options[2].omit({ id: true, createdAt: true, updatedAt: true }),
]);

function validateContentNodeUpdate(data: any): string | null {
  const result = ContentNodeInputSchema.safeParse(data);
  if (!result.success) {
    return result.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
  }
  return null;
}

export class ContentNodeAdminService extends BaseService<any> {
  static ENTITY_KEY = 'content-nodes';
    
  constructor() {
    super(new BaseRepository('contentNode'), 'ContentNode');
  }

  async update(id: string, data: any, author?: string): Promise<any> {
    const error = validateContentNodeUpdate(data);
    if (error) throw new Error(`Validation Error: ${error}`);
    return super.update(id, data, author);
  }
}
export default ContentNodeAdminService;
