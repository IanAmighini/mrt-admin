"use server";

import { UserError } from "@/lib/user-error";
import { formatFecha, parseFecha } from "@/lib/period";
import { revalidatePath } from "next/cache";
import { Prisma, type AuditAction, type SupplierCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { parseNumeroEscrito, toDecimal } from "@/lib/money";
import { getSetting, setSetting } from "@/lib/settings";
import { resolveOrCreateProduct } from "@/lib/products";
import { syncPedidoStatuses } from "@/lib/pedidos";
import { diffDeCampos, logAudit } from "@/lib/audit";
import { asegurarSinNegativos } from "@/lib/sin-negativos";
import { cajaDelProducto, enteroNoNegativo, recetaPorCaja } from "@/lib/cajas";
import { formatNumeroExacto } from "@/lib/money";

function parseFormDate(value: FormDataEntryValue | null): Date {
  const str = String(value || "");
  if (!str) throw new UserError("Falta la fecha.");
  return parseFecha(str);
}

/** Lo que se mira de una carga de producción en el detalle de Actividad. */
const CAMPOS_DE_LA_PRODUCCION = {
  date: "Fecha",
  notes: "Notas",
  renglones: "L\u00edneas",
} as const;

/**
 * La carga de producción tal como quedó.
 *
 * Las líneas van juntas en un solo campo porque una edición las borra y las reescribe: no tienen
 * identidad que permita decir "la línea 2 cambió".
 */
async function fotoDeLaProduccion(tx: Prisma.TransactionClient, runId: string) {
  const run = await tx.productionRun.findUnique({
    where: { id: runId },
    include: { lines: { include: { product: { select: { name: true, presentation: true } } } } },
  });
  if (!run) return null;
  const QUE: Record<string, string> = { PALLETS: "pallets", CAJAS: "cajas sueltas", ARMADO: "pallets armados", DESARMADO: "pallets desarmados" };
  return {
    date: run.date,
    notes: run.notes,
    renglones: run.lines
      .map((l) => `${l.product.name} ${l.product.presentation} \u00d7 ${formatNumeroExacto(l.quantity)} ${QUE[l.tipo]}`)
      .join("\n"),
  };
}

export async function updateOilEfficiency(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const value = String(formData.get("oilFillEfficiencyPercent") || "").trim();
  const num = parseNumeroEscrito(value, "rendimiento");
  if (!num.greaterThan(0) || num.greaterThan(100)) {
    throw new UserError("La eficiencia debe ser un porcentaje entre 0 y 100.");
  }

  const antesDelPorcentaje = await getSetting("oilFillEfficiencyPercent", "100");
  await setSetting("oilFillEfficiencyPercent", num.toString());

  await logAudit(prisma, {
    userId: user.id,
    action: "UPDATE",
    entityType: "Configuración",
    summary: `Eficiencia de llenado de aceite — ${value}%`,
    cambios: [
      { campo: "Eficiencia de llenado", antes: `${antesDelPorcentaje}%`, despues: `${num.toString()}%` },
    ],
  });

  revalidatePath("/produccion");
}

/** Lo que se puede indicar que se usó en lugar de lo que dice la receta, y cómo se nombra. */
const REEMPLAZABLE = {
  TAPAS: { rol: "tapa", uno: "una" },
  CAJAS: { rol: "caja", uno: "una" },
  ETIQUETAS: { rol: "etiqueta", uno: "una" },
  ACEITE: { rol: "aceite", uno: "un" },
} as const satisfies Partial<Record<SupplierCategory, { rol: string; uno: string }>>;

/**
 * Lo que una fila de producción consume de cada insumo, aplicando los reemplazos: la receta dice
 * CUÁNTO, el reemplazo sólo cambia DE QUÉ insumo sale (la tapa amarilla en vez de la roja).
 */
type FilaDeReceta = {
  itemId: string;
  cantidad: Prisma.Decimal;
  item: { name: string; category: SupplierCategory };
};

async function consumirInsumos(
  tx: Prisma.TransactionClient,
  params: {
    filas: FilaDeReceta[];
    reemplazoPorCategoria: Partial<Record<SupplierCategory, string>>;
    productionLineId: string;
    date: Date;
    motivo: string;
    userId: string;
  }
) {
  await tx.itemMovement.createMany({
    data: params.filas.map((r) => {
      const reemplazo = params.reemplazoPorCategoria[r.item.category];
      const usado = reemplazo && reemplazo !== r.itemId ? reemplazo : null;
      return {
        itemId: usado ?? r.itemId,
        date: params.date,
        quantity: r.cantidad.negated(),
        type: "CONSUMO_PRODUCCION" as const,
        // Que hubo reemplazo queda en el texto, que es lo que ya se ve en el kardex.
        reason: usado ? `${params.motivo} — en lugar de ${r.item.name}` : params.motivo,
        productionLineId: params.productionLineId,
        createdById: params.userId,
      };
    }),
  });
}

/** Núcleo compartido por createProductionRun y updateProductionRun — así una edición queda como un
 * solo UPDATE en el log, no un DELETE + CREATE. */
async function createProductionRunCore(
  user: { id: string },
  formData: FormData,
  auditAction: AuditAction,
  /** Al editar: la corrida que esta reemplaza. Se borra DENTRO de la transacción, ver updateProductionRun. */
  replaceRunId?: string,
  /** Cómo estaba esa corrida antes de reemplazarla. Vacío en un alta. */
  antes?: Awaited<ReturnType<typeof fotoDeLaProduccion>>
) {
  const date = parseFormDate(formData.get("date"));
  const notes = String(formData.get("notes") || "").trim() || null;
  const dateLabel = formatFecha(date);

  // ---------- Lo producido: pallets terminados y cajas sueltas, por marca y formato
  const marcaIds = formData.getAll("marcaId").map(String);
  const formatoIds = formData.getAll("formatoId").map(String);
  const palletsRaw = formData.getAll("quantity").map(String);
  const cajasRaw = formData.getAll("cajasSueltas").map(String);
  const tapaUsadaIds = formData.getAll("tapaUsadaItemId").map(String);
  const cajaUsadaIds = formData.getAll("cajaUsadaItemId").map(String);
  const etiquetaUsadaIds = formData.getAll("etiquetaUsadaItemId").map(String);
  const aceiteUsadoIds = formData.getAll("aceiteUsadoItemId").map(String);

  // Los campos del formulario llegan como arrays paralelos que se aparean por posición. Si alguno
  // viniera con distinto largo, los reemplazos caerían en la fila equivocada y descontarían del
  // insumo que no era, sin que nadie lo note. Mejor romper fuerte.
  if (
    [formatoIds, palletsRaw, cajasRaw, tapaUsadaIds, cajaUsadaIds, etiquetaUsadaIds, aceiteUsadoIds].some(
      (arr) => arr.length !== marcaIds.length
    )
  ) {
    throw new UserError("El formulario llegó incompleto — recargá la página y volvé a cargar la producción.");
  }

  const producido = marcaIds
    .map((marcaId, i) => ({
      fila: i + 1,
      marcaId,
      formatoId: formatoIds[i] || "",
      palletsRaw: (palletsRaw[i] ?? "").trim(),
      cajasRaw: (cajasRaw[i] ?? "").trim(),
      tapaUsadaItemId: tapaUsadaIds[i] || "",
      cajaUsadaItemId: cajaUsadaIds[i] || "",
      etiquetaUsadaItemId: etiquetaUsadaIds[i] || "",
      aceiteUsadoItemId: aceiteUsadoIds[i] || "",
    }))
    // La fila vacía que queda al tocar "+ Agregar" y no completarla no corta la carga.
    .filter((l) => l.marcaId || l.formatoId || l.palletsRaw || l.cajasRaw)
    .map((l) => {
      if (!l.marcaId || !l.formatoId) throw new UserError(`Ítem ${l.fila}: elegí la marca y el formato.`);
      // **Las dos son obligatorias**, aunque sea 0. Producción informa pallets terminados y se
      // olvidaba de las cajas que armó para completar un pallet o para quien retira sólo cajas;
      // pedirlas siempre es lo que hace que las informe.
      if (!l.palletsRaw || !l.cajasRaw) {
        throw new UserError(
          `Ítem ${l.fila}: indicá los pallets terminados y las cajas sueltas que se hicieron — 0 si no hubo.`
        );
      }
      return {
        ...l,
        pallets: enteroNoNegativo(parseNumeroEscrito(l.palletsRaw, "pallets"), `Ítem ${l.fila}, pallets terminados`),
        cajas: enteroNoNegativo(parseNumeroEscrito(l.cajasRaw, "cajas sueltas"), `Ítem ${l.fila}, cajas sueltas`),
      };
    })
    .filter((l) => l.pallets > 0 || l.cajas > 0);

  // ---------- Armado y desarmado de pallets, con cajas que ya estaban hechas
  const armMarcaIds = formData.getAll("armadoMarcaId").map(String);
  const armFormatoIds = formData.getAll("armadoFormatoId").map(String);
  const armAcciones = formData.getAll("armadoAccion").map(String);
  const armPallets = formData.getAll("armadoPallets").map(String);
  if ([armFormatoIds, armAcciones, armPallets].some((arr) => arr.length !== armMarcaIds.length)) {
    throw new UserError("El formulario llegó incompleto — recargá la página y volvé a cargar la producción.");
  }
  const armados = armMarcaIds
    .map((marcaId, i) => ({
      fila: i + 1,
      marcaId,
      formatoId: armFormatoIds[i] || "",
      accion: armAcciones[i] === "DESARMADO" ? ("DESARMADO" as const) : ("ARMADO" as const),
      palletsRaw: (armPallets[i] ?? "").trim(),
    }))
    .filter((a) => a.marcaId || a.formatoId || a.palletsRaw)
    .map((a) => {
      if (!a.marcaId || !a.formatoId || !a.palletsRaw) {
        throw new UserError(`Armado ${a.fila}: elegí la marca, el formato y cuántos pallets.`);
      }
      return { ...a, pallets: enteroNoNegativo(parseNumeroEscrito(a.palletsRaw, "pallets"), `Armado ${a.fila}, pallets`) };
    })
    .filter((a) => a.pallets > 0);

  if (producido.length === 0 && armados.length === 0) {
    throw new UserError("Cargá al menos un ítem: pallets o cajas sueltas que se hicieron, o un pallet armado o desarmado.");
  }

  // Los reemplazos se validan contra la base y no solo con el filtro del desplegable: un POST
  // armado a mano podría, si no, descontar tapas del aceite.
  const reemplazoIds = Array.from(
    new Set(producido.flatMap((l) => [l.tapaUsadaItemId, l.cajaUsadaItemId, l.etiquetaUsadaItemId, l.aceiteUsadoItemId]).filter(Boolean))
  );
  const reemplazos = reemplazoIds.length
    ? await prisma.item.findMany({ where: { id: { in: reemplazoIds } }, select: { id: true, name: true, category: true } })
    : [];
  const reemplazoPorId = new Map(reemplazos.map((i) => [i.id, i]));
  for (const line of producido) {
    for (const [itemId, categoria] of [
      [line.tapaUsadaItemId, "TAPAS"],
      [line.cajaUsadaItemId, "CAJAS"],
      [line.etiquetaUsadaItemId, "ETIQUETAS"],
      [line.aceiteUsadoItemId, "ACEITE"],
    ] as const) {
      if (!itemId) continue;
      const item = reemplazoPorId.get(itemId);
      const { rol, uno } = REEMPLAZABLE[categoria];
      if (!item) throw new UserError(`El insumo elegido como ${rol} ${categoria === "ACEITE" ? "usado" : "usada"} ya no existe.`);
      if (item.category !== categoria) throw new UserError(`"${item.name}" no es ${uno} ${rol}.`);
    }
  }

  // Lo necesita la receta que se arma sola al crear un producto nuevo. Se lee acá y no adentro de
  // la transacción para no gastarle una consulta a cada línea.
  const oilFillEfficiencyPercent = toDecimal(await getSetting("oilFillEfficiencyPercent", "100"));

  await prisma.$transaction(async (tx) => {
    // Borrar acá adentro y no antes: si el alta falla, la corrida original tiene que seguir
    // existiendo. Las líneas y sus movimientos de producto, cajas e insumos se van en cascada.
    if (replaceRunId) await tx.productionRun.delete({ where: { id: replaceRunId } });

    const run = await tx.productionRun.create({ data: { date, notes, createdById: user.id } });

    for (const line of producido) {
      const product = await resolveOrCreateProduct(tx, line.marcaId, line.formatoId, oilFillEfficiencyPercent);
      const nombre = `${product.name} ${product.oilType} ${product.presentation}`;

      // Los productos nuevos nacen con receta, pero los que se crearon antes de que eso existiera
      // pueden no tenerla. Envasar sin receta no descuenta un solo insumo y no avisa nada: el
      // faltante recién aparece cuando alguien cuenta el stock físico. Mejor no dejar cargar.
      if (product.recipe.length === 0) {
        throw new UserError(
          `${nombre} no tiene receta cargada, así que producirlo no descontaría ningún insumo. Cargala desde la ficha del producto.`
        );
      }

      const reemplazoPorCategoria: Partial<Record<SupplierCategory, string>> = {
        ...(line.tapaUsadaItemId ? { TAPAS: line.tapaUsadaItemId } : {}),
        ...(line.cajaUsadaItemId ? { CAJAS: line.cajaUsadaItemId } : {}),
        ...(line.etiquetaUsadaItemId ? { ETIQUETAS: line.etiquetaUsadaItemId } : {}),
        ...(line.aceiteUsadoItemId ? { ACEITE: line.aceiteUsadoItemId } : {}),
      };
      for (const categoria of Object.keys(reemplazoPorCategoria) as (keyof typeof REEMPLAZABLE)[]) {
        const { rol, uno } = REEMPLAZABLE[categoria];
        const enReceta = product.recipe.filter((r) => r.item.category === categoria);
        // Aceptar la instrucción y descartarla en silencio dejaría el stock mal sin que nadie se
        // entere, así que se avisa.
        if (enReceta.length === 0) {
          throw new UserError(`${nombre} no tiene ${rol} en la receta — cargá la receta antes de indicar cuál usaste.`);
        }
        if (enReceta.length > 1) {
          throw new UserError(`${nombre} tiene más de ${uno} ${rol} en la receta — corregila antes de indicar cuál usaste.`);
        }
      }

      if (line.pallets > 0) {
        const productionLine = await tx.productionLine.create({
          data: { productionRunId: run.id, productId: product.id, quantity: line.pallets, tipo: "PALLETS" },
        });
        await tx.productMovement.create({
          data: {
            productId: product.id,
            date,
            quantity: line.pallets,
            type: "PRODUCCION",
            reason: `Producción del ${dateLabel}`,
            productionLineId: productionLine.id,
            createdById: user.id,
          },
        });
        await consumirInsumos(tx, {
          filas: product.recipe.map((r) => ({
            itemId: r.itemId,
            item: r.item,
            cantidad: new Prisma.Decimal(r.quantityPerUnit).times(line.pallets),
          })),
          reemplazoPorCategoria,
          productionLineId: productionLine.id,
          date,
          motivo: `Producción del ${dateLabel}`,
          userId: user.id,
        });
      }

      if (line.cajas > 0) {
        if (!product.boxesPerPallet) {
          throw new UserError(`${nombre} no tiene cargadas las cajas por pallet, así que no se puede saber cuánto lleva una caja.`);
        }
        const cajaId = await cajaDelProducto(tx, product);
        const productionLine = await tx.productionLine.create({
          data: { productionRunId: run.id, productId: product.id, quantity: line.cajas, tipo: "CAJAS" },
        });
        await tx.cajaMovement.create({
          data: {
            cajaId,
            date,
            quantity: line.cajas,
            type: "PRODUCCION",
            reason: `Producción del ${dateLabel}`,
            productionLineId: productionLine.id,
            createdById: user.id,
          },
        });
        // Una caja suelta lleva lo de la receta dividido por las cajas del pallet, sin el pallet de
        // madera ni el stretch, que son del pallet y no de la caja.
        await consumirInsumos(tx, {
          filas: recetaPorCaja(product.recipe, product.boxesPerPallet).map((r) => ({
            itemId: r.itemId,
            item: r.item,
            cantidad: r.porCaja.times(line.cajas),
          })),
          reemplazoPorCategoria,
          productionLineId: productionLine.id,
          date,
          motivo: `Cajas sueltas del ${dateLabel}`,
          userId: user.id,
        });
      }
    }

    // Armar y desarmar mueven pallets y cajas, y nada más: las botellas ya estaban envasadas, así
    // que no hay aceite ni envases que descontar ni que devolver. Antes se cargaba como producción
    // con pallets negativos, y eso devolvía al stock insumos que nunca se desenvasaron.
    for (const a of armados) {
      // Armar y desarmar no consumen insumos: no hace falta que el producto tenga receta.
      const product = await resolveOrCreateProduct(tx, a.marcaId, a.formatoId, oilFillEfficiencyPercent, {
        recetaOpcional: true,
      });
      const nombre = `${product.name} ${product.oilType} ${product.presentation}`;
      if (!product.boxesPerPallet) {
        throw new UserError(`${nombre} no tiene cargadas las cajas por pallet.`);
      }
      const cajaId = await cajaDelProducto(tx, product);
      const signo = a.accion === "ARMADO" ? 1 : -1;
      const productionLine = await tx.productionLine.create({
        data: { productionRunId: run.id, productId: product.id, quantity: a.pallets, tipo: a.accion },
      });
      const motivo = `${a.accion === "ARMADO" ? "Armado" : "Desarmado"} del ${dateLabel}`;
      await tx.productMovement.create({
        data: {
          productId: product.id,
          date,
          quantity: signo * a.pallets,
          type: a.accion,
          reason: motivo,
          productionLineId: productionLine.id,
          createdById: user.id,
        },
      });
      await tx.cajaMovement.create({
        data: {
          cajaId,
          date,
          quantity: -signo * a.pallets * product.boxesPerPallet,
          type: a.accion,
          reason: motivo,
          productionLineId: productionLine.id,
          createdById: user.id,
        },
      });
    }

    await syncPedidoStatuses(tx);

    // Todo lo que esta carga movió, y lo que movía la que reemplaza: el cliente global todavía la ve,
    // porque la transacción no se confirmó.
    const [movidos, anteriores] = await Promise.all([
      tx.itemMovement.findMany({ where: { productionLine: { productionRunId: run.id } }, select: { itemId: true } }),
      replaceRunId
        ? prisma.productionLine.findMany({
            where: { productionRunId: replaceRunId },
            select: { itemMovements: { select: { itemId: true } } },
          })
        : Promise.resolve([]),
    ]);
    await asegurarSinNegativos(tx, {
      insumos: [...movidos.map((m) => m.itemId), ...anteriores.flatMap((l) => l.itemMovements.map((m) => m.itemId))],
    });

    const items = producido.length + armados.length;
    await logAudit(tx, {
      userId: user.id,
      action: auditAction,
      entityType: "Producción",
      entityId: run.id,
      summary: `Producción del ${dateLabel} — ${items} ítem(s)`,
      cambios: diffDeCampos(antes ?? null, await fotoDeLaProduccion(tx, run.id), CAMPOS_DE_LA_PRODUCCION),
    });
  }, { timeout: 30000 });

  revalidatePath("/produccion");
  revalidatePath("/stock");
  revalidatePath("/pedidos");
}

export async function createProductionRun(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);
  await createProductionRunCore(user, formData, "CREATE");
}

