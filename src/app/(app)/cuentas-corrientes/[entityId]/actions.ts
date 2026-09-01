"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import {
  Prisma,
  type Circuit,
  type Currency,
  type DocumentType,
  type PaymentMethod,
  type TreasuryMovementCategory,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { DEFAULT_IVA_RATE, toDecimal } from "@/lib/money";
import { allocateFifo, defaultDueDate, getDocumentEffect } from "@/lib/ledger";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { PROVEEDOR_DIRECTO_VALUE } from "@/components/PaymentFormFields";

const NON_FACTURA_TYPES: DocumentType[] = ["NOTA_CREDITO", "NOTA_DEBITO", "AJUSTE"];

const MANUAL_TREASURY_CATEGORIES: TreasuryMovementCategory[] = [
  "GASTO_BANCARIO",
  "IMPUESTO",
  "RETIRO",
  "DEPOSITO",
  "AJUSTE_ARQUEO",
  "OTRO",
];

/** undefined = el form no tiene el campo (no tocar el valor existente al editar); null = limpiar. */
function parseManualTreasuryCategory(
  value: FormDataEntryValue | null
): TreasuryMovementCategory | null | undefined {
  if (value === null) return undefined;
  const raw = String(value);
  return MANUAL_TREASURY_CATEGORIES.includes(raw as TreasuryMovementCategory)
    ? (raw as TreasuryMovementCategory)
    : null;
}

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
  await requireRole(["ADMIN", "CARGA_DIARIA", "SECRETARIA"]);

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
  const treasuryCategory = parseManualTreasuryCategory(formData.get("treasuryCategory"));

  const account = await getAccountOrThrow(document.accountId);

  await prisma.document.update({
    where: { id: documentId },
    data: {
      type,
      number,
      date,
      dueDate,
      currency,
      exchangeRate,
      netAmount: amount,
      totalAmount,
      reason,
      ...(treasuryCategory !== undefined ? { treasuryCategory } : {}),
    },
  });

  revalidatePath(`/cuentas-corrientes/${account.entityId}`);
}

export async function deleteDocument(formData: FormData) {
  await requireRole(["ADMIN", "CARGA_DIARIA", "SECRETARIA"]);

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
  const user = await requireRole(["ADMIN", "CARGA_DIARIA", "SECRETARIA"]);

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
  const treasuryCategory = parseManualTreasuryCategory(formData.get("treasuryCategory")) || null;

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
      treasuryCategory,
      createdById: user.id,
    },
  });

  revalidatePath(`/cuentas-corrientes/${entityId}`);
}

export async function createRemito(formData: FormData) {
  const user = await requireRole(["ADMIN", "CARGA_DIARIA", "SECRETARIA"]);

  const entityId = String(formData.get("entityId") || "");
  if (!entityId) throw new Error("Falta la entidad.");

  const number = String(formData.get("number") || "").trim();
  if (!number) throw new Error("El número es obligatorio.");

  const date = parseFormDate(formData.get("date"));
  const dueDateOverride = parseOptionalFormDate(formData.get("dueDate"));
  const currency = String(formData.get("currency") || "ARS") as Currency;
  const exchangeRateRaw = String(formData.get("exchangeRate") || "").trim();
  const exchangeRate = currency === "USD" && exchangeRateRaw ? new Prisma.Decimal(exchangeRateRaw) : null;
  const reason = String(formData.get("reason") || "").trim() || null;

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
      const netAmount = lineData.reduce((acc, l) => acc.plus(l.subtotal), toDecimal(0));
      // Blanco = facturado, así que ya lleva IVA; Negro no factura, sin IVA.
      const ivaRate = circuit === "BLANCO" ? toDecimal(DEFAULT_IVA_RATE) : null;
      const ivaAmount = ivaRate ? netAmount.times(ivaRate).dividedBy(100) : null;
      const totalAmount = ivaAmount ? netAmount.plus(ivaAmount) : netAmount;

      const document = await tx.document.create({
        data: {
          accountId: account.id,
          type: "REMITO",
          number,
          date,
          dueDate: dueDateOverride ?? defaultDueDate(date, circuit),
          currency,
          exchangeRate,
          netAmount,
          ivaRate,
          ivaAmount,
          totalAmount,
          reason,
          createdById: user.id,
        },
      });

      for (const l of lineData) {
        const documentLine = await tx.documentLine.create({
          data: { ...l, documentId: document.id },
        });

        await tx.productMovement.create({
          data: {
            productId: l.productId,
            date,
            quantity: l.quantity.negated(),
            type: "ENTREGA",
            reason: `Entrega remito ${number}`,
            documentLineId: documentLine.id,
            createdById: user.id,
          },
        });
      }
    }

    if (pedidoIds.length > 0) {
      await tx.pedido.updateMany({
        where: { id: { in: pedidoIds }, entityId },
        data: { status: "ENTREGADO", deliveryDate: date },
      });
    }
  }, { timeout: 20000 });

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
  await requireRole(["ADMIN", "CARGA_DIARIA", "SECRETARIA"]);

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
  await requireRole(["ADMIN", "CARGA_DIARIA", "SECRETARIA"]);

  const documentId = String(formData.get("documentId") || "");
  await getRemitoOrThrow(documentId);

  await prisma.$transaction(async (tx) => {
    await tx.paymentAllocation.deleteMany({ where: { documentId } });
    await tx.document.delete({ where: { id: documentId } });
  });

  await createRemito(formData);
}

