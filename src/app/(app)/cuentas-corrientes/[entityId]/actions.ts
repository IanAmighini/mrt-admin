"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { Prisma, type Currency, type DocumentType, type PaymentMethod } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { DEFAULT_IVA_RATE, toDecimal } from "@/lib/money";
import { allocateFifo, defaultDueDate, getDocumentEffect } from "@/lib/ledger";

const NON_FACTURA_TYPES: DocumentType[] = ["NOTA_CREDITO", "NOTA_DEBITO", "AJUSTE"];

function parseFormDate(value: FormDataEntryValue | null): Date {
  const str = String(value || "");
  if (!str) throw new Error("Falta la fecha.");
  return new Date(`${str}T00:00:00`);
}

function parseOptionalFormDate(value: FormDataEntryValue | null): Date | null {
  const str = String(value || "").trim();
  return str ? new Date(`${str}T00:00:00`) : null;
}

function parseAmount(value: FormDataEntryValue | null, field: string): Prisma.Decimal {
  const str = String(value || "").trim();
  if (!str) throw new Error(`Falta el monto: ${field}.`);
  const decimal = new Prisma.Decimal(str);
  if (decimal.isNaN()) throw new Error(`Monto inválido: ${field}.`);
  return decimal;
}

async function getAccountOrThrow(accountId: string) {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    include: { entity: true },
  });
  if (!account) throw new Error("Cuenta inexistente.");
  return account;
}

/** Edita una nota/ajuste ya cargado — campos simples, el pendiente se recalcula solo desde
 * totalAmount (no hay nada desnormalizado que tocar). */
export async function updateDocument(formData: FormData) {
  await requireRole(["ADMIN", "CARGA_DIARIA"]);

  const documentId = String(formData.get("documentId") || "");
  const document = await prisma.document.findUnique({ where: { id: documentId } });
  if (!document) throw new Error("El comprobante ya no existe.");
  if (!NON_FACTURA_TYPES.includes(document.type)) {
    throw new Error("Este comprobante no es una nota ni un ajuste.");
  }

  const type = String(formData.get("type") || "") as DocumentType;
  if (!NON_FACTURA_TYPES.includes(type)) throw new Error("Tipo de comprobante inválido.");

  const number = String(formData.get("number") || "").trim();
  if (!number) throw new Error("El número es obligatorio.");

  const date = parseFormDate(formData.get("date"));
  const dueDate = parseOptionalFormDate(formData.get("dueDate"));
  const currency = String(formData.get("currency") || "ARS") as Currency;
  const exchangeRateRaw = String(formData.get("exchangeRate") || "").trim();
  const exchangeRate = currency === "USD" && exchangeRateRaw ? new Prisma.Decimal(exchangeRateRaw) : null;

  const amount = parseAmount(formData.get("amount"), "monto");
  const reason = String(formData.get("reason") || "").trim() || null;

  if (type === "AJUSTE" && !reason) {
    throw new Error("El ajuste manual requiere un motivo.");
  }

  const ajusteEffect = String(formData.get("ajusteEffect") || "SUMA");
  const totalAmount = type === "AJUSTE" && ajusteEffect === "RESTA" ? amount.negated() : amount;

  const account = await getAccountOrThrow(document.accountId);

  await prisma.document.update({
    where: { id: documentId },
    data: { type, number, date, dueDate, currency, exchangeRate, netAmount: amount, totalAmount, reason },
  });

  revalidatePath(`/cuentas-corrientes/${account.entityId}`);
}

export async function deleteDocument(formData: FormData) {
  await requireRole(["ADMIN", "CARGA_DIARIA"]);

  const documentId = String(formData.get("documentId") || "");
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: { account: true },
  });
  if (!document) throw new Error("El comprobante ya no existe.");
  if (!NON_FACTURA_TYPES.includes(document.type)) {
    throw new Error("Este comprobante no es una nota ni un ajuste.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.paymentAllocation.deleteMany({ where: { documentId } });
    await tx.document.delete({ where: { id: documentId } });
  });

  revalidatePath(`/cuentas-corrientes/${document.account.entityId}`);
}

