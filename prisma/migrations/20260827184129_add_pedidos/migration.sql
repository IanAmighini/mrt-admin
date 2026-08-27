-- CreateEnum
CREATE TYPE "PedidoStatus" AS ENUM ('EN_COLA', 'COMPLETADO', 'ENTREGADO');

-- CreateTable
CREATE TABLE "Pedido" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "entityId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "status" "PedidoStatus" NOT NULL DEFAULT 'EN_COLA',
    "deliveryDate" TIMESTAMP(3),
    "comments" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pedido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PedidoLine" (
    "id" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "pallets" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "PedidoLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Pedido_entityId_idx" ON "Pedido"("entityId");

-- CreateIndex
CREATE INDEX "PedidoLine_pedidoId_idx" ON "PedidoLine"("pedidoId");

-- AddForeignKey
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedidoLine" ADD CONSTRAINT "PedidoLine_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "Pedido"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedidoLine" ADD CONSTRAINT "PedidoLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
