/** @jest-environment node */

import { RegistryItemAdminService } from '../admin.service';

describe('RegistryItemAdminService Input Validation', () => {
  let adminService: RegistryItemAdminService;

  beforeEach(() => {
    adminService = new RegistryItemAdminService();
  });

  it('validates valid registry item input payloads', async () => {
    const validData = {
      name: 'Coffee Maker',
      price: 99.99,
      category: 'Kitchen',
    };
    await expect(adminService['validate'](validData)).resolves.not.toThrow();
  });

  it('rejects invalid registry item input payloads and throws clear validation error', async () => {
    const invalidData = {
      name: '',
      price: -10,
    };
    await expect(adminService['validate'](invalidData)).rejects.toThrow(/Validation Error/);
  });
});