/**
 * Variante de createDocument para el botón "+ Movimiento" de la ficha individual: ahí no se
 * conoce el accountId de antemano (se elige la cuenta en el mismo formulario), así que se
 * resuelve acá — mismo patrón que createPaymentForEntity.
 */
export async function createDocumentForEntity(formData: FormData) {
  const user = await requireRole(["ADMIN", "CARGA_DIARIA"]);

  const entityId = String(formData.get("entityId") || "");
  if (!entityId) throw new Error("Falta el cliente o proveedor.");

  const circuit = String(formData.get("circuit") || "");
  if (circuit !== "BLANCO" && circuit !== "NEGRO") throw new Error("Cuenta inválida.");

  const account = await prisma.account.findUnique({
    where: { entityId_circuit: { entityId, circuit } },
  });
  if (!account) throw new Error("No se encontró la cuenta de esta entidad.");

  const type = String(formData.get("type") || "") as DocumentType;
  if (!NON_FACTURA_TYPES.includes(type)) throw new Error("Tipo de comprobante inválido.");

  const number = String(formData.get("number") || "").trim();
  if (!number) throw new Error("El número es obligatorio.");

  const date = parseFormDate(formData.get("date"));
  const dueDate = parseOptionalFormDate(formData.get("dueDate"));
  const currency = String(formData.get("currency") || "ARS") as Currency;
  const exchangeRateRaw = String(formData.get("exchangeRate") || "").trim();
  const exchangeRate = currency === "USD" && exchangeRateRaw ? new Prisma.Decimal(exchangeRateRaw) : null;

  const amount = parseAmount(formData.get("amount"), "monto");
  const reason = String(formData.get("reason") || "").trim() || null;

  if (type === "AJUSTE" && !reason) {
    throw new Error("El ajuste manual requiere un motivo.");
  }

  const ajusteEffect = String(formData.get("ajusteEffect") || "SUMA");
  const totalAmount = type === "AJUSTE" && ajusteEffect === "RESTA" ? amount.negated() : amount;

  await prisma.document.create({
    data: {
      accountId: account.id,
      type,
      number,
      date,
      dueDate,
      currency,
      exchangeRate,
      netAmount: amount,
      totalAmount,
      reason,
      createdById: user.id,
    },
  });

  revalidatePath(`/cuentas-corrientes/${entityId}`);
}

