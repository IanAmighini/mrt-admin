import "server-only";
import { Prisma, type Currency } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import { sumDecimals, toDecimal, ZERO } from "@/lib/money";
import { formatPeriodLabel, periodLastDay, type Period } from "@/lib/period";

/** Datos del encabezado de la planilla, los mismos que lleva la que se arma a mano. */
export const CONTRIBUYENTE_KEYS = {
  nombre: "contribuyenteNombre",
  cuit: "contribuyenteCuit",
} as const;

export type Contribuyente = { nombre: string; cuit: string };

export async function getContribuyente(): Promise<Contribuyente> {
  const [nombre, cuit] = await Promise.all([
    getSetting(CONTRIBUYENTE_KEYS.nombre, "Molinos Rio Tala"),
    getSetting(CONTRIBUYENTE_KEYS.cuit, "30-71569727-7"),
  ]);
  return { nombre, cuit };
}

/** Un renglón del libro, del lado que sea: las dos planillas tienen la misma forma. */
export type RenglonIva = {
  date: Date;
  number: string;
  entityName: string;
  taxId: string | null;
  /** Qué es: "Factura", "Gasto", "Compra". Sólo se muestra del lado de compras, donde se mezclan. */
  concepto: string | null;
  neto: Prisma.Decimal;
  percepcion: Prisma.Decimal;
  iva: Prisma.Decimal;
  total: Prisma.Decimal;
  currency: Currency;
};

export type TotalesIva = {
  neto: Prisma.Decimal;
  percepcion: Prisma.Decimal;
  iva: Prisma.Decimal;
  total: Prisma.Decimal;
};

export type LibroIva = {
  period: Period;
  periodLabel: string;
  /** El mes y año en palabras, como en el encabezado de la planilla: "SEPTIEMBRE 2026". */
  periodoTitulo: string;
  contribuyente: Contribuyente;
  ventas: RenglonIva[];
  compras: RenglonIva[];
  totalesVentas: TotalesIva;
  totalesCompras: TotalesIva;
  /** IVA débito − IVA crédito: positivo es saldo a pagar, negativo es saldo a favor. */
  saldoIva: Prisma.Decimal;
  /** Neto e IVA abiertos por alícuota, de cada lado, que es lo que se declara. */
  alicuotasVentas: { rate: Prisma.Decimal; neto: Prisma.Decimal; iva: Prisma.Decimal }[];
  alicuotasCompras: { rate: Prisma.Decimal; neto: Prisma.Decimal; iva: Prisma.Decimal }[];
  /**
   * Remitos en Blanco del período que todavía no tienen factura. No entran al libro —no son
   * comprobantes fiscales— pero si quedan sin facturar, esa venta falta en la declaración.
   */
  remitosSinFacturar: { number: string; date: Date; entityName: string; pendiente: Prisma.Decimal }[];
};

const MESES = [
  "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
];

/** "SEPTIEMBRE 2026" si el período es un mes entero; si no, el rango de fechas. */
function tituloDePeriodo(period: Period): string {
  const desde = period.from;
  const hasta = periodLastDay(period);
  const mismoMes = desde.getFullYear() === hasta.getFullYear() && desde.getMonth() === hasta.getMonth();
  const mesEntero = mismoMes && desde.getDate() === 1 && hasta.getDate() === new Date(desde.getFullYear(), desde.getMonth() + 1, 0).getDate();
  return mesEntero ? `${MESES[desde.getMonth()]} ${desde.getFullYear()}` : formatPeriodLabel(period);
}

function sumarTotales(renglones: RenglonIva[]): TotalesIva {
  return {
    neto: sumDecimals(renglones.map((r) => r.neto)),
    percepcion: sumDecimals(renglones.map((r) => r.percepcion)),
    iva: sumDecimals(renglones.map((r) => r.iva)),
    total: sumDecimals(renglones.map((r) => r.total)),
  };
}

type DocConTaxes = { taxes: { kind: string; rate: Prisma.Decimal | null; base: Prisma.Decimal | null; amount: Prisma.Decimal }[] };

/**
 * Abre el neto y el IVA por alícuota. Sale de DocumentTax, que es lo único que sabe de alícuotas
 * cuando un comprobante trae más de una; los que no tienen desglose caen en su `ivaRate`.
 */
