"use server";

import { UserError } from "@/lib/user-error";
import { parseFecha } from "@/lib/period";
import { revalidatePath } from "next/cache";
import type { Prisma, ProductMovementType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { formatQuantity, parseNumeroEscrito, toDecimal } from "@/lib/money";
import { formatProductBrandLabel } from "@/lib/product-label";
import { PRODUCT_MOVEMENT_TYPE_LABELS } from "@/lib/labels";
import { getSetting } from "@/lib/settings";
import { diffDeCampos, logAudit } from "@/lib/audit";
import { cajaDelProducto, enteroNoNegativo } from "@/lib/cajas";
import { buildRecipeTemplate } from "@/lib/recipe-template";

function parseOptionalInt(value: FormDataEntryValue | null): number | null {
  const str = String(value || "").trim();
  if (!str) return null;
  const n = parseInt(str, 10);
  return Number.isFinite(n) ? n : null;
}

/** Lo que se mira de un producto en el detalle de Actividad. */
const CAMPOS_DEL_PRODUCTO = {
  name: "Nombre",
  oilType: "Tipo de aceite",
  presentation: "Presentaci\u00f3n",
  boxesPerPallet: "Cajas por pallet",
  unitsPerBox: "Botellas por caja",
  bottleCapacityMl: "Capacidad (ml)",
} as const;

export async function updateProduct(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const productId = String(formData.get("productId") || "");
  const name = String(formData.get("name") || "").trim();
  const oilType = String(formData.get("oilType") || "").trim();
  const presentation = String(formData.get("presentation") || "").trim();
  const boxesPerPallet = parseOptionalInt(formData.get("boxesPerPallet"));
  const unitsPerBox = parseOptionalInt(formData.get("unitsPerBox"));
  const bottleCapacityMlRaw = String(formData.get("bottleCapacityMl") || "").trim();

  if (!productId) throw new UserError("Falta el producto.");
  if (!name) throw new UserError("El nombre es obligatorio.");
  if (!oilType) throw new UserError("El tipo de aceite es obligatorio.");
  if (!presentation) throw new UserError("La presentación es obligatoria.");
  const bottleCapacityMl = bottleCapacityMlRaw
    ? parseNumeroEscrito(bottleCapacityMlRaw, "capacidad de la botella")
    : null;

  const antes = await prisma.product.findUnique({ where: { id: productId } });

  const product = await prisma.product.update({
    where: { id: productId },
    data: {
      name,
      oilType,
      presentation,
      boxesPerPallet,
      unitsPerBox,
      bottleCapacityMl,
    },
  });

  await logAudit(prisma, {
    userId: user.id,
    action: "UPDATE",
    entityType: "Producto",
    entityId: productId,
    summary: `${name} ${oilType} — ${presentation}`,
    cambios: diffDeCampos(antes, product, CAMPOS_DEL_PRODUCTO),
  });

  revalidatePath(`/produccion/${product.slug}`);
  revalidatePath("/produccion");
}

/**
 * Las recetas las toca sólo el admin: lo que dicen es lo que se descuenta de insumos en cada
 * producción, y un cambio equivocado no avisa nada — aparece semanas después contando el stock.
 */
const QUIEN_EDITA_RECETAS = ["ADMIN"] as const;

/**
 * Vuelve la receta a la que se arma sola desde la marca y el formato, descartando lo que se le
 * haya cambiado a mano. Para cuando se tocó de más, o cuando se cargó una etiqueta propia que antes
 * no existía y la receta seguía con la prestada.
 */
export async function restaurarRecetaAutomatica(formData: FormData) {
  const user = await requireRole([...QUIEN_EDITA_RECETAS]);

  const productId = String(formData.get("productId") || "");
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { recipe: { include: { item: true } } },
  });
  if (!product) throw new UserError("El producto ya no existe.");

  const [marca, formato] = await Promise.all([
    prisma.marca.findUnique({ where: { name_oilType: { name: product.name, oilType: product.oilType } } }),
    prisma.formato.findUnique({ where: { presentation: product.presentation } }),
  ]);
  if (!marca) throw new UserError(`No está la marca ${product.name} ${product.oilType} en el catálogo.`);
  if (!formato) throw new UserError(`No está el formato ${product.presentation} en el catálogo.`);

  const efficiencyPercent = toDecimal(await getSetting("oilFillEfficiencyPercent", "100"));
  const nueva = await prisma.$transaction(async (tx) => {
    const lineas = await buildRecipeTemplate(tx, marca, formato, efficiencyPercent);
    await tx.recipeItem.deleteMany({ where: { productId } });
    await tx.recipeItem.createMany({ data: lineas.map((l) => ({ ...l, productId })) });
    return tx.recipeItem.findMany({ where: { productId }, include: { item: true } });
  });

  const antes = new Map(product.recipe.map((r) => [r.item.name, r.quantityPerUnit.toString()]));
  const despues = new Map(nueva.map((r) => [r.item.name, r.quantityPerUnit.toString()]));
  const cambios = [...new Set([...antes.keys(), ...despues.keys()])]
    .filter((nombre) => antes.get(nombre) !== despues.get(nombre))
    .map((nombre) => ({ campo: nombre, antes: antes.get(nombre) ?? null, despues: despues.get(nombre) ?? null }));

  await logAudit(prisma, {
    userId: user.id,
    action: "UPDATE",
    entityType: "Receta",
    entityId: productId,
    summary: `Receta de ${formatProductBrandLabel(product)} ${product.presentation} vuelta a la automática`,
    cambios,
  });

  revalidatePath(`/produccion/${product.slug}`);
  revalidatePath("/produccion");
}

