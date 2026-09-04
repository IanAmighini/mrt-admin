-- Reestructuración del catálogo de tapas y cajas.
--
-- El catálogo se había armado suponiendo que las tapas van por mililitro y que las cajas se abren
-- por marca + tipo de aceite + mililitro. Ninguna de las dos cosas es cierta:
--
--   * Las tapas van por boca. Las tres de 29mm (Priva Amarilla, Priva Negra, Omega Negra) sirven
--     para 850, 900 y 1500 y se usan indistintamente; la 48-41 baja va en 3600, 4000 y 5000.
--   * Las cajas son marca + unidades por caja x mililitro, sin distinguir aceite, y una misma caja
--     sirve dos tamaños (la de 900 también se usa para envases de 850).
--
-- Se puede borrar los insumos viejos en vez de archivarlos porque no tienen historial: al momento
-- de escribir esto hay 0 compras, 0 producciones y los únicos 2 movimientos de stock son de
-- "Envase 900ml", que no se toca.
--
-- Prisma corre este archivo en una transacción. Las FK Restrict de RecipeItem / ItemMovement /
-- PurchaseLine hacen de verificación: si alguna receta quedara sin remapear, el DELETE final falla
-- y revierte todo.

-- ---------------------------------------------------------------------------
-- 1. Insumos nuevos
-- ---------------------------------------------------------------------------
-- Ids legibles a propósito: nada en la app los parsea y hacen legible esta migración.
-- Los slugs están escritos a mano iguales a lo que produciría slugify() en src/lib/slug.ts.

INSERT INTO "Item" (id, slug, name, unit, category, "isResellable", "createdAt", "updatedAt") VALUES
  ('itm_tapa_29mm_priva_amarilla', 'tapa-29mm-priva-amarilla', 'Tapa 29mm Priva Amarilla', 'unidad', 'TAPAS', false, now(), now()),
  ('itm_tapa_29mm_priva_negra',    'tapa-29mm-priva-negra',    'Tapa 29mm Priva Negra',    'unidad', 'TAPAS', false, now(), now()),
  ('itm_tapa_29mm_omega_negra',    'tapa-29mm-omega-negra',    'Tapa 29mm Omega Negra',    'unidad', 'TAPAS', false, now(), now()),
  ('itm_tapa_48_41_baja_amarilla', 'tapa-48-41-baja-amarilla', 'Tapa 48-41 baja Amarilla', 'unidad', 'TAPAS', false, now(), now()),

  ('itm_caja_lisa_12x900',           'caja-lisa-12x900',           'Caja Lisa 12x900',           'unidad', 'CAJAS', false, now(), now()),
  ('itm_caja_lisa_15x900',           'caja-lisa-15x900',           'Caja Lisa 15x900',           'unidad', 'CAJAS', false, now(), now()),
  ('itm_caja_lisa_12x1500',          'caja-lisa-12x1500',          'Caja Lisa 12x1500',          'unidad', 'CAJAS', false, now(), now()),
  ('itm_caja_lisa_4x4000',           'caja-lisa-4x4000',           'Caja Lisa 4x4000',           'unidad', 'CAJAS', false, now(), now()),
  ('itm_caja_lisa_4x5000',           'caja-lisa-4x5000',           'Caja Lisa 4x5000',           'unidad', 'CAJAS', false, now(), now()),
  ('itm_caja_don_jose_12x900',       'caja-don-jose-12x900',       'Caja Don José 12x900',       'unidad', 'CAJAS', false, now(), now()),
  ('itm_caja_don_jose_12x1500',      'caja-don-jose-12x1500',      'Caja Don José 12x1500',      'unidad', 'CAJAS', false, now(), now()),
  ('itm_caja_don_jose_4x5000',       'caja-don-jose-4x5000',       'Caja Don José 4x5000',       'unidad', 'CAJAS', false, now(), now()),
  ('itm_caja_la_campechana_12x900',  'caja-la-campechana-12x900',  'Caja La Campechana 12x900',  'unidad', 'CAJAS', false, now(), now()),
  ('itm_caja_la_campechana_12x1500', 'caja-la-campechana-12x1500', 'Caja La Campechana 12x1500', 'unidad', 'CAJAS', false, now(), now()),
  ('itm_caja_la_campechana_4x5000',  'caja-la-campechana-4x5000',  'Caja La Campechana 4x5000',  'unidad', 'CAJAS', false, now(), now()),
  ('itm_caja_san_joaquin_12x900',    'caja-san-joaquin-12x900',    'Caja San Joaquin 12x900',    'unidad', 'CAJAS', false, now(), now()),

  ('itm_etiqueta_goye_girasol_900', 'etiqueta-goye-girasol-900ml', 'Etiqueta Goye Girasol 900ml', 'unidad', 'ETIQUETAS', false, now(), now());

-- La marca Goye todavía no existía.
INSERT INTO "Marca" (id, name, "oilType", "createdAt")
VALUES ('mrc_goye_girasol', 'Goye', 'Girasol', now());

