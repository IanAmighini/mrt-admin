-- Rol "Encargado de producción": ve stock, pedidos y producción, y nada más. No carga nada — eso
-- lo sigue haciendo Secretaria.
--
-- Solo agrega el valor al enum. Que sea de solo lectura no necesita nada en la base: las páginas
-- ya calculan `canEdit` como ADMIN o SECRETARIA, y las Server Actions ya piden esos dos roles, así
-- que un rol nuevo nace sin permiso de escribir en ningún lado.
--
-- `ADD VALUE` corre dentro de la transacción de Prisma sin problema: PostgreSQL solo prohíbe *usar*
-- el valor nuevo en la misma transacción que lo crea, y acá no lo usa ninguna fila todavía.

ALTER TYPE "UserRole" ADD VALUE 'ENCARGADO_PRODUCCION';
