-- Los retiros de los socios se hacen a través de un proveedor: se le paga lo que vende y además se
-- le retira plata, así que su cuenta queda a favor nuestro. Ese saldo a favor no es un crédito con
-- el proveedor —no nos va a entregar mercadería por eso— y sumarlo a la deuda la subestima.
ALTER TABLE "Entity" ADD COLUMN "retiroSocietario" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Entity" SET "retiroSocietario" = true WHERE slug = 'cristian-amighini';