/** Cambia una línea de la receta: otro insumo, otra cantidad, o las dos. */
export async function updateRecipeLine(formData: FormData) {
  const user = await requireRole([...QUIEN_EDITA_RECETAS]);

  const recipeItemId = String(formData.get("recipeItemId") || "");
  const itemId = String(formData.get("itemId") || "");
  const cantidadRaw = String(formData.get("quantityPerUnit") || "").trim();
  if (!recipeItemId || !itemId) throw new UserError("Faltan datos.");
  if (!cantidadRaw) throw new UserError("Falta la cantidad por pallet.");
  const quantityPerUnit = parseNumeroEscrito(cantidadRaw, "cantidad por pallet");
  if (!quantityPerUnit.greaterThan(0)) throw new UserError("La cantidad por pallet tiene que ser mayor a cero.");

  const linea = await prisma.recipeItem.findUnique({
    where: { id: recipeItemId },
    include: { item: true, product: { select: { id: true, slug: true } } },
  });
  if (!linea) throw new UserError("Esa línea de la receta ya no existe.");
  const item = await prisma.item.findUnique({ where: { id: itemId } });
  if (!item) throw new UserError("El insumo elegido ya no existe.");
  if (!item.llevaStock) {
    throw new UserError(`"${item.name}" no lleva stock: ponerlo en la receta anotaría un consumo que no descuenta de ningún lado.`);
  }
  if (itemId !== linea.itemId) {
    const repetido = await prisma.recipeItem.findUnique({
      where: { productId_itemId: { productId: linea.productId, itemId } },
    });
    if (repetido) throw new UserError(`"${item.name}" ya está en la receta: cambiá esa línea en vez de esta.`);
  }

  await prisma.recipeItem.update({ where: { id: recipeItemId }, data: { itemId, quantityPerUnit } });

  await logAudit(prisma, {
    userId: user.id,
    action: "UPDATE",
    entityType: "Receta",
    entityId: linea.productId,
    summary: itemId === linea.itemId ? `${item.name} — ${cantidadRaw} por pallet` : `${linea.item.name} → ${item.name}`,
    cambios: [
      ...(itemId !== linea.itemId ? [{ campo: "Insumo", antes: linea.item.name, despues: item.name }] : []),
      ...(!quantityPerUnit.equals(linea.quantityPerUnit)
        ? [{ campo: `${item.name} por pallet`, antes: linea.quantityPerUnit.toString(), despues: quantityPerUnit.toString() }]
        : []),
    ],
  });

  revalidatePath(`/produccion/${linea.product.slug}`);
  revalidatePath("/produccion");
}

