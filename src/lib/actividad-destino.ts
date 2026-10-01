import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * A dónde lleva cada línea de Actividad.
 *
 * El registro guarda **qué se tocó**, no el antes y el después: no hay un detalle que mostrar que
 * no esté ya en el resumen. Lo que sí se puede es abrir el registro afectado, que es lo que uno
 * quiere cuando lee "Cobro de LA CAMPECHANA — $26.136.000" y se pregunta de qué se trata.
 *
 * El `entityId` significa cosas distintas según el tipo —la entidad en un pago, el comprobante en
 * un movimiento de cuenta, el insumo en un movimiento de stock— así que se resuelve por grupos y
 * en una consulta por tabla, no una por fila.
 */
type Log = { id: string; entityType: string; entityId: string | null };

/** Los tipos cuyo `entityId` es el cliente o el proveedor. */
const DE_ENTIDAD = new Set([
  "Pago",
  "Factura",
  "Gasto",
  "Compra",
  "Remito",
  "Orden de pago",
  "Cliente",
  "Proveedor",
  "Saldo inicial de preformas",
]);

/** Los que no dependen de ningún id: siempre llevan a la misma pantalla. */
const FIJOS: Record<string, string> = {
  Producción: "/produccion",
  Pedido: "/pedidos",
  Marca: "/produccion/catalogo",
  Formato: "/produccion/catalogo",
  Receta: "/produccion",
  Usuario: "/usuarios",
  Cheque: "/tesoreria/cheques",
  "Cambio de cheques": "/tesoreria/cheques",
  "Movimiento de caja": "/caja-chica",
};

export async function resolverDestinos(logs: Log[]): Promise<Map<string, string>> {
  const idsPorGrupo = (predicado: (l: Log) => boolean) =>
    Array.from(new Set(logs.filter((l) => l.entityId && predicado(l)).map((l) => l.entityId!)));

  const idsEntidad = idsPorGrupo((l) => DE_ENTIDAD.has(l.entityType));
  const idsItem = idsPorGrupo((l) => l.entityType === "Insumo" || l.entityType === "Movimiento de insumo");
  const idsProducto = idsPorGrupo((l) => l.entityType === "Movimiento de producto");
  const idsDocumento = idsPorGrupo((l) => l.entityType === "Movimiento de cuenta");
  const idsViaje = idsPorGrupo((l) => l.entityType === "Viaje");
  const idsDestinatario = idsPorGrupo((l) => l.entityType === "Destinatario");

  const [entidades, items, productos, documentos, viajes, destinatarios] = await Promise.all([
    idsEntidad.length
      ? prisma.entity.findMany({ where: { id: { in: idsEntidad } }, select: { id: true, slug: true } })
      : [],
    idsItem.length
      ? prisma.item.findMany({ where: { id: { in: idsItem } }, select: { id: true, slug: true } })
      : [],
    idsProducto.length
      ? prisma.product.findMany({ where: { id: { in: idsProducto } }, select: { id: true, slug: true } })
      : [],
    idsDocumento.length
      ? prisma.document.findMany({
          where: { id: { in: idsDocumento } },
          select: { id: true, account: { select: { circuit: true, entity: { select: { slug: true } } } } },
        })
      : [],
    idsViaje.length
      ? prisma.entrega.findMany({
          where: { id: { in: idsViaje } },
          select: { id: true, entity: { select: { slug: true } } },
        })
      : [],
    idsDestinatario.length
      ? prisma.destinatario.findMany({
          where: { id: { in: idsDestinatario } },
          select: { id: true, entity: { select: { slug: true } } },
        })
      : [],
  ]);

  const slugEntidad = new Map(entidades.map((e) => [e.id, e.slug]));
  const slugItem = new Map(items.map((i) => [i.id, i.slug]));
  const slugProducto = new Map(productos.map((p) => [p.id, p.slug]));
  const docDe = new Map(documentos.map((d) => [d.id, d]));
  const viajeDe = new Map(viajes.map((v) => [v.id, v]));
  const destDe = new Map(destinatarios.map((d) => [d.id, d]));

  const destinos = new Map<string, string>();
  for (const log of logs) {
    const fijo = FIJOS[log.entityType];
    if (fijo) {
      destinos.set(log.id, fijo);
      continue;
    }
    if (!log.entityId) continue;

    if (DE_ENTIDAD.has(log.entityType)) {
      const slug = slugEntidad.get(log.entityId);
      if (slug) destinos.set(log.id, `/cuentas-corrientes/${slug}`);
    } else if (log.entityType === "Insumo" || log.entityType === "Movimiento de insumo") {
      const slug = slugItem.get(log.entityId);
      if (slug) destinos.set(log.id, `/stock/${slug}`);
    } else if (log.entityType === "Movimiento de producto") {
      const slug = slugProducto.get(log.entityId);
      if (slug) destinos.set(log.id, `/produccion/${slug}`);
    } else if (log.entityType === "Movimiento de cuenta") {
      const doc = docDe.get(log.entityId);
      // Al libro mayor del circuito donde está el comprobante, que es donde se lo puede ver.
      if (doc) {
        destinos.set(
          log.id,
          `/cuentas-corrientes/${doc.account.entity.slug}/${doc.account.circuit.toLowerCase()}`
        );
      }
    } else if (log.entityType === "Viaje") {
      const viaje = viajeDe.get(log.entityId);
      if (viaje) destinos.set(log.id, `/cuentas-corrientes/${viaje.entity.slug}/viaje/${log.entityId}`);
    } else if (log.entityType === "Destinatario") {
      const dest = destDe.get(log.entityId);
      if (dest) destinos.set(log.id, `/cuentas-corrientes/${dest.entity.slug}`);
    }
  }
  return destinos;
}
