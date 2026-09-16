-- La caja chica: la que maneja la secretaría para sueldos y gastos del día. La plata sale de la
-- caja grande (Caja Bufano) y llega acá con un pase. Va aparte y no como una categoría de la caja
-- grande porque tiene su propio saldo, que es lo que se arquea contra el efectivo del cajón.
INSERT INTO "Entity" (id, slug, name, type, "createdAt", "updatedAt")
VALUES ('caja-chica', 'caja-chica', 'Caja chica', 'TESORERIA', now(), now())
ON CONFLICT (slug) DO NOTHING;

-- Las dos cuentas, como cualquier otra entidad: la ficha las espera a las dos. En los hechos se
-- usa la de Negro, que es la única que ofrece la pantalla de caja.
INSERT INTO "Account" (id, "entityId", circuit, "createdAt")
SELECT 'caja-chica-blanco', id, 'BLANCO', now() FROM "Entity" WHERE slug = 'caja-chica'
ON CONFLICT ("entityId", circuit) DO NOTHING;

INSERT INTO "Account" (id, "entityId", circuit, "createdAt")
SELECT 'caja-chica-negro', id, 'NEGRO', now() FROM "Entity" WHERE slug = 'caja-chica'
ON CONFLICT ("entityId", circuit) DO NOTHING;
