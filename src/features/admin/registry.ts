import fs from 'fs';
import path from 'path';

let serviceMap: Record<string, any> | null = null;

export async function getEntityService(entityKey: string) {
  if (!serviceMap) {
    serviceMap = {};
    const featuresDir = path.join(process.cwd(), 'src/features');
    if (fs.existsSync(featuresDir)) {
      const features = fs.readdirSync(featuresDir);
      for (const feature of features) {
        const servicePath = path.join(featuresDir, feature, 'admin.service.ts');
        if (fs.existsSync(servicePath)) {
          const imported = await import(`../../features/${feature}/admin.service`);
          const ServiceClass = imported.default || Object.values(imported)[0];
          if (ServiceClass && ServiceClass.ENTITY_KEY) {
            serviceMap[ServiceClass.ENTITY_KEY] = new (ServiceClass as any)();
          }
        }
      }
    }
  }

  const service = serviceMap[entityKey];
  if (!service) return null;

  return { service };
}