function abrirPorAlicuota(
  docs: (DocConTaxes & { ivaRate: Prisma.Decimal | null; netAmount: Prisma.Decimal; ivaAmount: Prisma.Decimal | null })[]
) {
  const porTasa = new Map<string, { rate: Prisma.Decimal; neto: Prisma.Decimal; iva: Prisma.Decimal }>();

  const sumar = (rate: Prisma.Decimal, neto: Prisma.Decimal, iva: Prisma.Decimal) => {
    const clave = rate.toString();
    const fila = porTasa.get(clave) ?? { rate, neto: ZERO, iva: ZERO };
    fila.neto = fila.neto.plus(neto);
    fila.iva = fila.iva.plus(iva);
    porTasa.set(clave, fila);
  };

  for (const doc of docs) {
    const filasIva = doc.taxes.filter((t) => t.kind === "IVA" && t.rate);
    if (filasIva.length > 0) {
      for (const fila of filasIva) sumar(fila.rate!, toDecimal(fila.base), toDecimal(fila.amount));
    } else if (doc.ivaRate) {
      // Comprobantes cargados antes de que existiera el desglose: una sola alícuota.
      sumar(doc.ivaRate, toDecimal(doc.netAmount), toDecimal(doc.ivaAmount));
    }
  }

  return Array.from(porTasa.values()).sort((a, b) => b.rate.comparedTo(a.rate));
}

/** Las percepciones del comprobante, que en la planilla van en su propia columna. */
function percepcionesDe(doc: { perceptionAmount: Prisma.Decimal | null }): Prisma.Decimal {
  return toDecimal(doc.perceptionAmount);
}

export async function getLibroIva(period: Period): Promise<LibroIva> {
  const enElPeriodo = { date: { gte: period.from, lt: period.to } };
  const enBlanco = { account: { circuit: "BLANCO" as const } };

  const [contribuyente, facturas, gastos, compras, remitos] = await Promise.all([
    getContribuyente(),
    // Ventas: sólo las facturas. Un remito no es comprobante fiscal.
    prisma.document.findMany({
      where: { type: "FACTURA", ...enBlanco, ...enElPeriodo },
      include: { account: { include: { entity: true } }, taxes: true },
      orderBy: [{ date: "asc" }, { number: "asc" }],
    }),
    prisma.document.findMany({
      where: { type: "GASTO", ...enBlanco, ...enElPeriodo },
      include: { account: { include: { entity: true } }, taxes: true },
      orderBy: [{ date: "asc" }, { number: "asc" }],
    }),
    prisma.document.findMany({
      where: { type: "REMITO", purchaseLines: { some: {} }, ...enBlanco, ...enElPeriodo },
      include: { account: { include: { entity: true } }, taxes: true },
      orderBy: [{ date: "asc" }, { number: "asc" }],
    }),
    // Remitos de venta en Blanco: sirven sólo para avisar de los que quedaron sin facturar.
    prisma.document.findMany({
      where: { type: "REMITO", lines: { some: {} }, ...enBlanco, ...enElPeriodo },
      include: { account: { include: { entity: true } }, remitoLinks: true },
      orderBy: { date: "asc" },
    }),
  ]);

  const renglon = (
    doc: {
      date: Date;
      number: string;
      netAmount: Prisma.Decimal;
      ivaAmount: Prisma.Decimal | null;
      perceptionAmount: Prisma.Decimal | null;
      totalAmount: Prisma.Decimal;
      currency: Currency;
      account: { entity: { name: string; taxId: string | null } };
    },
    concepto: string | null
  ): RenglonIva => ({
    date: doc.date,
    number: doc.number,
    entityName: doc.account.entity.name,
    taxId: doc.account.entity.taxId,
    concepto,
    neto: toDecimal(doc.netAmount),
    percepcion: percepcionesDe(doc),
    iva: toDecimal(doc.ivaAmount),
    total: toDecimal(doc.totalAmount),
    currency: doc.currency,
  });

  const ventas = facturas.map((d) => renglon(d, null));
  const comprasRenglones = [
    ...compras.map((d) => renglon(d, "Compra")),
    ...gastos.map((d) => renglon(d, "Gasto")),
  ].sort((a, b) => a.date.getTime() - b.date.getTime() || a.number.localeCompare(b.number));

  const totalesVentas = sumarTotales(ventas);
  const totalesCompras = sumarTotales(comprasRenglones);

  const remitosSinFacturar = remitos
    .map((r) => ({
      number: r.number,
      date: r.date,
      entityName: r.account.entity.name,
      pendiente: toDecimal(r.totalAmount).minus(sumDecimals(r.remitoLinks.map((l) => l.amount))),
    }))
    .filter((r) => r.pendiente.greaterThan(0));

  return {
    period,
    periodLabel: formatPeriodLabel(period),
    periodoTitulo: tituloDePeriodo(period),
    contribuyente,
    ventas,
    compras: comprasRenglones,
    totalesVentas,
    totalesCompras,
    saldoIva: totalesVentas.iva.minus(totalesCompras.iva),
    alicuotasVentas: abrirPorAlicuota(facturas),
    alicuotasCompras: abrirPorAlicuota([...compras, ...gastos]),
    remitosSinFacturar,
  };
}