export async function createRemito(formData: FormData) {
  const user = await requireRole(["ADMIN", "CARGA_DIARIA"]);

  const entityId = String(formData.get("entityId") || "");
  if (!entityId) throw new Error("Falta la entidad.");

  const number = String(formData.get("number") || "").trim();
  if (!number) throw new Error("El número es obligatorio.");

  const date = parseFormDate(formData.get("date"));
  const dueDateOverride = parseOptionalFormDate(formData.get("dueDate"));
  const currency = String(formData.get("currency") || "ARS") as Currency;
  const exchangeRateRaw = String(formData.get("exchangeRate") || "").trim();
  const exchangeRate = currency === "USD" && exchangeRateRaw ? new Prisma.Decimal(exchangeRateRaw) : null;

  const productIds = formData.getAll("lineProductId").map(String);
  const quantities = formData.getAll("lineQuantity").map(String);
  const unitPrices = formData.getAll("lineUnitPrice").map(String);
  const circuits = formData.getAll("lineCircuit").map(String);

  const lines = productIds
    .map((productId, i) => ({
      productId,
      quantity: toDecimal(quantities[i]),
      unitPrice: toDecimal(unitPrices[i]),
      circuit: circuits[i] as "BLANCO" | "NEGRO",
    }))
    .filter((l) => l.productId && l.quantity.greaterThan(0) && l.unitPrice.greaterThan(0));

  if (lines.length === 0) {
    throw new Error("Cargá al menos una línea con producto, cantidad y precio.");
  }
  if (lines.some((l) => l.circuit !== "BLANCO" && l.circuit !== "NEGRO")) {
    throw new Error("Circuito inválido en alguna línea.");
  }

  const pedidoIds = formData.getAll("pedidoId").map(String).filter(Boolean);

  const accounts = await prisma.account.findMany({ where: { entityId } });
  const accountByCircuit = new Map(accounts.map((a) => [a.circuit, a]));

  const linesByCircuit = new Map<"BLANCO" | "NEGRO", typeof lines>();
  for (const line of lines) {
    const group = linesByCircuit.get(line.circuit) ?? [];
    group.push(line);
    linesByCircuit.set(line.circuit, group);
  }

  await prisma.$transaction(async (tx) => {
    for (const [circuit, circuitLines] of linesByCircuit) {
      const account = accountByCircuit.get(circuit);
      if (!account) throw new Error(`No se encontró la cuenta ${circuit} de esta entidad.`);

      const lineData = circuitLines.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        subtotal: l.quantity.times(l.unitPrice),
      }));
      const totalAmount = lineData.reduce((acc, l) => acc.plus(l.subtotal), toDecimal(0));

      const document = await tx.document.create({
        data: {
          accountId: account.id,
          type: "REMITO",
          number,
          date,
          dueDate: dueDateOverride ?? defaultDueDate(date, circuit),
          currency,
          exchangeRate,
          netAmount: totalAmount,
          totalAmount,
          createdById: user.id,
        },
      });

      await tx.documentLine.createMany({
        data: lineData.map((l) => ({ ...l, documentId: document.id })),
      });
    }

    if (pedidoIds.length > 0) {
      await tx.pedido.updateMany({
        where: { id: { in: pedidoIds }, entityId },
        data: { status: "ENTREGADO", deliveryDate: date },
      });
    }
  });

  revalidatePath(`/cuentas-corrientes/${entityId}`);
  revalidatePath("/entregas");
  revalidatePath("/dashboard-clientes");
  if (pedidoIds.length > 0) revalidatePath("/pedidos");
}

async function getRemitoOrThrow(documentId: string) {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: { remitoLinks: true, lines: true, account: true },
  });
  if (!document) throw new Error("El remito ya no existe.");
  if (document.type !== "REMITO" || document.lines.length === 0) {
    throw new Error("Este comprobante no es una entrega.");
  }
  if (document.remitoLinks.length > 0) {
    throw new Error("Este remito ya está facturado — hay que borrar la factura primero.");
  }
  return document;
}

export async function deleteRemito(formData: FormData) {
  await requireRole(["ADMIN", "CARGA_DIARIA"]);

  const documentId = String(formData.get("documentId") || "");
  const document = await getRemitoOrThrow(documentId);

  await prisma.$transaction(async (tx) => {
    await tx.paymentAllocation.deleteMany({ where: { documentId } });
    await tx.document.delete({ where: { id: documentId } });
  });

  revalidatePath(`/cuentas-corrientes/${document.account.entityId}`);
  revalidatePath("/entregas");
  revalidatePath("/dashboard-clientes");
}

/**
 * Editar una entrega = borrar el comprobante existente y volver a correr createRemito con los
 * datos nuevos del formulario — evita duplicar la lógica de agrupar líneas por circuito y crear
 * documentos, a costa de generar un id de Document nuevo (el número puede quedar igual).
 */
export async function updateRemito(formData: FormData) {
  await requireRole(["ADMIN", "CARGA_DIARIA"]);

  const documentId = String(formData.get("documentId") || "");
  await getRemitoOrThrow(documentId);

  await prisma.$transaction(async (tx) => {
    await tx.paymentAllocation.deleteMany({ where: { documentId } });
    await tx.document.delete({ where: { id: documentId } });
  });

  await createRemito(formData);
}

