import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sumDecimals, ZERO } from "@/lib/money";
import { getDocumentEffect } from "@/lib/ledger";
import { getPreformasOrdenadas, MERMA_PREFORMA } from "@/lib/preformas";
import type { Cotizador } from "@/lib/cotizaciones";

/** Un renglón del balance a las dos puntas del mes, con quién lo forma. */
export type LineaDeBalance = {
  clave: string;
  etiqueta: string;
  detalle?: string;
  inicio: Prisma.Decimal;
  cierre: Prisma.Decimal;
  /** De quién es: cada cliente, cada proveedor, cada caja. Vacío en el stock. */
  filas: { nombre: string; slug?: string; inicio: Prisma.Decimal; cierre: Prisma.Decimal }[];
};

export type Balance = {
  activo: LineaDeBalance[];
  pasivo: LineaDeBalance[];
  totalActivo: { inicio: Prisma.Decimal; cierre: Prisma.Decimal };
  totalPasivo: { inicio: Prisma.Decimal; cierre: Prisma.Decimal };
  patrimonio: { inicio: Prisma.Decimal; cierre: Prisma.Decimal };
  /**
   * Lo que se llevaron los socios por su cuenta corriente, acumulado: queda a favor nuestro, pero
   * no se va a cobrar. No es activo; ya está descontado del patrimonio porque la plata salió.
   */
  retiros: { nombre: string; inicio: Prisma.Decimal; cierre: Prisma.Decimal }[];
};

type Punta = "inicio" | "cierre";
type Corte = { punta: Punta; hasta: Date; t: Date };

/**
 * El balance al empezar y al cerrar el mes: lo que hay y lo que nos deben (activo), lo que debemos
 * (pasivo), y la diferencia, que es lo que vale la empresa (patrimonio neto).
 *
 * - **La plata**: el saldo de cada caja y del banco. Un cobro con cheque entra a la caja aunque el
 *   cheque no se haya cobrado, así que el saldo ya los incluye: acá se apartan en su propio renglón,
 *   sin sumarlos dos veces.
 * - **La plata en la calle**: el saldo de cada cliente. Uno a favor del cliente (pagó de más, o por
 *   adelantado) es deuda nuestra y va al pasivo.
 * - **La deuda con proveedores**: el saldo de cada proveedor. Uno a favor nuestro es un anticipo y va
 *   al activo — salvo la cuenta por la que retiran los socios, que no se va a cobrar (`retiros`).
 * - **Los empleados**: lo que se les debe de sueldo, o lo que se les adelantó.
 * - **Las preformas en el soplador**: las nuestras que tiene Teoplast, o las suyas que le debemos,
 *   al costo de la preforma. No pasan por el depósito, así que no están en el stock.
 * - **El stock**: insumos y producto terminado, con el mismo valor que la tabla de Stock.
 *
 * Los saldos en dólares, a la cotización de cada punta. Cada saldo, con lo cargado hasta ese día:
 * un remito que se facturó después cuenta entero, como estaba.
 */
