-- AlterTable
ALTER TABLE "Entity" ADD COLUMN     "slug" TEXT;

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "slug" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "slug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Entity_slug_key" ON "Entity"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Item_slug_key" ON "Item"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug");