export async function createCompra(formData: FormData) {
  const user = await requireRole(["ADMIN", "CARGA_DIARIA"]);

  const entityId = String(formData.get("entityId") || "");
  if (!entityId) throw new Error("Falta la entidad.");

  const number = String(formData.get("number") || "").trim();
  if (!number) throw new Error("El número es obligatorio.");

  const date = parseFormDate(formData.get("date"));
  const dueDate = parseOptionalFormDate(formData.get("dueDate"));
  const currency = String(formData.get("currency") || "ARS") as Currency;
  const exchangeRateRaw = String(formData.get("exchangeRate") || "").trim();
  const exchangeRate = currency === "USD" && exchangeRateRaw ? new Prisma.Decimal(exchangeRateRaw) : null;

  const itemIds = formData.getAll("lineItemId").map(String);
  const quantities = formData.getAll("lineQuantity").map(String);
  const unitPrices = formData.getAll("lineUnitPrice").map(String);
  const circuits = formData.getAll("lineCircuit").map(String);

  const lines = itemIds
    .map((itemId, i) => ({
      itemId,
      quantity: toDecimal(quantities[i]),
      unitPrice: toDecimal(unitPrices[i]),
      circuit: circuits[i] as "BLANCO" | "NEGRO",
    }))
    .filter((l) => l.itemId && l.quantity.greaterThan(0) && l.unitPrice.greaterThan(0));

  if (lines.length === 0) {
    throw new Error("Cargá al menos una línea con insumo, cantidad y precio.");
  }
  if (lines.some((l) => l.circuit !== "BLANCO" && l.circuit !== "NEGRO")) {
    throw new Error("Circuito inválido en alguna línea.");
  }

  const accounts = await prisma.account.findMany({ where: { entityId } });
  const accountByCircuit = new Map(accounts.map((a) => [a.circuit, a]));

  const linesByCircuit = new Map<"BLANCO" | "NEGRO", typeof lines>();
  for (const line of lines) {
    const group = linesByCircuit.get(line.circuit) ?? [];
    group.push(line);
    linesByCircuit.set(line.circuit, group);
  }

  const entity = await prisma.entity.findUnique({ where: { id: entityId } });
  if (!entity) throw new Error("Entidad inexistente.");

  await prisma.$transaction(async (tx) => {
    for (const [circuit, circuitLines] of linesByCircuit) {
      const account = accountByCircuit.get(circuit);
      if (!account) throw new Error(`No se encontró la cuenta ${circuit} de esta entidad.`);

      const lineData = circuitLines.map((l) => ({
        itemId: l.itemId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        subtotal: l.quantity.times(l.unitPrice),
      }));
      const totalAmount = lineData.reduce((acc, l) => acc.plus(l.subtotal), toDecimal(0));

      const document = await tx.document.create({
        data: {
          accountId: account.id,
          type: "REMITO",
          number,
          date,
          dueDate,
          currency,
          exchangeRate,
          netAmount: totalAmount,
          totalAmount,
          createdById: user.id,
        },
      });

      await tx.purchaseLine.createMany({
        data: lineData.map((l) => ({ ...l, documentId: document.id })),
      });

      await tx.itemMovement.createMany({
        data: lineData.map((l) => ({
          itemId: l.itemId,
          date,
          quantity: l.quantity,
          type: "INGRESO" as const,
          reason: `Compra a ${entity.name} — remito ${number}`,
          documentId: document.id,
          createdById: user.id,
        })),
      });
    }
  });

  revalidatePath(`/cuentas-corrientes/${entityId}`);
  revalidatePath("/stock");
  revalidatePath("/compras");
  revalidatePath("/dashboard-proveedores");
}

async function getCompraOrThrow(documentId: string) {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: { purchaseLines: true, account: true },
  });
  if (!document) throw new Error("La compra ya no existe.");
  if (document.type !== "REMITO" || document.purchaseLines.length === 0) {
    throw new Error("Este comprobante no es una compra.");
  }
  return document;
}

