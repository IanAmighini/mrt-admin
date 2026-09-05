-- "Sin etiqueta" pasa a ser una marca por tipo de aceite, y desaparece el aceite inventado.
--
-- "Sin etiqueta" no es una marca: es producto terminado sin etiquetar. Puede salir en cualquier
-- envase y cualquier formato de pallet, siempre en caja lisa, y con cualquiera de los tres aceites
-- que se envasan de verdad — girasol, alto oleico y mezcla. El catálogo tenía en cambio una sola
-- marca "Sin etiqueta — Sin especificar" y un insumo "Aceite Sin especificar" que no existe: nunca
-- se compró ni se movió, era un placeholder.
--
-- La columna `usaEtiqueta` es lo que hace que esto funcione sin casos especiales por nombre. El
-- generador de recetas necesita distinguir "esta marca no lleva etiqueta" de "falta cargar la
-- etiqueta de esta marca", que es un error real (pasó con El Favorito 4000). Un booleano en Marca
-- lo dice explícitamente en vez de adivinarlo comparando contra el string "Sin etiqueta".
--
-- El producto de 3600 se conserva por decisión del usuario aunque ya no se produzca, con Aceite
-- Girasol como el que se usaría si volviera. Se le regenera el slug porque no tiene historial:
-- 0 producciones, 0 remitos, 0 pedidos y 0 precios.

-- ---------------------------------------------------------------------------
-- 1. Columna nueva
-- ---------------------------------------------------------------------------

ALTER TABLE "Marca" ADD COLUMN "usaEtiqueta" BOOLEAN NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------------
-- 2. Las tres marcas reales de Sin etiqueta
-- ---------------------------------------------------------------------------

-- La que ya existe se reusa para Girasol, así el producto de 3600 le sigue correspondiendo.
UPDATE "Marca"
SET "oilType" = 'Girasol', "usaEtiqueta" = false
WHERE "name" = 'Sin etiqueta' AND "oilType" = 'Sin especificar';

INSERT INTO "Marca" ("id", "name", "oilType", "usaEtiqueta", "createdAt") VALUES
  ('mrc_sin_etiqueta_alto_oleico', 'Sin etiqueta', 'Alto Oleico', false, NOW()),
  ('mrc_sin_etiqueta_mezcla',      'Sin etiqueta', 'Mezcla',      false, NOW());

-- ---------------------------------------------------------------------------
-- 3. El producto de 3600 pasa a ser de Girasol
-- ---------------------------------------------------------------------------

UPDATE "Product"
SET "oilType" = 'Girasol', "slug" = 'sin-etiqueta-girasol-72x4x3600'
WHERE "name" = 'Sin etiqueta' AND "oilType" = 'Sin especificar' AND "presentation" = '72x4x3600';

-- Su línea de aceite apunta al insumo que se borra abajo. No hace falta guarda contra el
-- @@unique(productId, itemId): ningún producto de Sin etiqueta tiene ya Aceite Girasol.
UPDATE "RecipeItem"
SET "itemId" = 'seed-aceite-girasol'
WHERE "itemId" = (SELECT "id" FROM "Item" WHERE "slug" = 'aceite-sin-especificar');

-- ---------------------------------------------------------------------------
-- 4. Fuera el aceite que no existe
-- ---------------------------------------------------------------------------

-- Sin guarda a propósito: si algo quedó apuntándolo, la FK Restrict de RecipeItem / ItemMovement /
-- PurchaseLine hace fallar el DELETE y revierte toda la migración, que es lo que se quiere.
DELETE FROM "Item" WHERE "slug" = 'aceite-sin-especificar';
