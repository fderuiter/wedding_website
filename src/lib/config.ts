import { z } from 'zod';
import { prisma } from './prisma';

const FeatureSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string().optional(),
  visible: z.boolean(),
  content: z.string().optional(),
  href: z.string().optional(),
  icon: z.string().optional(),
  label: z.string().optional(),
});

const strictShape = {
  id: z.string(),
  brideName: z.string(),
  groomName: z.string(),
  weddingDate: z.coerce.date(),
  baseUrl: z.string(),
  venueName: z.string(),
  venueAddress: z.string(),
  venueCity: z.string(),
  venueState: z.string(),
  venueZip: z.string(),
  latitude: z.coerce.number(),
  longitude: z.coerce.number(),
  storyText: z.string(),
  venueDescription: z.string(),
  travelAdvice: z.string(),
  heroTitle: z.string(),
  heroSubtitle: z.string(),
  seoTitle: z.string(),
  seoDescription: z.string(),
  adminPassword: z.string(),
  features: z.preprocess((val) => {
    if (typeof val === 'string') {
      try { return JSON.parse(val); } catch { return val; }
    }
    return val;
  }, z.array(FeatureSchema)),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
};

const StrictConfigSchema = z.object(strictShape);

function isConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return code === 'P2002' || code === 'P2003' || code === 'P2011';
}

const ConfigSchema = z.object({
  id: strictShape.id.catch('global'),
  brideName: strictShape.brideName.catch('Abbigayle'),
  groomName: strictShape.groomName.catch('Frederick'),
  weddingDate: strictShape.weddingDate.catch(() => new Date('2025-10-10T00:00:00.000Z')),
  baseUrl: strictShape.baseUrl.catch('https://abbifred.com'),
  venueName: strictShape.venueName.catch('historic Plummer House'),
  venueAddress: strictShape.venueAddress.catch('123 Wedding St'),
  venueCity: strictShape.venueCity.catch('Rochester'),
  venueState: strictShape.venueState.catch('MN'),
  venueZip: strictShape.venueZip.catch('12345'),
  latitude: strictShape.latitude.catch(0.0),
  longitude: strictShape.longitude.catch(0.0),
  storyText: strictShape.storyText.catch('Our story began...'),
  venueDescription: strictShape.venueDescription.catch('A beautiful venue...'),
  travelAdvice: strictShape.travelAdvice.catch('Travel safely...'),
  heroTitle: strictShape.heroTitle.catch('We Tied the Knot!'),
  heroSubtitle: strictShape.heroSubtitle.catch('Thank you for celebrating with us!'),
  seoTitle: strictShape.seoTitle.catch("Abbigayle & Frederick's Wedding"),
  seoDescription: strictShape.seoDescription.catch('Join Abbigayle and Frederick for their wedding celebration at the historic Plummer House in Rochester, MN. Find all the details about the ceremony, reception, registry, and our story.'),
  adminPassword: strictShape.adminPassword.catch(''),
  features: strictShape.features.catch([
    { id: 'story', type: 'story', title: 'Our Story', visible: true },
    { id: 'details', type: 'details', title: 'Wedding Day Details', visible: true },
    { id: 'accommodations', type: 'accommodations', title: 'Accommodations', visible: true },
    { id: 'venue', type: 'venue', title: 'About Our Venue', visible: true },
    { id: 'travel', type: 'travel', title: 'Travel & Things to Do', visible: true },
    { id: 'faq', type: 'faq', title: 'Questions You Probably Have', visible: true }
  ]),
  createdAt: strictShape.createdAt.catch(() => new Date()),
  updatedAt: strictShape.updatedAt.catch(() => new Date()),
});

export async function getAppConfig() {
  let rawConfig;
  try {
    rawConfig = await prisma.appConfig.upsert({
      where: { id: 'global' },
      update: {},
      create: { id: 'global' },
    });
  } catch (error) {
    if (isConstraintError(error)) {
      console.error('❌ Failed to initialize app config due to database constraint error.');
      throw error;
    }
    console.warn("Database unreachable, using fallback config.");
    rawConfig = {}; // Schema will use default/catch values
  }

  const parsed = StrictConfigSchema.safeParse(rawConfig);
  if (!parsed.success) {
    console.error("❌ Config validation failed for some fields:");
    console.error(JSON.stringify(parsed.error.format(), null, 2));
    console.warn("⚠️ Falling back to safe defaults for invalid fields.");
  }

  return ConfigSchema.parse(rawConfig);
}