export async function upsertRecipeLine(formData: FormData) {
  const user = await requireRole([...QUIEN_EDITA_RECETAS]);

  const productId = String(formData.get("productId") || "");
  const itemId = String(formData.get("itemId") || "");
  const quantityPerUnitRaw = String(formData.get("quantityPerUnit") || "").trim();

  if (!productId || !itemId) throw new UserError("Faltan datos.");
  if (!quantityPerUnitRaw) throw new UserError("Falta la cantidad por unidad.");

  const quantityPerUnit = parseNumeroEscrito(quantityPerUnitRaw, "cantidad por unidad");
  if (!quantityPerUnit.greaterThan(0)) {
    throw new UserError("La cantidad por unidad debe ser mayor a cero.");
  }

  const [item, product] = await Promise.all([
    prisma.item.findUnique({ where: { id: itemId } }),
    prisma.product.findUnique({ where: { id: productId }, select: { slug: true } }),
  ]);
  if (!item) throw new UserError("El insumo elegido ya no existe.");
  if (!item.llevaStock) {
    throw new UserError(`"${item.name}" no lleva stock: ponerlo en la receta anotaría un consumo que no descuenta de ningún lado.`);
  }

  // Lo que había antes para ese insumo, que es lo único que cambia: si no existía, es un alta.
  const anterior = await prisma.recipeItem.findUnique({
    where: { productId_itemId: { productId, itemId } },
    select: { quantityPerUnit: true },
  });

  await prisma.recipeItem.upsert({
    where: { productId_itemId: { productId, itemId } },
    update: { quantityPerUnit },
    create: { productId, itemId, quantityPerUnit },
  });

  await logAudit(prisma, {
    userId: user.id,
    action: "UPDATE",
    entityType: "Receta",
    entityId: productId,
    summary: `${item?.name ?? "Insumo"} — ${quantityPerUnitRaw} por unidad`,
    cambios: [
      {
        campo: `${item?.name ?? "Insumo"} por unidad`,
        antes: anterior ? anterior.quantityPerUnit.toString() : null,
        despues: quantityPerUnit.toString(),
      },
    ],
  });

  revalidatePath(`/produccion/${product?.slug ?? productId}`);
  revalidatePath("/produccion");
}

export async function deleteRecipeLine(formData: FormData) {
  const user = await requireRole([...QUIEN_EDITA_RECETAS]);

  const recipeItemId = String(formData.get("recipeItemId") || "");
  if (!recipeItemId) throw new UserError("Falta el ítem de receta.");

  const recipeItem = await prisma.recipeItem.findUnique({
    where: { id: recipeItemId },
    include: { item: true, product: { select: { slug: true } } },
  });
  if (!recipeItem) throw new UserError("Esa línea de la receta ya no existe.");

  await prisma.recipeItem.delete({ where: { id: recipeItemId } });

  await logAudit(prisma, {
    userId: user.id,
    action: "DELETE",
    entityType: "Receta",
    entityId: recipeItem.productId,
    summary: recipeItem.item.name,
    cambios: [
      {
        campo: `${recipeItem.item.name} por pallet`,
        antes: recipeItem.quantityPerUnit.toString(),
        despues: null,
      },
    ],
  });

  revalidatePath(`/produccion/${recipeItem.product.slug}`);
  revalidatePath("/produccion");
}