export async function createCompra(formData: FormData) {
  const user = await requireRole(["ADMIN", "CARGA_DIARIA", "SECRETARIA"]);

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
  await requireRole(["ADMIN", "CARGA_DIARIA", "SECRETARIA"]);

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
  await requireRole(["ADMIN", "CARGA_DIARIA", "SECRETARIA"]);

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
  const user = await requireRole(["ADMIN", "CARGA_DIARIA", "SECRETARIA"]);

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
  await requireRole(["ADMIN", "CARGA_DIARIA", "SECRETARIA"]);

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
  await requireRole(["ADMIN", "CARGA_DIARIA", "SECRETARIA"]);

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
  const user = await requireRole(["ADMIN", "CARGA_DIARIA", "SECRETARIA"]);

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
/**
 * Aplica el destino/origen elegido para un cobro/pago recién creado (o recreado al editar):
 * - Tesorería (Banco Galicia / Caja Bufano): genera el Document AJUSTE que suma/resta su saldo,
 *   vinculado al Payment por sourcePaymentId (se borra solo si se borra el Payment).
 * - "Directo a un proveedor" (solo cobros): crea un segundo Payment en la cuenta del proveedor
 *   elegido, imputado por FIFO, y vincula ambos pagos por linkedPaymentId. No pasa por ninguna
 *   tesorería porque la plata nunca llegó a la empresa.
 * - Sin destino (""): no hace nada — el pago queda sin asignar, como cualquier pago histórico.
 */
async function applyPaymentDestino(params: {
  userId: string;
  payment: { id: string; date: Date; amount: Prisma.Decimal; method: PaymentMethod; circuit: Circuit };
  entity: { id: string; name: string };
  /** Si este pago es un cobro (entra plata, ej. desde la página/ficha de clientes) o un pago a
   * proveedor (sale plata) — viene explícito del form en vez de derivarse de entity.type porque
   * una entidad AMBOS puede recibir cobros y pagos según desde qué página se cargue. */
  isCobro: boolean;
  destino: string;
  proveedorId: string;
}) {
  const { userId, payment, entity, isCobro, destino, proveedorId } = params;
  if (!destino) return;

  if (destino === PROVEEDOR_DIRECTO_VALUE) {
    if (!isCobro) throw new Error('"Directo a un proveedor" solo aplica a cobros de clientes.');
    if (!proveedorId) throw new Error("Elegí a qué proveedor fue directo el pago.");

    const proveedorAccount = await prisma.account.findUnique({
      where: { entityId_circuit: { entityId: proveedorId, circuit: payment.circuit } },
    });
    if (!proveedorAccount) throw new Error("No se encontró la cuenta del proveedor elegido.");

    const proveedorAllocations = await allocateFifo(proveedorAccount.id, payment.amount, "ARS");
    const linkedPayment = await prisma.payment.create({
      data: {
        accountId: proveedorAccount.id,
        date: payment.date,
        amount: payment.amount,
        currency: "ARS",
        method: payment.method,
        reference: `Cobro directo de ${entity.name}`,
        linkedPaymentId: payment.id,
        createdById: userId,
      },
    });
    if (proveedorAllocations.length > 0) {
      await prisma.paymentAllocation.createMany({
        data: proveedorAllocations.map((a) => ({
          paymentId: linkedPayment.id,
          documentId: a.documentId,
          amount: a.amount,
        })),
      });
    }
    await prisma.payment.update({
      where: { id: payment.id },
      data: { linkedPaymentId: linkedPayment.id },
    });
    return;
  }

  const treasuryAccount = await prisma.account.findUnique({
    where: { entityId_circuit: { entityId: destino, circuit: payment.circuit } },
    include: { entity: true },
  });
  if (!treasuryAccount || treasuryAccount.entity.type !== "TESORERIA") {
    throw new Error("Destino inválido.");
  }

  const category: TreasuryMovementCategory = isCobro ? "COBRO" : "PAGO_PROVEEDOR";
  const signedAmount = isCobro ? payment.amount : payment.amount.negated();
  await prisma.document.create({
    data: {
      accountId: treasuryAccount.id,
      type: "AJUSTE",
      number: `P-${payment.id.slice(-8)}`,
      date: payment.date,
      currency: "ARS",
      netAmount: payment.amount,
      totalAmount: signedAmount,
      reason: `${isCobro ? "Cobro de" : "Pago a"} ${entity.name} — ${PAYMENT_METHOD_LABELS[payment.method]}`,
      treasuryCategory: category,
      sourcePaymentId: payment.id,
      createdById: userId,
    },
  });
  await prisma.payment.update({ where: { id: payment.id }, data: { treasuryId: destino } });
}

export async function createPaymentForEntity(formData: FormData) {
  const user = await requireRole(["ADMIN", "CARGA_DIARIA", "SECRETARIA"]);

  const entityId = String(formData.get("entityId") || "");
  if (!entityId) throw new Error("Falta el cliente o proveedor.");

  const circuit = String(formData.get("circuit") || "");
  if (circuit !== "BLANCO" && circuit !== "NEGRO") throw new Error("Cuenta inválida.");

  const account = await prisma.account.findUnique({
    where: { entityId_circuit: { entityId, circuit } },
    include: { entity: true },
  });
  if (!account) throw new Error("No se encontró la cuenta de esta entidad.");

  const date = parseFormDate(formData.get("date"));
  const amount = parseAmount(formData.get("amount"), "monto del pago");
  const method = String(formData.get("method") || "EFECTIVO") as PaymentMethod;
  const reference = String(formData.get("reference") || "").trim() || null;
  const destino = String(formData.get("destino") || "");
  const proveedorId = String(formData.get("proveedorId") || "");

  const allocations = await allocateFifo(account.id, amount, "ARS");

  const payment = await prisma.$transaction(async (tx) => {
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

    return payment;
  });

  await applyPaymentDestino({
    userId: user.id,
    payment: { id: payment.id, date, amount, method, circuit },
    entity: account.entity,
    isCobro: formData.get("isCobro") === "1",
    destino,
    proveedorId,
  });

  revalidatePath(`/cuentas-corrientes/${entityId}`);
  revalidatePath("/pagos-clientes");
  revalidatePath("/pagos-proveedores");
  revalidatePath("/dashboard-clientes");
  revalidatePath("/dashboard-proveedores");
  revalidatePath("/tesoreria");
}

export async function deletePayment(formData: FormData) {
  await requireRole(["ADMIN", "CARGA_DIARIA", "SECRETARIA"]);

  const paymentId = String(formData.get("paymentId") || "");
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { account: true },
  });
  if (!payment) throw new Error("El pago ya no existe.");

  const linkedPayment = payment.linkedPaymentId
    ? await prisma.payment.findUnique({ where: { id: payment.linkedPaymentId }, include: { account: true } })
    : null;

  await prisma.$transaction(async (tx) => {
    await tx.paymentAllocation.deleteMany({ where: { paymentId } });
    await tx.payment.delete({ where: { id: paymentId } });
    if (linkedPayment) {
      await tx.paymentAllocation.deleteMany({ where: { paymentId: linkedPayment.id } });
      await tx.payment.delete({ where: { id: linkedPayment.id } });
    }
  });

  revalidatePath(`/cuentas-corrientes/${payment.account.entityId}`);
  if (linkedPayment) revalidatePath(`/cuentas-corrientes/${linkedPayment.account.entityId}`);
  revalidatePath("/pagos-clientes");
  revalidatePath("/pagos-proveedores");
  revalidatePath("/dashboard-clientes");
  revalidatePath("/dashboard-proveedores");
  revalidatePath("/tesoreria");
}