export async function deleteCompra(formData: FormData) {
  await requireRole(["ADMIN", "CARGA_DIARIA"]);

  const documentId = String(formData.get("documentId") || "");
  const document = await getCompraOrThrow(documentId);

  await prisma.$transaction(async (tx) => {
    await tx.itemMovement.deleteMany({ where: { documentId } });
    await tx.paymentAllocation.deleteMany({ where: { documentId } });
    await tx.document.delete({ where: { id: documentId } });
  });

  revalidatePath(`/cuentas-corrientes/${document.account.entityId}`);
  revalidatePath("/stock");
  revalidatePath("/compras");
  revalidatePath("/dashboard-proveedores");
}

/** Igual patrón que updateRemito: borra el comprobante (revirtiendo el stock que había sumado)
 * y vuelve a correr createCompra con los datos nuevos del formulario. */
export async function updateCompra(formData: FormData) {
  await requireRole(["ADMIN", "CARGA_DIARIA"]);

  const documentId = String(formData.get("documentId") || "");
  await getCompraOrThrow(documentId);

  await prisma.$transaction(async (tx) => {
    await tx.itemMovement.deleteMany({ where: { documentId } });
    await tx.paymentAllocation.deleteMany({ where: { documentId } });
    await tx.document.delete({ where: { id: documentId } });
  });

  await createCompra(formData);
}

export async function createFactura(formData: FormData) {
  const user = await requireRole(["ADMIN", "CARGA_DIARIA"]);

  const accountId = String(formData.get("accountId") || "");
  const account = await getAccountOrThrow(accountId);
  if (account.circuit !== "BLANCO") {
    throw new Error("Las facturas solo se cargan en la cuenta Blanco.");
  }

  const number = String(formData.get("number") || "").trim();
  if (!number) throw new Error("El número es obligatorio.");

  const date = parseFormDate(formData.get("date"));
  const dueDate = parseOptionalFormDate(formData.get("dueDate")) ?? defaultDueDate(date, "BLANCO");
  const currency = String(formData.get("currency") || "ARS") as Currency;
  const exchangeRateRaw = String(formData.get("exchangeRate") || "").trim();
  const exchangeRate = currency === "USD" && exchangeRateRaw ? new Prisma.Decimal(exchangeRateRaw) : null;

  const netAmount = parseAmount(formData.get("netAmount"), "neto");
  const ivaRate = toDecimal(String(formData.get("ivaRate") || DEFAULT_IVA_RATE));
  const retentionAmount = toDecimal(String(formData.get("retentionAmount") || "0"));
  const perceptionAmount = toDecimal(String(formData.get("perceptionAmount") || "0"));

  const ivaAmount = netAmount.times(ivaRate).dividedBy(100);
  const totalAmount = netAmount.plus(ivaAmount).plus(perceptionAmount).minus(retentionAmount);

  const remitoIds = formData.getAll("remitoId").map(String);
  const remitoAmounts = formData.getAll("remitoAmount").map(String);
  const remitoSelections = remitoIds
    .map((id, i) => ({ id, amount: toDecimal(remitoAmounts[i]) }))
    .filter((r) => r.id && r.amount.greaterThan(0));

  await prisma.$transaction(async (tx) => {
    const factura = await tx.document.create({
      data: {
        accountId: account.id,
        type: "FACTURA",
        number,
        date,
        dueDate,
        currency,
        exchangeRate,
        netAmount,
        ivaRate,
        ivaAmount,
        retentionAmount,
        perceptionAmount,
        totalAmount,
        createdById: user.id,
      },
    });

    if (remitoSelections.length > 0) {
      const remitos = await tx.document.findMany({
        where: {
          id: { in: remitoSelections.map((r) => r.id) },
          accountId: account.id,
          type: "REMITO",
        },
        include: { remitoLinks: true, allocations: true, lines: { include: { product: true } }, purchaseLines: { include: { item: true } } },
      });
      if (remitos.length !== remitoSelections.length) {
        throw new Error("Alguno de los remitos seleccionados ya no está disponible.");
      }

      const linkData = remitoSelections.map((selection) => {
        const remito = remitos.find((r) => r.id === selection.id)!;
        const pending = getDocumentEffect(remito);
        if (selection.amount.greaterThan(pending)) {
          throw new Error(
            `El monto a facturar del remito #${remito.number} supera su saldo pendiente.`
          );
        }
        return { remitoId: remito.id, facturaId: factura.id, amount: selection.amount };
      });

      await tx.documentLink.createMany({ data: linkData });
    }
  });

  revalidatePath(`/cuentas-corrientes/${account.entityId}`);
}

