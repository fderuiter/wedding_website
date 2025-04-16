-- CreateTable
CREATE TABLE "RegistryItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "image" TEXT NOT NULL,
    "vendorUrl" TEXT,
    "quantity" INTEGER NOT NULL,
    "isGroupGift" BOOLEAN NOT NULL DEFAULT false,
    "purchased" BOOLEAN NOT NULL DEFAULT false,
    "purchaserName" TEXT,
    "amountContributed" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Contributor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "date" DATETIME NOT NULL,
    "registryItemId" TEXT NOT NULL,
    CONSTRAINT "Contributor_registryItemId_fkey" FOREIGN KEY ("registryItemId") REFERENCES "RegistryItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
