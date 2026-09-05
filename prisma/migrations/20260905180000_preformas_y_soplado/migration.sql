-- Cuenta del proveedor que fía la preforma PET y cobra sólo el soplado.
--
-- Ese proveedor no vende envases: pone la preforma y cobra el trabajo de soplarla. Eso parte la
-- relación en dos cuentas. La de pesos es la cuenta corriente que ya existe, con dos datos nuevos
-- por línea: el precio pactado en U$S y la cotización con la que se pasó a pesos. La otra es una
-- cuenta en unidades — cada envase soplado consume una preforma que puso él, así que se le deben
-- preformas hasta que se le entregan.
--
-- Esa deuda no se lleva a mano: sale de restar las entregas a las unidades recibidas, que ya quedan
-- registradas al cargar el remito. Una cuenta paralela cargada aparte se desincronizaría el primer
-- día que alguien cargue un remito y se olvide de la otra.
--
-- Las preformas agrupan formatos: 850 y 900 usan la misma, igual que 4000 y 5000. Por eso la deuda
-- es por tipo de preforma y no por formato de envase.

-- AlterTable
ALTER TABLE "Entity" ADD COLUMN     "llevaCuentaPreformas" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "precioSopladoUsd" DECIMAL(14,6),
ADD COLUMN     "preformaId" TEXT,
ADD COLUMN     "unitsPerPallet" INTEGER;

-- AlterTable
ALTER TABLE "PurchaseLine" ADD COLUMN     "unitPriceUsd" DECIMAL(14,6),
ALTER COLUMN "unitPrice" SET DATA TYPE DECIMAL(14,4);

-- CreateTable
CREATE TABLE "Preforma" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Preforma_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntregaPreforma" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "preformaId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "comprobante" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntregaPreforma_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Preforma_name_key" ON "Preforma"("name");

-- CreateIndex
CREATE INDEX "EntregaPreforma_entityId_idx" ON "EntregaPreforma"("entityId");

-- CreateIndex
CREATE INDEX "EntregaPreforma_preformaId_idx" ON "EntregaPreforma"("preformaId");

-- CreateIndex
CREATE INDEX "Item_preformaId_idx" ON "Item"("preformaId");

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_preformaId_fkey" FOREIGN KEY ("preformaId") REFERENCES "Preforma"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntregaPreforma" ADD CONSTRAINT "EntregaPreforma_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntregaPreforma" ADD CONSTRAINT "EntregaPreforma_preformaId_fkey" FOREIGN KEY ("preformaId") REFERENCES "Preforma"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntregaPreforma" ADD CONSTRAINT "EntregaPreforma_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Los tres tipos de preforma, y a cuál corresponde cada envase
-- ---------------------------------------------------------------------------

INSERT INTO "Preforma" ("id", "name", "createdAt") VALUES
  ('prf_850_900',  '850/900',   NOW()),
  ('prf_1500',     '1500',      NOW()),
  ('prf_4000_5000','4000/5000', NOW());

-- Unidades por pallet: son las del pallet descartable con el que llegan, y se usan sólo para
-- convertir al cargar el remito. Ese pallet no es el normalizado de las recetas y no entra a stock.
--
-- El precio de soplado es el vigente, en U$S por unidad. Las tapas quedan sin precio a propósito:
-- el suyo cambia seguido y lo fija el primer remito que se cargue.
UPDATE "Item" SET "preformaId" = 'prf_850_900',   "unitsPerPallet" = 1944, "precioSopladoUsd" = 0.0425 WHERE "slug" = 'envase-850ml';
UPDATE "Item" SET "preformaId" = 'prf_850_900',   "unitsPerPallet" = 1764, "precioSopladoUsd" = 0.0425 WHERE "slug" = 'envase-900ml';
UPDATE "Item" SET "preformaId" = 'prf_1500',      "unitsPerPallet" = 1120, "precioSopladoUsd" = 0.0512 WHERE "slug" = 'envase-1500ml';
UPDATE "Item" SET "preformaId" = 'prf_4000_5000', "unitsPerPallet" = 384,  "precioSopladoUsd" = 0.1483 WHERE "slug" = 'envase-4000ml';
UPDATE "Item" SET "preformaId" = 'prf_4000_5000', "unitsPerPallet" = 336,  "precioSopladoUsd" = 0.1483 WHERE "slug" = 'envase-5000ml';

-- El 3600 queda sin preforma a propósito: está discontinuado y no está en el cuadro de pallets del
-- proveedor. Si vuelve, hay que asignarle tipo antes de poder comprarlo — la carga del remito lo
-- exige en vez de dejarlo pasar sin contar para la deuda.
