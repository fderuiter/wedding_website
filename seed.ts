import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
async function main() {
    await prisma.appConfig.upsert({
        where: { id: 'global' },
        update: {
            brideName: 'Abbigayle',
            groomName: 'Frederick',
            weddingDate: new Date('2026-06-20T16:00:00.000Z'),
            baseUrl: 'https://abbifred.com',
            venueName: 'Plummer House',
            venueAddress: '1091 Plummer Ln SW',
            venueCity: 'Rochester',
            venueState: 'MN',
            venueZip: '55902',
            latitude: 44.0079,
            longitude: -92.4938,
            venueDescription: 'Join Abbigayle and Frederick for their wedding celebration at the historic Plummer House in Rochester, MN.',
            seoDescription: 'Join Abbigayle and Frederick for their wedding celebration at the historic Plummer House in Rochester, MN. Find all the details about the ceremony, reception, registry, and our story.',
        },
        create: {
            id: 'global',
            brideName: 'Abbigayle',
            groomName: 'Frederick',
            weddingDate: new Date('2026-06-20T16:00:00.000Z'),
            baseUrl: 'https://abbifred.com',
            venueName: 'Plummer House',
            venueAddress: '1091 Plummer Ln SW',
            venueCity: 'Rochester',
            venueState: 'MN',
            venueZip: '55902',
            latitude: 44.0079,
            longitude: -92.4938,
            venueDescription: 'Join Abbigayle and Frederick for their wedding celebration at the historic Plummer House in Rochester, MN.',
            seoDescription: 'Join Abbigayle and Frederick for their wedding celebration at the historic Plummer House in Rochester, MN. Find all the details about the ceremony, reception, registry, and our story.',
        }
    });

    const media = await prisma.media.create({
        data: {
            url: "https://example.com/image.jpg",
            altText: "A default image",
        }
    });

    await prisma.registryItem.create({
        data: {
            name: "Test Gift",
            description: "A test gift",
            category: "Kitchen",
            price: 100.0,
            imageId: media.id,
            quantity: 1,
            isGroupGift: true
        }
    });
}
main().catch(console.error).finally(() => prisma.$disconnect());