/** Edita los montos de una factura ya cargada. No toca los remitos que tenga vinculados — para
 * cambiar eso hay que borrarla y volver a facturar. El saldo pendiente se recalcula solo porque
 * sale de totalAmount, no hay nada desnormalizado que actualizar. */
export async function updateFactura(formData: FormData) {
  await requireRole(["ADMIN", "CARGA_DIARIA"]);

  const documentId = String(formData.get("documentId") || "");
  const factura = await prisma.document.findUnique({ where: { id: documentId } });
  if (!factura) throw new Error("La factura ya no existe.");
  if (factura.type !== "FACTURA") throw new Error("Este comprobante no es una factura.");

  const number = String(formData.get("number") || "").trim();
  if (!number) throw new Error("El número es obligatorio.");

  const date = parseFormDate(formData.get("date"));
  const dueDate = parseOptionalFormDate(formData.get("dueDate")) ?? defaultDueDate(date, "BLANCO");
  const currency = String(formData.get("currency") || "ARS") as Currency;
  const exchangeRateRaw = String(formData.get("exchangeRate") || "").trim();
  const exchangeRate = currency === "USD" && exchangeRateRaw ? new Prisma.Decimal(exchangeRateRaw) : null;

  const netAmount = parseAmount(formData.get("netAmount"), "neto");
  const ivaRate = toDecimal(String(formData.get("ivaRate") || DEFAULT_IVA_RATE));
  const retentionAmount = toDecimal(String(formData.get("retentionAmount") || "0"));
  const perceptionAmount = toDecimal(String(formData.get("perceptionAmount") || "0"));

  const ivaAmount = netAmount.times(ivaRate).dividedBy(100);
  const totalAmount = netAmount.plus(ivaAmount).plus(perceptionAmount).minus(retentionAmount);

  await prisma.document.update({
    where: { id: documentId },
    data: {
      number,
      date,
      dueDate,
      currency,
      exchangeRate,
      netAmount,
      ivaRate,
      ivaAmount,
      retentionAmount,
      perceptionAmount,
      totalAmount,
    },
  });

  const account = await prisma.account.findUnique({ where: { id: factura.accountId } });
  revalidatePath(`/cuentas-corrientes/${account?.entityId}`);
}

/** Borrar una factura "desfactura" los remitos que tenía vinculados (vuelven a pendiente). */
export async function deleteFactura(formData: FormData) {
  await requireRole(["ADMIN", "CARGA_DIARIA"]);

  const documentId = String(formData.get("documentId") || "");
  const factura = await prisma.document.findUnique({
    where: { id: documentId },
    include: { account: true },
  });
  if (!factura) throw new Error("La factura ya no existe.");
  if (factura.type !== "FACTURA") throw new Error("Este comprobante no es una factura.");

  await prisma.$transaction(async (tx) => {
    await tx.documentLink.deleteMany({ where: { facturaId: documentId } });
    await tx.paymentAllocation.deleteMany({ where: { documentId } });
    await tx.document.delete({ where: { id: documentId } });
  });

  revalidatePath(`/cuentas-corrientes/${factura.account.entityId}`);
}