/** Lo que dice el formulario de un ajuste o una merma de producto, ya con su signo. */
function leerMovimientoDeProducto(formData: FormData) {
  const type = String(formData.get("type") || "") as ProductMovementType;
  if (type !== "AJUSTE" && type !== "MERMA") {
    throw new UserError(
      "Desde acá sólo se cargan ajustes y mermas. Lo producido se carga en Producción, y lo entregado en el remito."
    );
  }

  const fechaRaw = String(formData.get("date") || "");
  if (!fechaRaw) throw new UserError("Falta la fecha.");
  const date = parseFecha(fechaRaw);

  const reason = String(formData.get("reason") || "").trim();
  if (!reason) throw new UserError("El motivo es obligatorio.");

  let quantity = parseNumeroEscrito(String(formData.get("quantity") || ""), "cantidad");
  if (quantity.isZero()) throw new UserError("La cantidad no puede ser cero.");
  // Pallets o cajas sueltas, siempre enteros: no existe medio pallet ni media caja.
  const enCajas = formData.get("unidad") === "CAJAS";
  enteroNoNegativo(quantity.abs(), enCajas ? "Cajas sueltas" : "Pallets");
  // Una merma siempre resta; un ajuste lo decide el formulario.
  if (type === "MERMA" || String(formData.get("effect") || "") === "RESTA") {
    quantity = quantity.abs().negated();
  } else {
    quantity = quantity.abs();
  }
  return { type, date, reason, quantity, enCajas };
}

async function crearMovimientoDeProducto(
  tx: Prisma.TransactionClient,
  product: Parameters<typeof cajaDelProducto>[1],
  m: ReturnType<typeof leerMovimientoDeProducto>,
  userId: string
) {
  if (m.enCajas) {
    // Las cajas sueltas son de la caja, que comparten todos los formatos de la misma botella.
    const cajaId = await cajaDelProducto(tx, product);
    await tx.cajaMovement.create({
      data: { cajaId, date: m.date, quantity: m.quantity.toNumber(), type: m.type, reason: m.reason, createdById: userId },
    });
  } else {
    await tx.productMovement.create({
      data: { productId: product.id, date: m.date, quantity: m.quantity, type: m.type, reason: m.reason, createdById: userId },
    });
  }
}

function fotoDelAjuste(
  product: { name: string; oilType: string; presentation: string },
  m: { type: ProductMovementType; date: Date; quantity: Prisma.Decimal | number; reason: string; enCajas: boolean }
) {
  return {
    tipo: PRODUCT_MOVEMENT_TYPE_LABELS[m.type],
    producto: `${formatProductBrandLabel(product)} ${product.presentation}`,
    date: m.date,
    quantity: `${formatQuantity(m.quantity)} ${m.enCajas ? "cajas sueltas" : "pallets"}`,
    reason: m.reason,
  };
}
const CAMPOS_DEL_AJUSTE = { tipo: "Tipo", producto: "Producto", date: "Fecha", quantity: "Cantidad", reason: "Motivo" } as const;

/**
 * Un movimiento de stock del producto terminado, a mano: el ajuste después de contar unos pallets,
 * o la merma por una rotura.
 *
 * **No toca los insumos**, y eso es lo que lo distingue de cargar una producción: acá el pallet ya
 * existía —lo envasamos antes de usar la app, o la diferencia salió de un conteo—, así que
 * descontar el aceite y los envases sería inventar un consumo.
 *
 * **Solo Admin**: es la única forma de cambiar el stock de un producto sin que haya pasado nada
 * físico. Lo mismo para corregirlo o borrarlo.
 */