-- ---------------------------------------------------------------------------
-- 2. Remapear las líneas de receta de TAPAS
-- ---------------------------------------------------------------------------
-- No hace falta mirar la presentación: cada tapa vieja ya estaba keyeada por mililitro.
-- Las de 29mm apuntan todas a Priva Amarilla, que es la que más usan; es un default, no un dato:
-- se puede cambiar por producto, y al cargar cada producción se elige la que realmente se usó.

UPDATE "RecipeItem" r
   SET "itemId" = CASE
     WHEN o.slug IN ('tapa-850ml', 'tapa-900ml', 'tapa-1500ml')   THEN 'itm_tapa_29mm_priva_amarilla'
     WHEN o.slug IN ('tapa-3600ml', 'tapa-4000ml', 'tapa-5000ml') THEN 'itm_tapa_48_41_baja_amarilla'
   END
  FROM "Item" o
 WHERE o.id = r."itemId"
   AND o.category = 'TAPAS';

-- ---------------------------------------------------------------------------
-- 3. Remapear las líneas de receta de CAJAS
-- ---------------------------------------------------------------------------
-- El destino se deriva de Product.presentation, que tiene el formato
-- "cajasPorPallet x unidadesPorCaja x mililitros" (ej. 105x12x900):
--   * la marca sale del slug del insumo viejo,
--   * el tramo de mililitros agrupa los tamaños que comparten caja (850 con 900, 3600 con 4000),
--   * y el COALESCE a la caja Lisa ES la regla de negocio "si la marca no tiene caja, va la lisa",
--     escrita como estructura y no como excepción: las cajas de marca para 4000 no existen, así que
--     Don José 4000 y La Campechana 4000 caen solas en Lisa sin necesidad de nombrarlas.

WITH objetivo AS (
  SELECT r.id AS recipe_id,
         CASE
           WHEN o.slug LIKE 'caja-don-jose-%'      THEN 'Don José'
           WHEN o.slug LIKE 'caja-la-campechana-%' THEN 'La Campechana'
           WHEN o.slug LIKE 'caja-san-joaquin-%'   THEN 'San Joaquin'
           ELSE 'Lisa'
         END AS marca,
         split_part(p.presentation, 'x', 2)::int AS unidades_por_caja,
         CASE
           WHEN split_part(p.presentation, 'x', 3)::int IN (850, 900)   THEN 900
           WHEN split_part(p.presentation, 'x', 3)::int = 1500          THEN 1500
           WHEN split_part(p.presentation, 'x', 3)::int IN (3600, 4000) THEN 4000
           WHEN split_part(p.presentation, 'x', 3)::int = 5000          THEN 5000
         END AS tramo_ml
    FROM "RecipeItem" r
    JOIN "Item"    o ON o.id = r."itemId" AND o.category = 'CAJAS'
    JOIN "Product" p ON p.id = r."productId"
   -- Los productos con presentación "OTRO" quedan afuera; hoy no tienen receta, pero así la
   -- consulta es total y no depende de eso.
   WHERE p.presentation ~ '^[0-9]+x[0-9]+x[0-9]+$'
)
UPDATE "RecipeItem" r
   SET "itemId" = COALESCE(marca_caja.id, lisa.id)
  FROM objetivo
  LEFT JOIN "Item" marca_caja
         ON marca_caja.category = 'CAJAS'
        AND marca_caja.name = 'Caja ' || objetivo.marca || ' ' || objetivo.unidades_por_caja || 'x' || objetivo.tramo_ml
  LEFT JOIN "Item" lisa
         ON lisa.category = 'CAJAS'
        AND lisa.name = 'Caja Lisa ' || objetivo.unidades_por_caja || 'x' || objetivo.tramo_ml
 WHERE r.id = objetivo.recipe_id;

-- ---------------------------------------------------------------------------
-- 4. Borrar los insumos viejos
-- ---------------------------------------------------------------------------
-- Sin guarda a propósito: si algo quedó apuntando a estos insumos, la FK Restrict tiene que
-- explotar y revertir toda la migración.

DELETE FROM "Item" WHERE slug IN (
  'tapa-850ml', 'tapa-900ml', 'tapa-1500ml', 'tapa-3600ml', 'tapa-4000ml', 'tapa-5000ml',
  'caja-don-jose-alto-oleico-5000ml', 'caja-don-jose-girasol-1500ml', 'caja-don-jose-girasol-4000ml',
  'caja-don-jose-girasol-5000ml', 'caja-don-jose-girasol-850ml', 'caja-don-jose-girasol-900ml',
  'caja-don-jose-mezcla-900ml', 'caja-generica-chica-850-900-1500ml',
  'caja-generica-grande-3600-4000-5000ml', 'caja-la-campechana-girasol-1500ml',
  'caja-la-campechana-girasol-4000ml', 'caja-la-campechana-girasol-5000ml',
  'caja-la-campechana-girasol-900ml', 'caja-san-joaquin-girasol-900ml'
);
