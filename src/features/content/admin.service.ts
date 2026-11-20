import { BaseService } from '@/core/infrastructure/service';
import { BaseRepository } from '@/core/infrastructure/repository';
import { ContentNodeInputSchema } from './schemas';

export class ContentNodeAdminService extends BaseService<any> {
  static ENTITY_KEY = 'content-nodes';
    
  constructor() {
    super(new BaseRepository('contentNode'), 'ContentNode', ContentNodeInputSchema);
  }
}
