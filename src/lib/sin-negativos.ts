import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { UserError } from "./user-error";
import { formatMoney, formatQuantity } from "./money";
import { formatFecha } from "./period";
import { NUMERO_SALDO_INICIAL } from "./saldo-inicial";

/**
 * Ninguna caja con plata negativa y ningún stock negativo, en ningún momento.
 *
 * Las dos cosas son siempre un error de carga: no se puede pagar con plata que no está ni envasar
 * con aceite que no llegó. Si el número da negativo es porque falta cargar algo —el cobro, el
 * ingreso— o porque se cargó mal, y la pantalla tiene que decirlo en el momento en vez de dejar un
 * saldo imposible que alguien descubre días después.
 *
 * **"En ningún momento" quiere decir el saldo corrido, no el de hoy.** Un pago fechado el lunes con
 * plata que entró el miércoles deja la caja en rojo el lunes y el martes, aunque el total de hoy dé
 * positivo. Se recorre en el mismo orden que el estado de cuenta: el saldo inicial primero, después
 * por fecha y, a igual fecha, por orden de carga.
 *
 * **Lo que se prohíbe es empeorar, no lo que ya estaba.** Hay movimientos viejos que pasan por
 * debajo de cero —casi todos por el orden en que se cargó el recuento del 29 y 30/09— y si la regla
 * mirara sólo el resultado, cualquier carga sobre ese insumo quedaría bloqueada aunque no tuviera
 * nada que ver. Así que se compara punto por punto contra cómo estaba antes de la operación: es un
 * error si en algún momento queda en negativo **y** más abajo de lo que ya estaba. Corregir un
 * agujero viejo se puede; abrir uno nuevo o hacerlo más hondo, no.
 */

type Fila = { id: string; inicial: boolean; date: Date; createdAt: Date; monto: Prisma.Decimal };
type Cliente = Prisma.TransactionClient | typeof prisma;

const TOLERANCIA_PLATA = new Prisma.Decimal("0.005");
const TOLERANCIA_STOCK = new Prisma.Decimal("0.0005");
const CERO = new Prisma.Decimal(0);

function orden(a: Fila, b: Fila) {
  if (a.inicial !== b.inicial) return a.inicial ? -1 : 1;
  return (
    a.date.getTime() - b.date.getTime() ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    a.id.localeCompare(b.id)
  );
}

/**
 * El primer momento en que `despues` queda en negativo y por debajo de `antes`, o null.
 *
 * Se recorren las dos versiones juntas, en el mismo orden, sumando cada una por su lado. Lo que no
 * cambió aparece en las dos y suma igual; lo nuevo suma sólo en `despues` y lo borrado sólo en
 * `antes`. Se compara después de cada grupo de filas con la misma posición, para que una fila que
 * existe en las dos no se lea como un hueco entre la suma de una y la de la otra.
 */
function primerRojo(antes: Fila[], despues: Fila[], tolerancia: Prisma.Decimal) {
  const todas = [
    ...antes.map((f) => ({ f, lado: "antes" as const })),
    ...despues.map((f) => ({ f, lado: "despues" as const })),
  ].sort((x, y) => orden(x.f, y.f));

  let sumaAntes = CERO;
  let sumaDespues = CERO;
  for (let i = 0; i < todas.length; ) {
    let j = i;
    while (j < todas.length && orden(todas[j].f, todas[i].f) === 0) {
      if (todas[j].lado === "antes") sumaAntes = sumaAntes.plus(todas[j].f.monto);
      else sumaDespues = sumaDespues.plus(todas[j].f.monto);
      j++;
    }
    const piso = Prisma.Decimal.min(CERO, sumaAntes);
    if (sumaDespues.lessThan(tolerancia.negated()) && sumaDespues.lessThan(piso.minus(tolerancia))) {
      return { date: todas[i].f.date, saldo: sumaDespues };
    }
    i = j;
  }
  return null;
}

const filasDeCuenta = async (db: Cliente, accountId: string): Promise<Fila[]> =>
  (
    await db.document.findMany({
      where: { accountId },
      select: { id: true, number: true, date: true, createdAt: true, totalAmount: true },
    })
  ).map((d) => ({
    id: d.id,
    inicial: d.number === NUMERO_SALDO_INICIAL,
    date: d.date,
    createdAt: d.createdAt,
    monto: d.totalAmount,
  }));

const filasDeInsumo = async (db: Cliente, itemId: string): Promise<Fila[]> =>
  (
    await db.itemMovement.findMany({
      where: { itemId },
      select: { id: true, date: true, createdAt: true, quantity: true },
    })
  ).map((m) => ({ id: m.id, inicial: false, date: m.date, createdAt: m.createdAt, monto: m.quantity }));

const filasDeProducto = async (db: Cliente, productId: string): Promise<Fila[]> =>
  (
    await db.productMovement.findMany({
      where: { productId },
      select: { id: true, date: true, createdAt: true, quantity: true },
    })
  ).map((m) => ({ id: m.id, inicial: false, date: m.date, createdAt: m.createdAt, monto: m.quantity }));

const filasDeCaja = async (db: Cliente, cajaId: string): Promise<Fila[]> =>
  (
    await db.cajaMovement.findMany({
      where: { cajaId },
      select: { id: true, date: true, createdAt: true, quantity: true },
    })
  ).map((m) => ({ id: m.id, inicial: false, date: m.date, createdAt: m.createdAt, monto: new Prisma.Decimal(m.quantity) }));

const unicos = (ids: (string | null | undefined)[] | undefined) =>
  Array.from(new Set((ids ?? []).filter((x): x is string => Boolean(x))));

