-- Los tres insumos nuevos. Van en una migración aparte de la que crea las categorías porque
-- PostgreSQL no deja usar un valor de enum recién agregado en la misma transacción.
--
-- Pegamento y stretch no llevan stock: se compran y no se cuentan.
--
-- El pallet descartable sí. Es el pallet en el que llegan los insumos comprados: entra gratis con
-- la compra (línea a precio 0) y después se le vende al proveedor de pallets normalizados desde la
-- ficha del insumo.

INSERT INTO "Item" ("id", "slug", "name", "unit", "category", "llevaStock", "createdAt", "updatedAt") VALUES
  ('itm_pegamento',          'pegamento',          'Pegamento',          'kg',     'PEGAMENTO',          false, NOW(), NOW()),
  ('itm_stretch',            'stretch',            'Stretch',            'rollo',  'STRETCH',            false, NOW(), NOW()),
  ('itm_pallet_descartable', 'pallet-descartable', 'Pallet descartable', 'unidad', 'PALLET_DESCARTABLE', true,  NOW(), NOW());
