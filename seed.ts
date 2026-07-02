import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
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
