import "server-only";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/user-error";
import { puedeVerRuta } from "@/lib/nav";
import { CAJA_CHICA_SLUG } from "@/lib/caja";

/**
 * Las cajas que no son la chica —Caja Bufano, el banco— son de Tesorería, que la secretaría no ve:
 * ahí está lo que saca un socio. Las pantallas ya la mandan al inicio, pero las acciones son de
 * todas las pantallas a la vez: alguien que arme el pedido a mano podía borrar o editar un
 * movimiento de la caja grande desde la acción genérica de comprobantes, o renombrar la caja.
 *
 * Esto mira todo lo que el formulario dice tocar —la cuenta, el comprobante, el pago— y corta si
 * alguno es una de esas cajas. Cargar un pago a un proveedor CON origen en la caja grande sigue
 * pudiendo: eso es suyo, y el movimiento de la caja nace y muere con el pago.
 */
export async function exigirZonaDelFormulario(role: UserRole, formData: FormData) {
  if (puedeVerRuta(role, "/tesoreria")) return;

  const leer = (campo: string) => String(formData.get(campo) || "").trim() || null;
  // Dar de alta una caja, o pasar una cuenta a caja, también es de Tesorería.
  if (leer("type") === "TESORERIA") throw new UserError("Las cajas se manejan desde Tesorería: no tenés permisos para crearlas.");

  const entityId = leer("entityId");
  const accountId = leer("accountId");
  const documentId = leer("documentId");
  const paymentId = leer("paymentId");
  if (!entityId && !accountId && !documentId && !paymentId) return;

  const caja = await prisma.entity.findFirst({
    where: {
      type: "TESORERIA",
      slug: { not: CAJA_CHICA_SLUG },
      OR: [
        ...(entityId ? [{ id: entityId }] : []),
        ...(accountId ? [{ accounts: { some: { id: accountId } } }] : []),
        ...(documentId ? [{ accounts: { some: { documents: { some: { id: documentId } } } } }] : []),
        ...(paymentId ? [{ accounts: { some: { payments: { some: { id: paymentId } } } } }] : []),
      ],
    },
    select: { name: true },
  });
  if (caja) throw new UserError(`${caja.name} se maneja desde Tesorería: no tenés permisos para tocarla.`);
}