export async function createPayment(formData: FormData) {
  const user = await requireRole(["ADMIN", "CARGA_DIARIA"]);

  const accountId = String(formData.get("accountId") || "");
  const account = await getAccountOrThrow(accountId);

  const date = parseFormDate(formData.get("date"));
  const currency = String(formData.get("currency") || "ARS") as Currency;
  const amount = parseAmount(formData.get("amount"), "monto del pago");
  const method = String(formData.get("method") || "EFECTIVO") as PaymentMethod;
  const reference = String(formData.get("reference") || "").trim() || null;
  const mode = String(formData.get("allocationMode") || "fifo");

  let allocations: { documentId: string; amount: Prisma.Decimal }[];

  if (mode === "manual") {
    const documentIds = formData.getAll("manualDocumentId").map(String);
    const documentAmounts = formData.getAll("manualAmount").map(String);
    allocations = documentIds
      .map((documentId, i) => ({ documentId, amount: toDecimal(documentAmounts[i]) }))
      .filter((a) => a.documentId && a.amount.greaterThan(0));

    const totalManual = allocations.reduce((acc, a) => acc.plus(a.amount), new Prisma.Decimal(0));
    if (totalManual.greaterThan(amount)) {
      throw new Error("La suma imputada manualmente no puede superar el monto del pago.");
    }
  } else {
    allocations = await allocateFifo(account.id, amount, currency);
  }

  await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        accountId: account.id,
        date,
        amount,
        currency,
        method,
        reference,
        createdById: user.id,
      },
    });

    if (allocations.length > 0) {
      await tx.paymentAllocation.createMany({
        data: allocations.map((a) => ({
          paymentId: payment.id,
          documentId: a.documentId,
          amount: a.amount,
        })),
      });
    }
  });

  revalidatePath(`/cuentas-corrientes/${account.entityId}`);
  revalidatePath("/pagos-clientes");
  revalidatePath("/pagos-proveedores");
  revalidatePath("/dashboard-clientes");
  revalidatePath("/dashboard-proveedores");
}

/**
 * Variante de createPayment para el modal "Nuevo pago" de /pagos-clientes y
 * /pagos-proveedores: ahí no se conoce el accountId de antemano (se elige la entidad y la
 * cuenta en el mismo formulario), así que se resuelve acá. Siempre imputa por FIFO — la
 * imputación manual sigue disponible desde la ficha individual de la entidad.
 */
export async function createPaymentForEntity(formData: FormData) {
  const user = await requireRole(["ADMIN", "CARGA_DIARIA"]);

  const entityId = String(formData.get("entityId") || "");
  if (!entityId) throw new Error("Falta el cliente o proveedor.");

  const circuit = String(formData.get("circuit") || "");
  if (circuit !== "BLANCO" && circuit !== "NEGRO") throw new Error("Cuenta inválida.");

  const account = await prisma.account.findUnique({
    where: { entityId_circuit: { entityId, circuit } },
  });
  if (!account) throw new Error("No se encontró la cuenta de esta entidad.");

  const date = parseFormDate(formData.get("date"));
  const amount = parseAmount(formData.get("amount"), "monto del pago");
  const method = String(formData.get("method") || "EFECTIVO") as PaymentMethod;
  const reference = String(formData.get("reference") || "").trim() || null;

  const allocations = await allocateFifo(account.id, amount, "ARS");

  await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        accountId: account.id,
        date,
        amount,
        currency: "ARS",
        method,
        reference,
        createdById: user.id,
      },
    });

    if (allocations.length > 0) {
      await tx.paymentAllocation.createMany({
        data: allocations.map((a) => ({
          paymentId: payment.id,
          documentId: a.documentId,
          amount: a.amount,
        })),
      });
    }
  });

  revalidatePath(`/cuentas-corrientes/${entityId}`);
  revalidatePath("/pagos-clientes");
  revalidatePath("/pagos-proveedores");
  revalidatePath("/dashboard-clientes");
  revalidatePath("/dashboard-proveedores");
}

export async function deletePayment(formData: FormData) {
  await requireRole(["ADMIN", "CARGA_DIARIA"]);

  const paymentId = String(formData.get("paymentId") || "");
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { account: true },
  });
  if (!payment) throw new Error("El pago ya no existe.");

  await prisma.$transaction(async (tx) => {
    await tx.paymentAllocation.deleteMany({ where: { paymentId } });
    await tx.payment.delete({ where: { id: paymentId } });
  });

  revalidatePath(`/cuentas-corrientes/${payment.account.entityId}`);
  revalidatePath("/pagos-clientes");
  revalidatePath("/pagos-proveedores");
  revalidatePath("/dashboard-clientes");
  revalidatePath("/dashboard-proveedores");
}