/**
 * Editar una producción = borrar la carga existente (las líneas y los movimientos de
 * producto/insumo vinculados se van en cascada) y volver a correr el mismo núcleo con los datos
 * nuevos — mismo patrón que remitos y pedidos, pero logueando un solo UPDATE.
 */
export async function updateProductionRun(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const runId = String(formData.get("runId") || "");
  const run = await prisma.productionRun.findUnique({ where: { id: runId } });
  if (!run) throw new UserError("La carga de producción ya no existe.");

  await createProductionRunCore(user, formData, "UPDATE", runId, await fotoDeLaProduccion(prisma, runId));
}

export async function deleteProductionRun(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const runId = String(formData.get("runId") || "");
  const run = await prisma.productionRun.findUnique({ where: { id: runId } });
  if (!run) throw new UserError("La carga de producción ya no existe.");
  const antes = await fotoDeLaProduccion(prisma, runId);

  await prisma.$transaction(async (tx) => {
    // Borrar devuelve los insumos, así que no hay nada que pueda quedar en rojo. Lo producido puede
    // haberse entregado ya: el producto queda en negativo, como cuando se entrega antes de cargar.
    await tx.productionRun.delete({ where: { id: runId } });
  });

  await logAudit(prisma, {
    userId: user.id,
    action: "DELETE",
    entityType: "Producción",
    entityId: runId,
    summary: `Producción del ${formatFecha(run.date)}`,
    cambios: diffDeCampos(antes, null, CAMPOS_DE_LA_PRODUCCION),
  });

  revalidatePath("/produccion");
  revalidatePath("/stock");
}