/** Edita un pago — si cambia el monto o la cuenta (circuito), se borran las imputaciones viejas
 * y se vuelve a correr allocateFifo con los datos nuevos, mismo camino que crear un pago. El
 * destino/origen (Document de tesorería o pago vinculado a un proveedor) se deshace por completo
 * y se vuelve a generar desde cero con los datos nuevos — más simple y seguro que tratar de
 * adivinar la transición entre los distintos casos. */
export async function updatePayment(formData: FormData) {
  const user = await requireRole(["ADMIN", "CARGA_DIARIA", "SECRETARIA"]);

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
    include: { entity: true },
  });
  if (!account) throw new Error("No se encontró la cuenta de esta entidad.");

  const date = parseFormDate(formData.get("date"));
  const amount = parseAmount(formData.get("amount"), "monto del pago");
  const method = String(formData.get("method") || "EFECTIVO") as PaymentMethod;
  const reference = String(formData.get("reference") || "").trim() || null;
  const destino = String(formData.get("destino") || "");
  const proveedorId = String(formData.get("proveedorId") || "");

  const oldLinkedPaymentId = payment.linkedPaymentId;
  const oldLinkedPayment = oldLinkedPaymentId
    ? await prisma.payment.findUnique({ where: { id: oldLinkedPaymentId }, include: { account: true } })
    : null;

  await prisma.$transaction(async (tx) => {
    await tx.paymentAllocation.deleteMany({ where: { paymentId } });
    await tx.document.deleteMany({ where: { sourcePaymentId: paymentId } });
    if (oldLinkedPayment) {
      await tx.paymentAllocation.deleteMany({ where: { paymentId: oldLinkedPayment.id } });
      await tx.payment.delete({ where: { id: oldLinkedPayment.id } });
    }

    await tx.payment.update({
      where: { id: paymentId },
      data: {
        accountId: account.id,
        date,
        amount,
        method,
        reference,
        treasuryId: null,
        linkedPaymentId: null,
      },
    });
  });

  const allocations = await allocateFifo(account.id, amount, "ARS");
  if (allocations.length > 0) {
    await prisma.paymentAllocation.createMany({
      data: allocations.map((a) => ({ paymentId, documentId: a.documentId, amount: a.amount })),
    });
  }

  await applyPaymentDestino({
    userId: user.id,
    payment: { id: paymentId, date, amount, method, circuit },
    entity: account.entity,
    isCobro: formData.get("isCobro") === "1",
    destino,
    proveedorId,
  });

  revalidatePath(`/cuentas-corrientes/${entityId}`);
  if (oldLinkedPayment) revalidatePath(`/cuentas-corrientes/${oldLinkedPayment.account.entityId}`);
  revalidatePath("/pagos-clientes");
  revalidatePath("/pagos-proveedores");
  revalidatePath("/dashboard-clientes");
  revalidatePath("/dashboard-proveedores");
  revalidatePath("/tesoreria");
}

export async function moveRemitoToBlanco(formData: FormData) {
  await requireRole(["ADMIN", "CARGA_DIARIA", "SECRETARIA"]);

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
  const user = await requireRole(["ADMIN", "CARGA_DIARIA", "SECRETARIA"]);

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