/**
 * Se llama al final de una transacción, después de escribir y antes de que se confirme: si algo
 * queda en rojo tira `UserError` y la transacción entera se deshace.
 *
 * El "antes" se lee con el cliente global y el "después" con el de la transacción. Postgres no deja
 * ver lo que una transacción todavía no confirmó, así que el global ve la base como estaba antes de
 * empezar: no hace falta sacar una foto al principio, que además obligaría a saber de antemano qué
 * insumos toca una producción.
 *
 * `cuentas` acepta cualquier cuenta y se queda con las de tesorería: así quien llama puede pasar la
 * cuenta del movimiento sin preguntarse si es una caja.
 */
export async function asegurarSinNegativos(
  tx: Prisma.TransactionClient,
  que: {
    cuentas?: (string | null)[];
    insumos?: (string | null)[];
    productos?: (string | null)[];
    /** Cajas sueltas, por caja. */
    cajas?: (string | null)[];
  }
) {
  const cuentas = unicos(que.cuentas);
  const insumos = unicos(que.insumos);
  const productos = unicos(que.productos);
  const cajas = unicos(que.cajas);

  if (cuentas.length > 0) {
    const cajas = await tx.account.findMany({
      where: { id: { in: cuentas }, entity: { type: "TESORERIA" } },
      include: { entity: { select: { name: true } } },
    });
    for (const caja of cajas) {
      const [antes, despues] = await Promise.all([filasDeCuenta(prisma, caja.id), filasDeCuenta(tx, caja.id)]);
      const rojo = primerRojo(antes, despues, TOLERANCIA_PLATA);
      if (rojo) throw errorDeCaja(caja.entity.name, rojo);
    }
  }

  if (insumos.length > 0) {
    // Los que no llevan stock —el jabón— no se cuentan: su saldo no significa nada.
    const items = await tx.item.findMany({
      where: { id: { in: insumos }, llevaStock: true },
      select: { id: true, name: true, unit: true },
    });
    for (const item of items) {
      const [antes, despues] = await Promise.all([filasDeInsumo(prisma, item.id), filasDeInsumo(tx, item.id)]);
      const rojo = primerRojo(antes, despues, TOLERANCIA_STOCK);
      if (rojo) {
        throw new UserError(
          `No hay suficiente ${item.name}: el ${formatFecha(rojo.date)} el stock quedaría en ${formatQuantity(rojo.saldo, item.unit)}. Si entró y todavía no está cargado, cargá primero el ingreso.`
        );
      }
    }
  }

  if (productos.length > 0) {
    const prods = await tx.product.findMany({
      where: { id: { in: productos } },
      select: { id: true, name: true, oilType: true, presentation: true },
    });
    for (const p of prods) {
      const [antes, despues] = await Promise.all([filasDeProducto(prisma, p.id), filasDeProducto(tx, p.id)]);
      const rojo = primerRojo(antes, despues, TOLERANCIA_STOCK);
      if (rojo) {
        throw new UserError(
          `No hay suficiente ${p.name} ${p.oilType} ${p.presentation}: el ${formatFecha(rojo.date)} quedaría en ${formatQuantity(rojo.saldo)} pallets. Revisá que esté cargada la producción.`
        );
      }
    }
  }

  if (cajas.length > 0) {
    const filas = await tx.caja.findMany({ where: { id: { in: cajas } } });
    for (const c of filas) {
      const [antes, despues] = await Promise.all([filasDeCaja(prisma, c.id), filasDeCaja(tx, c.id)]);
      const rojo = primerRojo(antes, despues, TOLERANCIA_STOCK);
      if (rojo) {
        throw new UserError(
          `No hay suficientes cajas sueltas de ${c.name} ${c.oilType} ${c.unitsPerBox}x${formatQuantity(c.bottleCapacityMl)}: el ${formatFecha(rojo.date)} quedarían ${formatQuantity(rojo.saldo)}. Revisá que estén cargadas las cajas que hizo producción o el desarmado del pallet.`
        );
      }
    }
  }
}

/**
 * La misma verificación para una caja, pero **antes** de escribir: se simula el movimiento.
 *
 * Es para los pagos, que se graban en dos pasos —el pago y después su movimiento de caja— y no
 * dentro de una sola transacción. Verificar al final dejaría el pago ya grabado y sin caja si la
 * plata no alcanza; verificando antes, no se escribe nada.
 *
 * `quitar` son los movimientos que la operación va a borrar —el del mismo pago, al editarlo— y
 * `agregar` el que va a crear, con el signo con que afecta a la caja.
 */
export async function asegurarCajaAlcanza(
  accountId: string,
  cambio: { quitar?: string[]; agregar?: { date: Date; monto: Prisma.Decimal } | null }
) {
  const caja = await prisma.account.findUnique({
    where: { id: accountId },
    include: { entity: { select: { name: true, type: true } } },
  });
  if (!caja || caja.entity.type !== "TESORERIA") return;

  const antes = await filasDeCuenta(prisma, accountId);
  const quitar = new Set(cambio.quitar ?? []);
  const despues = antes.filter((f) => !quitar.has(f.id));
  if (cambio.agregar) {
    despues.push({
      id: "~nuevo",
      inicial: false,
      date: cambio.agregar.date,
      // Se carga ahora, así que va último entre los del mismo día: igual que cuando se grabe.
      createdAt: new Date(),
      monto: cambio.agregar.monto,
    });
  }
  const rojo = primerRojo(antes, despues, TOLERANCIA_PLATA);
  if (rojo) throw errorDeCaja(caja.entity.name, rojo);
}

function errorDeCaja(nombre: string, rojo: { date: Date; saldo: Prisma.Decimal }) {
  return new UserError(
    `${nombre} no tiene esa plata: el ${formatFecha(rojo.date)} quedaría en ${formatMoney(rojo.saldo)}. Si entró plata que todavía no está cargada, cargala primero.`
  );
}
