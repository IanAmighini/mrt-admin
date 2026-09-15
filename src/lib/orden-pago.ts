import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/user-error";
import { sumDecimals, toDecimal, ZERO } from "@/lib/money";
import { getAccountBalance, getDocumentEffect } from "@/lib/ledger";
import { documentSubtitle } from "@/lib/account-statement";
import { getSetting } from "@/lib/settings";
import { CONTRIBUYENTE_KEYS, getContribuyente } from "@/lib/libro-iva";

export const DIRECCION_KEY = "contribuyenteDireccion";

/** El encabezado del papel: quiénes somos. */
export async function getEmisor() {
  const [contribuyente, direccion] = await Promise.all([
    getContribuyente(),
    getSetting(DIRECCION_KEY, "Av. Bartolomé Mitre 262 · Villa Martelli, Buenos Aires"),
  ]);
  return { ...contribuyente, direccion };
}

export { CONTRIBUYENTE_KEYS };

/** Cuatro dígitos, como se viene numerando a mano. */
export const formatNumeroOP = (numero: number) => String(numero).padStart(4, "0");

/**
 * Los pagos de la cuenta Blanco de un proveedor que todavía no están en ninguna orden. Son los
 * candidatos a armar una: uno por medio de pago.
 */
export async function getPagosSinOrden(entityId: string) {
  return prisma.payment.findMany({
    where: {
      ordenPagoId: null,
      account: { entityId, circuit: "BLANCO" },
    },
    include: { allocations: { include: { document: true } }, chequeEntregado: true },
    orderBy: { date: "desc" },
  });
}

export type OrdenPagoImpresa = Awaited<ReturnType<typeof getOrdenPago>>;

/**
 * Todo lo que va en el papel. El saldo anterior se deduce del actual en vez de recorrer la cuenta
 * hasta la fecha: `saldoActual = saldoAnterior + facturas − pagos`, así que despejarlo da el mismo
 * número y no depende de que las fechas estén en orden.
 */
export async function getOrdenPago(numero: number) {
  const orden = await prisma.ordenPago.findUnique({
    where: { numero },
    include: {
      entity: true,
      payments: {
        include: {
          account: true,
          chequeEntregado: true,
          allocations: {
            include: {
              document: {
                include: {
                  remitoLinks: true,
                  allocations: true,
                  lines: { include: { product: true } },
                  purchaseLines: { include: { item: true } },
                  taxes: true,
                },
              },
            },
          },
        },
        orderBy: { date: "asc" },
      },
    },
  });
  if (!orden) throw new UserError("Esa orden de pago no existe.");

  const [emisor, cuenta] = await Promise.all([
    getEmisor(),
    prisma.account.findUnique({ where: { entityId_circuit: { entityId: orden.entityId, circuit: "BLANCO" } } }),
  ]);
  const saldoActual = cuenta ? await getAccountBalance(cuenta.id) : ZERO;

  // Los comprobantes que cubren estos pagos, sin repetir: dos pagos pueden imputarse al mismo.
  const porDocumento = new Map<string, { doc: (typeof orden.payments)[number]["allocations"][number]["document"]; imputado: Prisma.Decimal }>();
  for (const pago of orden.payments) {
    for (const a of pago.allocations) {
      const actual = porDocumento.get(a.documentId);
      porDocumento.set(a.documentId, {
        doc: a.document,
        imputado: (actual?.imputado ?? ZERO).plus(a.amount),
      });
    }
  }

  const comprobantes = Array.from(porDocumento.values()).map(({ doc, imputado }) => ({
    id: doc.id,
    number: doc.number,
    type: doc.type,
    date: doc.date,
    total: getDocumentEffect(doc),
    imputado,
    // El concepto sale del comprobante: su motivo, o el detalle de lo que trajo.
    concepto: documentSubtitle(doc),
  }));

  const totalFacturas = sumDecimals(comprobantes.map((c) => c.total));
  const totalPagado = sumDecimals(orden.payments.map((p) => p.amount));
  const saldoAnterior = saldoActual.minus(totalFacturas).plus(totalPagado);

  return {
    orden,
    emisor,
    comprobantes,
    totalFacturas,
    totalPagado,
    saldoAnterior,
    saldoPendiente: saldoAnterior.plus(totalFacturas).minus(totalPagado),
    conceptos: comprobantes.map((c) => c.concepto).filter(Boolean).join(" · "),
  };
}

/** El próximo correlativo. Se calcula dentro de la transacción que crea la orden. */
export async function proximoNumero(tx: Prisma.TransactionClient) {
  const ultima = await tx.ordenPago.findFirst({ orderBy: { numero: "desc" }, select: { numero: true } });
  return (ultima?.numero ?? 0) + 1;
}

export { toDecimal };
