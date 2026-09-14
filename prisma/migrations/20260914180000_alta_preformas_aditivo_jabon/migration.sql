-- Los insumos de las categorías nuevas. Van en una migración aparte de la que crea las categorías
-- porque PostgreSQL no deja usar un valor de enum recién agregado en la misma transacción.
--
-- Ninguno lleva stock: se compran y no se cuentan, igual que el pegamento y el stretch. La compra
-- le carga el gasto a la cuenta del proveedor y aparece en el reporte de compras con su cantidad,
-- pero no genera un stock que sólo subiría —ninguna receta los consume—.
--
-- Las preformas además ya tienen su propio seguimiento: se compran a un tercero, van derecho a
-- Teoplast y lo que se le debe sale de la cuenta en unidades de su ficha, no del stock. Van tres,
-- uno por tipo, con los mismos nombres que el modelo Preforma, para poder ver cuántas se compraron
-- de cada una.

INSERT INTO "Item" ("id", "slug", "name", "unit", "category", "llevaStock", "createdAt", "updatedAt") VALUES
  ('itm_preforma_850_900',  'preforma-850-900',  'Preforma 850/900',   'unidad', 'PREFORMAS',     false, NOW(), NOW()),
  ('itm_preforma_1500',     'preforma-1500',     'Preforma 1500',      'unidad', 'PREFORMAS',     false, NOW(), NOW()),
  ('itm_preforma_4000_5000','preforma-4000-5000','Preforma 4000/5000', 'unidad', 'PREFORMAS',     false, NOW(), NOW()),
  ('itm_aditivo_tinta',     'aditivo-tinta',     'Aditivo / Tinta',    'L',      'ADITIVO_TINTA', false, NOW(), NOW()),
  ('itm_jabon',             'jabon',             'Jabón',              'L',      'JABON',         false, NOW(), NOW());