export async function getBalance(params: {
  inicio: Date;
  cierre: Date;
  cot: Cotizador;
  costoDe: (itemId: string, fecha: Date) => Prisma.Decimal | null;
  stock: { insumos: { inicio: Prisma.Decimal; cierre: Prisma.Decimal }; producto: { inicio: Prisma.Decimal; cierre: Prisma.Decimal } };
}): Promise<Balance> {
  const { cot, costoDe, stock } = params;
  // Un milisegundo antes de cada corte, como el stock: la cotización y el costo "de ese día".
  const cortes: Corte[] = [
    { punta: "inicio", hasta: params.inicio, t: new Date(params.inicio.getTime() - 1) },
    { punta: "cierre", hasta: params.cierre, t: new Date(params.cierre.getTime() - 1) },
  ];
  const ultimo = params.cierre;

  const [entidades, documentos, pagos, cheques, preformas, preformaItems, lineasPreforma, entregas, iniciales] = await Promise.all([
    prisma.entity.findMany({
      select: { id: true, name: true, slug: true, type: true, moneda: true, retiroSocietario: true, formaDeSueldo: true, llevaCuentaPreformas: true, accounts: { select: { id: true } } },
    }),
    prisma.document.findMany({
      where: { date: { lt: ultimo } },
      select: {
        accountId: true,
        date: true,
        type: true,
        totalAmount: true,
        remitoLinks: { select: { amount: true, factura: { select: { date: true } } } },
      },
    }),
    prisma.payment.findMany({ where: { date: { lt: ultimo } }, select: { accountId: true, date: true, amount: true } }),
    prisma.cheque.findMany({
      select: {
        amount: true,
        estado: true,
        updatedAt: true,
        recibidoEn: { select: { date: true, treasuryId: true } },
        entregadoEn: { select: { date: true } },
        cambioEn: { select: { date: true, account: { select: { entityId: true } } } },
      },
    }),
    getPreformasOrdenadas(),
    prisma.item.findMany({ where: { category: "PREFORMAS" }, select: { id: true, name: true } }),
    prisma.purchaseLine.findMany({
      where: { item: { preformaId: { not: null } }, document: { date: { lt: ultimo } } },
      select: { quantity: true, item: { select: { preformaId: true } }, document: { select: { date: true, account: { select: { entityId: true } } } } },
    }),
    prisma.entregaPreforma.findMany({ where: { date: { lt: ultimo } }, select: { entityId: true, preformaId: true, quantity: true, date: true } }),
    prisma.preformaSaldoInicial.findMany(),
  ]);

  // ---------- Saldo de cada cuenta a cada corte
  const saldoDeCuenta = (corte: Corte) => {
    const saldos = new Map<string, Prisma.Decimal>();
    const sumar = (id: string, monto: Prisma.Decimal) => saldos.set(id, (saldos.get(id) ?? ZERO).plus(monto));
    for (const d of documentos) {
      if (d.date >= corte.hasta) continue;
      // La parte facturada de un remito pasa a la factura; si la factura es posterior al corte,
      // a esa fecha el remito todavía estaba entero.
      sumar(d.accountId, getDocumentEffect({ ...d, remitoLinks: d.remitoLinks.filter((l) => l.factura.date < corte.hasta) }));
    }
    for (const p of pagos) if (p.date < corte.hasta) sumar(p.accountId, p.amount.negated());
    return saldos;
  };
  const saldos = { inicio: saldoDeCuenta(cortes[0]), cierre: saldoDeCuenta(cortes[1]) };
  const saldoDe = (e: (typeof entidades)[number], corte: Corte) => {
    const s = sumDecimals(e.accounts.map((a) => saldos[corte.punta].get(a.id) ?? ZERO));
    return e.moneda === "USD" ? cot.aPesos(s, "USD", corte.t) : s;
  };

  // ---------- Los renglones: cada entidad suma a uno según el signo de su saldo
  const lineas = new Map<string, LineaDeBalance>();
  const linea = (clave: string, etiqueta: string, detalle?: string) => {
    let l = lineas.get(clave);
    if (!l) {
      l = { clave, etiqueta, detalle, inicio: ZERO, cierre: ZERO, filas: [] };
      lineas.set(clave, l);
    }
    return l;
  };
  const anotar = (l: LineaDeBalance, punta: Punta, monto: Prisma.Decimal, quien?: { nombre: string; slug?: string }) => {
    if (monto.isZero()) return;
    l[punta] = l[punta].plus(monto);
    if (!quien) return;
    let fila = l.filas.find((f) => f.nombre === quien.nombre);
    if (!fila) {
      fila = { ...quien, inicio: ZERO, cierre: ZERO };
      l.filas.push(fila);
    }
    fila[punta] = fila[punta].plus(monto);
  };

  // Los cheques que estaban en cada caja a cada corte: ya habían entrado y todavía no habían salido.
  // Depositar o rechazar no guarda fecha: se toma la de la última modificación, que es esa.
  const chequesEnCaja = (corte: Corte) => {
    const porCaja = new Map<string, Prisma.Decimal>();
    for (const c of cheques) {
      const entro = c.recibidoEn?.date ?? c.cambioEn?.date;
      const caja = c.recibidoEn?.treasuryId ?? c.cambioEn?.account.entityId;
      if (!entro || !caja || entro >= corte.hasta) continue;
      if (c.entregadoEn && c.entregadoEn.date < corte.hasta) continue;
      if ((c.estado === "DEPOSITADO" || c.estado === "RECHAZADO") && c.updatedAt < corte.hasta) continue;
      porCaja.set(caja, (porCaja.get(caja) ?? ZERO).plus(c.amount));
    }
    return porCaja;
  };
  const enCartera = { inicio: chequesEnCaja(cortes[0]), cierre: chequesEnCaja(cortes[1]) };

  for (const corte of cortes) {
    const { punta } = corte;
    for (const e of entidades) {
      const saldo = saldoDe(e, corte);
      const quien = { nombre: e.name, slug: e.slug };
      if (e.type === "TESORERIA") {
        // Sin link: la caja no tiene ficha de cuenta corriente.
        const caja = { nombre: e.name };
        const cheques = enCartera[punta].get(e.id) ?? ZERO;
        anotar(linea("plata", "Caja y bancos", "lo que hay en cada caja y en el banco, sin los cheques"), punta, saldo.minus(cheques), caja);
        anotar(linea("cheques", "Cheques y echeqs en cartera", "recibidos y todavía sin depositar ni entregar"), punta, cheques, caja);
        continue;
      }
      if (saldo.isZero()) continue;
      if (e.formaDeSueldo) {
        if (saldo.isNegative()) anotar(linea("adelantos", "Adelantos a empleados"), punta, saldo.negated(), quien);
        else anotar(linea("sueldos", "Sueldos a pagar"), punta, saldo, quien);
      } else if (e.type === "CLIENTE") {
        if (saldo.isPositive()) anotar(linea("clientes", "Lo que nos deben los clientes", "la plata en la calle"), punta, saldo, quien);
        else anotar(linea("anticipos-clientes", "Anticipos de clientes", "pagaron de más o por adelantado"), punta, saldo.negated(), quien);
      } else if (saldo.isPositive()) {
        anotar(linea("proveedores", "Deuda con proveedores"), punta, saldo, quien);
      } else if (e.retiroSocietario) {
        // No es un crédito: es lo que se llevaron los socios. Va aparte, fuera del activo.
        anotar(linea("retiros", ""), punta, saldo.negated(), quien);
      } else {
        anotar(linea("anticipos-proveedores", "Anticipos a proveedores", "les pagamos de más o por adelantado"), punta, saldo.negated(), quien);
      }
    }

    // ---------- Preformas en el soplador: las que se le deben (+) o las nuestras que tiene (−)
    for (const e of entidades.filter((x) => x.llevaCuentaPreformas)) {
      for (const p of preformas) {
        // La misma cuenta que `getDeudaPreformas`, con lo cargado hasta el corte.
        const recibidas = sumDecimals(
          lineasPreforma
            .filter((l) => l.item.preformaId === p.id && l.document.account.entityId === e.id && l.document.date < corte.hasta)
            .map((l) => l.quantity)
        );
        const unidades = sumDecimals([
          ...iniciales.filter((s) => s.entityId === e.id && s.preformaId === p.id).map((s) => s.quantity),
          recibidas,
          recibidas.times(MERMA_PREFORMA).toDecimalPlaces(2),
          ...entregas.filter((x) => x.entityId === e.id && x.preformaId === p.id && x.date < corte.hasta).map((x) => x.quantity.negated()),
        ]);
        if (unidades.isZero()) continue;
        const item = preformaItems.find((i) => i.name === `Preforma ${p.name}`);
        const costo = item ? costoDe(item.id, corte.t) : null;
        if (!costo) continue;
        const quien = { nombre: `${e.name} · ${p.name}` };
        if (unidades.isNegative()) anotar(linea("preformas-nuestras", "Preformas nuestras en el soplador", "al costo de la preforma"), punta, unidades.negated().times(costo), quien);
        else anotar(linea("preformas-debidas", "Preformas que le debemos al soplador", "al costo de la preforma"), punta, unidades.times(costo), quien);
      }
    }
  }

  const insumos = linea("insumos", "Insumos", "al costo de la última compra");
  insumos.inicio = stock.insumos.inicio;
  insumos.cierre = stock.insumos.cierre;
  const producto = linea("producto", "Producto terminado", "por receta");
  producto.inicio = stock.producto.inicio;
  producto.cierre = stock.producto.cierre;

  const ordenar = (claves: string[]) =>
    claves
      .map((c) => lineas.get(c))
      .filter((l): l is LineaDeBalance => Boolean(l) && (!l!.inicio.isZero() || !l!.cierre.isZero()))
      .map((l) => ({ ...l, filas: l.filas.sort((a, b) => b.cierre.comparedTo(a.cierre) || b.inicio.comparedTo(a.inicio)) }));
  const activo = ordenar(["plata", "cheques", "clientes", "anticipos-proveedores", "adelantos", "preformas-nuestras", "insumos", "producto"]);
  const pasivo = ordenar(["proveedores", "anticipos-clientes", "sueldos", "preformas-debidas"]);
  const total = (ls: LineaDeBalance[]) => ({ inicio: sumDecimals(ls.map((l) => l.inicio)), cierre: sumDecimals(ls.map((l) => l.cierre)) });
  const totalActivo = total(activo);
  const totalPasivo = total(pasivo);

  return {
    activo,
    pasivo,
    totalActivo,
    totalPasivo,
    patrimonio: { inicio: totalActivo.inicio.minus(totalPasivo.inicio), cierre: totalActivo.cierre.minus(totalPasivo.cierre) },
    retiros: lineas.get("retiros")?.filas.map(({ nombre, inicio, cierre }) => ({ nombre, inicio, cierre })) ?? [],
  };
}