export async function createProductMovement(formData: FormData) {
  const user = await requireRole(["ADMIN"]);

  const productId = String(formData.get("productId") || "");
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new UserError("El producto ya no existe.");
  const m = leerMovimientoDeProducto(formData);

  await prisma.$transaction((tx) => crearMovimientoDeProducto(tx, product, m, user.id));

  await logAudit(prisma, {
    userId: user.id,
    action: "CREATE",
    entityType: "Movimiento de producto",
    entityId: productId,
    summary: `${PRODUCT_MOVEMENT_TYPE_LABELS[m.type]} — ${formatProductBrandLabel(product)} ${product.presentation} — ${m.quantity.greaterThan(0) ? "+" : ""}${formatQuantity(m.quantity)} ${m.enCajas ? "cajas sueltas" : "pallets"}`,
    cambios: diffDeCampos(null, fotoDelAjuste(product, m), CAMPOS_DEL_AJUSTE),
  });

  revalidatePath(`/produccion/${product.slug}`);
  revalidatePath("/produccion");
  revalidatePath("/stock");
}

/**
 * El ajuste o la merma a corregir o borrar: sólo los cargados a mano. Lo que vino de una producción
 * o de un remito se corrige ahí, que es lo que lo generó.
 */
async function ajusteManual(formData: FormData) {
  const movementId = String(formData.get("movementId") || "");
  const enCajas = formData.get("kind") === "CAJAS";
  const productId = String(formData.get("productId") || "");
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new UserError("El producto ya no existe.");
  const mov = enCajas
    ? await prisma.cajaMovement.findUnique({ where: { id: movementId } })
    : await prisma.productMovement.findUnique({ where: { id: movementId } });
  if (!mov) throw new UserError("El movimiento ya no existe.");
  if ((mov.type !== "AJUSTE" && mov.type !== "MERMA") || mov.productionLineId || mov.documentLineId) {
    throw new UserError("Este movimiento lo generó una producción o un remito: corregilo ahí.");
  }
  return {
    product,
    movementId,
    anterior: { type: mov.type as ProductMovementType, date: mov.date, quantity: mov.quantity, reason: mov.reason, enCajas },
  };
}

export async function editarMovimientoDeProducto(formData: FormData) {
  const user = await requireRole(["ADMIN"]);
  const { product, movementId, anterior } = await ajusteManual(formData);
  const m = leerMovimientoDeProducto(formData);

  // Se reemplaza entero: puede haber pasado de pallets a cajas sueltas, que son otra tabla.
  await prisma.$transaction(async (tx) => {
    if (anterior.enCajas) await tx.cajaMovement.delete({ where: { id: movementId } });
    else await tx.productMovement.delete({ where: { id: movementId } });
    await crearMovimientoDeProducto(tx, product, m, user.id);
    await logAudit(tx, {
      userId: user.id,
      action: "UPDATE",
      entityType: "Movimiento de producto",
      entityId: product.id,
      summary: `${PRODUCT_MOVEMENT_TYPE_LABELS[m.type]} — ${formatProductBrandLabel(product)} ${product.presentation} — corregido`,
      cambios: diffDeCampos(fotoDelAjuste(product, anterior), fotoDelAjuste(product, m), CAMPOS_DEL_AJUSTE),
    });
  });

  revalidatePath(`/produccion/${product.slug}`);
  revalidatePath("/produccion");
  revalidatePath("/stock");
}

export async function borrarMovimientoDeProducto(formData: FormData) {
  const user = await requireRole(["ADMIN"]);
  const { product, movementId, anterior } = await ajusteManual(formData);

  await prisma.$transaction(async (tx) => {
    if (anterior.enCajas) await tx.cajaMovement.delete({ where: { id: movementId } });
    else await tx.productMovement.delete({ where: { id: movementId } });
    await logAudit(tx, {
      userId: user.id,
      action: "DELETE",
      entityType: "Movimiento de producto",
      entityId: product.id,
      summary: `${PRODUCT_MOVEMENT_TYPE_LABELS[anterior.type]} — ${formatProductBrandLabel(product)} ${product.presentation} — borrado`,
      cambios: diffDeCampos(fotoDelAjuste(product, anterior), null, CAMPOS_DEL_AJUSTE),
    });
  });

  revalidatePath(`/produccion/${product.slug}`);
  revalidatePath("/produccion");
  revalidatePath("/stock");
}
