"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { Prisma, type Currency, type DocumentType, type PaymentMethod } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { DEFAULT_IVA_RATE, toDecimal } from "@/lib/money";
import { allocateFifo, defaultDueDate, getDocumentEffect } from "@/lib/ledger";

const NON_FACTURA_TYPES: DocumentType[] = ["REMITO", "NOTA_CREDITO", "NOTA_DEBITO", "AJUSTE"];

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

export async function createDocument(formData: FormData) {
  const user = await requireRole(["ADMIN", "CARGA_DIARIA"]);

  const accountId = String(formData.get("accountId") || "");
  const type = String(formData.get("type") || "") as DocumentType;
  if (!NON_FACTURA_TYPES.includes(type)) throw new Error("Tipo de comprobante inválido.");

  const account = await getAccountOrThrow(accountId);

  const number = String(formData.get("number") || "").trim();
  if (!number) throw new Error("El número es obligatorio.");

  const date = parseFormDate(formData.get("date"));
  const dueDate =
    parseOptionalFormDate(formData.get("dueDate")) ??
    (type === "REMITO" ? defaultDueDate(date, account.circuit) : null);
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

  revalidatePath(`/cuentas-corrientes/${account.entityId}`);
  revalidatePath("/cuentas-corrientes");
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
        include: { remitoLinks: true, allocations: true },
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
  revalidatePath("/cuentas-corrientes");
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
  revalidatePath("/cuentas-corrientes");
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
  revalidatePath("/cuentas-corrientes");
}