/** Edita un pago — si cambia el monto o la cuenta (circuito), se borran las imputaciones viejas
 * y se vuelve a correr allocateFifo con los datos nuevos, mismo camino que crear un pago. */
export async function updatePayment(formData: FormData) {
  await requireRole(["ADMIN", "CARGA_DIARIA"]);

  const paymentId = String(formData.get("paymentId") || "");
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { account: true },
  });
  if (!payment) throw new Error("El pago ya no existe.");

  const entityId = payment.account.entityId;
  const circuit = String(formData.get("circuit") || "");
  if (circuit !== "BLANCO" && circuit !== "NEGRO") throw new Error("Cuenta inválida.");

  const account = await prisma.account.findUnique({
    where: { entityId_circuit: { entityId, circuit } },
  });
  if (!account) throw new Error("No se encontró la cuenta de esta entidad.");

  const date = parseFormDate(formData.get("date"));
  const amount = parseAmount(formData.get("amount"), "monto del pago");
  const method = String(formData.get("method") || "EFECTIVO") as PaymentMethod;
  const reference = String(formData.get("reference") || "").trim() || null;

  await prisma.$transaction(async (tx) => {
    await tx.paymentAllocation.deleteMany({ where: { paymentId } });
    await tx.payment.update({
      where: { id: paymentId },
      data: { accountId: account.id, date, amount, method, reference },
    });
  });

  const allocations = await allocateFifo(account.id, amount, "ARS");
  if (allocations.length > 0) {
    await prisma.paymentAllocation.createMany({
      data: allocations.map((a) => ({ paymentId, documentId: a.documentId, amount: a.amount })),
    });
  }

  revalidatePath(`/cuentas-corrientes/${entityId}`);
  revalidatePath("/pagos-clientes");
  revalidatePath("/pagos-proveedores");
  revalidatePath("/dashboard-clientes");
  revalidatePath("/dashboard-proveedores");
}

export async function moveRemitoToBlanco(formData: FormData) {
  await requireRole(["ADMIN", "CARGA_DIARIA"]);

  const documentId = String(formData.get("documentId") || "");
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: { account: true, remitoLinks: true },
  });
  if (!document) notFound();
  if (document.type !== "REMITO") throw new Error("Solo los remitos se pueden mover de cuenta.");
  if (document.remitoLinks.length > 0) {
    throw new Error("Este remito ya está facturado, no se puede mover.");
  }
  if (document.account.circuit === "BLANCO") {
    throw new Error("El remito ya está en la cuenta Blanco.");
  }

  const blancoAccount = await prisma.account.findUnique({
    where: { entityId_circuit: { entityId: document.account.entityId, circuit: "BLANCO" } },
  });
  if (!blancoAccount) throw new Error("No se encontró la cuenta Blanco de esta entidad.");

  await prisma.document.update({
    where: { id: document.id },
    data: { accountId: blancoAccount.id },
  });

  revalidatePath(`/cuentas-corrientes/${document.account.entityId}`);
}

export async function createPrice(formData: FormData) {
  const user = await requireRole(["ADMIN", "CARGA_DIARIA"]);

  const entityId = String(formData.get("entityId") || "");
  const circuit = String(formData.get("circuit") || "") as "BLANCO" | "NEGRO";
  const productId = String(formData.get("productId") || "");
  const currency = String(formData.get("currency") || "ARS") as Currency;
  const validFrom = parseFormDate(formData.get("validFrom"));
  const amount = parseAmount(formData.get("amount"), "precio");

  if (!entityId) throw new Error("Falta la entidad.");
  if (circuit !== "BLANCO" && circuit !== "NEGRO") throw new Error("Circuito inválido.");
  if (!productId) throw new Error("Falta el producto.");

  await prisma.price.create({
    data: { entityId, circuit, productId, currency, validFrom, amount, createdById: user.id },
  });

  revalidatePath(`/cuentas-corrientes/${entityId}`);
}
