import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    await prisma.registryItem.create({
        data: {
            name: "Test Gift",
            description: "A test gift",
            category: "Kitchen",
            price: 100.0,
            image: "",
            quantity: 1,
            isGroupGift: true
        }
    });
}
main().catch(console.error).finally(() => prisma.$disconnect());
