import "server-only";
import { Prisma, type Currency, type DocumentType, type TaxKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import { DOCUMENT_TYPE_LABELS } from "@/lib/labels";
import { ALICUOTAS_IVA } from "@/lib/impuestos";
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
  /** Qué comprobante es: en la planilla se mezclan facturas con notas de crédito y débito. */
  tipo: string;
  entityName: string;
  taxId: string | null;
  /** Qué es: "Factura", "Gasto", "Compra". Sólo se muestra del lado de compras, donde se mezclan. */
  concepto: string | null;
  neto: Prisma.Decimal;
  percepcion: Prisma.Decimal;
  iva: Prisma.Decimal;
  total: Prisma.Decimal;
  currency: Currency;
  /** Neto e IVA abiertos por alícuota, en el orden de `ALICUOTAS_IVA`: son columnas de la planilla. */
  porAlicuota: { rate: string; neto: Prisma.Decimal; iva: Prisma.Decimal }[];
  /** El resto de los renglones, por tipo: cada percepción tiene su columna. */
  porTributo: Partial<Record<TaxKind, Prisma.Decimal>>;
  /** El nombre del tributo suelto, cuando hay uno que no tiene columna propia. */
  otroTributo: string | null;
  retencion: Prisma.Decimal;
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
  remitosSinFacturar: {
    number: string;
    date: Date;
    entityName: string;
    /** Para linkear a la ficha, que es donde se carga la factura que lo cubre. */
    entitySlug: string;
    pendiente: Prisma.Decimal;
    /** "Remito" si es una entrega a un cliente, "Compra" si es un ingreso de un proveedor. */
    sustantivo: string;
  }[];
  /**
   * Notas en Blanco de entidades marcadas como "Ambos": no se sabe si la emitimos o la recibimos,
   * así que no se puede decidir de qué lado del libro van. Se avisan en vez de adivinar.
   */
  notasSinClasificar: { number: string; date: Date; entityName: string; tipo: string }[];
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

/**
 * Una nota de crédito resta: baja la base imponible y el IVA del período, de los dos lados. El resto
 * de los comprobantes suma. El signo del saldo de la cuenta lo maneja aparte `getDocumentEffect`.
 */
const signoDe = (type: DocumentType) => (type === "NOTA_CREDITO" ? -1 : 1);

type DocConTaxes = { taxes: { kind: string; rate: Prisma.Decimal | null; base: Prisma.Decimal | null; amount: Prisma.Decimal }[] };

/**
 * Abre el neto y el IVA por alícuota. Sale de DocumentTax, que es lo único que sabe de alícuotas
 * cuando un comprobante trae más de una; los que no tienen desglose caen en su `ivaRate`.
 */
function abrirPorAlicuota(
  docs: (DocConTaxes & {
    type: DocumentType;
    ivaRate: Prisma.Decimal | null;
    netAmount: Prisma.Decimal;
    ivaAmount: Prisma.Decimal | null;
  })[]
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
    const signo = signoDe(doc.type);
    const filasIva = doc.taxes.filter((t) => t.kind === "IVA" && t.rate);
    if (filasIva.length > 0) {
      for (const fila of filasIva) {
        sumar(fila.rate!, toDecimal(fila.base).times(signo), toDecimal(fila.amount).times(signo));
      }
    } else if (doc.ivaRate) {
      // Comprobantes cargados antes de que existiera el desglose: una sola alícuota.
      sumar(doc.ivaRate, toDecimal(doc.netAmount).times(signo), toDecimal(doc.ivaAmount).times(signo));
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

  const [contribuyente, facturas, gastos, remitos, notas] = await Promise.all([
    getContribuyente(),
    // Las facturas de los dos lados: la que le emitimos a un cliente y la que nos emite un
    // proveedor. Ni el remito de entrega ni la compra son comprobantes fiscales.
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
    // Remitos en Blanco de los dos lados: no entran al libro, sirven para avisar de los que
    // quedaron sin facturar — esa venta o esa compra todavía no está declarada.
    prisma.document.findMany({
      where: { type: "REMITO", ...enBlanco, ...enElPeriodo },
      include: { account: { include: { entity: true } }, remitoLinks: true, purchaseLines: { select: { id: true } } },
      orderBy: { date: "asc" },
    }),
    // Notas de crédito y débito: van al lado del libro que corresponda según con quién sea la
    // cuenta. Las de Negro no entran —no son comprobantes fiscales— y el ajuste tampoco.
    prisma.document.findMany({
      where: { type: { in: ["NOTA_CREDITO", "NOTA_DEBITO"] }, ...enBlanco, ...enElPeriodo },
      include: { account: { include: { entity: true } }, taxes: true },
      orderBy: [{ date: "asc" }, { number: "asc" }],
    }),
  ]);

  const renglon = (
    doc: {
      type: DocumentType;
      date: Date;
      number: string;
      taxes: {
        kind: TaxKind;
        base: Prisma.Decimal | null;
        rate: Prisma.Decimal | null;
        amount: Prisma.Decimal;
        description: string | null;
      }[];
      netAmount: Prisma.Decimal;
      ivaAmount: Prisma.Decimal | null;
      perceptionAmount: Prisma.Decimal | null;
      retentionAmount: Prisma.Decimal | null;
      totalAmount: Prisma.Decimal;
      currency: Currency;
      account: { entity: { name: string; taxId: string | null } };
    },
    concepto: string | null,
    tipo?: string
  ): RenglonIva => {
    // Una nota de crédito entra en negativo, así que la fila de TOTALES ya es lo que se declara.
    // `0 × −1` da −0, que se imprime "−$ 0,00": el cero no lleva signo.
    const signo = signoDe(doc.type);
    const conSigno = (v: Prisma.Decimal) => (v.isZero() ? ZERO : v.times(signo));
    return {
      date: doc.date,
      number: doc.number,
      tipo: tipo ?? DOCUMENT_TYPE_LABELS[doc.type],
      entityName: doc.account.entity.name,
      taxId: doc.account.entity.taxId,
      concepto,
      neto: conSigno(toDecimal(doc.netAmount)),
      percepcion: conSigno(percepcionesDe(doc)),
      iva: conSigno(toDecimal(doc.ivaAmount)),
      total: conSigno(toDecimal(doc.totalAmount)),
      currency: doc.currency,
      porAlicuota: ALICUOTAS_IVA.map((rate) => {
        const filas = doc.taxes.filter(
          (t) => t.kind === "IVA" && t.rate?.equals(rate.replace(",", "."))
        );
        return {
          rate,
          neto: conSigno(sumDecimals(filas.map((f) => f.base))),
          iva: conSigno(sumDecimals(filas.map((f) => f.amount))),
        };
      }),
      porTributo: Object.fromEntries(
        Array.from(new Set(doc.taxes.filter((t) => t.kind !== "IVA").map((t) => t.kind))).map((kind) => [
          kind,
          conSigno(sumDecimals(doc.taxes.filter((t) => t.kind === kind).map((t) => t.amount))),
        ])
      ),
      otroTributo: doc.taxes.find((t) => t.kind === "OTRO_TRIBUTO")?.description ?? null,
      retencion: conSigno(toDecimal(doc.retentionAmount)),
    };
  };

  const porFecha = (a: RenglonIva, b: RenglonIva) =>
    a.date.getTime() - b.date.getTime() || a.number.localeCompare(b.number);

  const deCliente = <T extends { account: { entity: { type: string } } }>(docs: T[]) =>
    docs.filter((d) => d.account.entity.type === "CLIENTE");
  const deProveedor = <T extends { account: { entity: { type: string } } }>(docs: T[]) =>
    docs.filter((d) => d.account.entity.type === "PROVEEDOR");

  const ventas = [
    ...deCliente(facturas).map((d) => renglon(d, null)),
    ...deCliente(notas).map((d) => renglon(d, d.reason)),
  ].sort(porFecha);

  const comprasRenglones = [
    ...deProveedor(facturas).map((d) => renglon(d, d.reason)),
    ...deProveedor(gastos).map((d) => renglon(d, d.reason, "Gasto")),
    ...deProveedor(notas).map((d) => renglon(d, d.reason)),
  ].sort(porFecha);

  const totalesVentas = sumarTotales(ventas);
  const totalesCompras = sumarTotales(comprasRenglones);

  const remitosSinFacturar = remitos
    .map((r) => ({
      number: r.number,
      date: r.date,
      entityName: r.account.entity.name,
      entitySlug: r.account.entity.slug,
      sustantivo: r.purchaseLines.length > 0 ? "Compra" : "Remito",
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
    alicuotasVentas: abrirPorAlicuota([...deCliente(facturas), ...deCliente(notas)]),
    alicuotasCompras: abrirPorAlicuota([...deProveedor(facturas), ...deProveedor(gastos), ...deProveedor(notas)]),
    remitosSinFacturar,
    notasSinClasificar: [...notas, ...facturas]
      .filter((n) => n.account.entity.type !== "CLIENTE" && n.account.entity.type !== "PROVEEDOR")
      .map((n) => ({
        number: n.number,
        date: n.date,
        entityName: n.account.entity.name,
        tipo: DOCUMENT_TYPE_LABELS[n.type],
      })),
  };
}
