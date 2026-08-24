import type { Circuit, Currency, DocumentType, PaymentMethod } from "@prisma/client";

export const CIRCUIT_LABELS: Record<Circuit, string> = {
  BLANCO: "Blanco",
  NEGRO: "Negro",
};

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  REMITO: "Remito",
  FACTURA: "Factura",
  NOTA_CREDITO: "Nota de crédito",
  NOTA_DEBITO: "Nota de débito",
  AJUSTE: "Ajuste",
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  CHEQUE: "Cheque",
  OTRO: "Otro",
};

export const CURRENCY_LABELS: Record<Currency, string> = {
  ARS: "ARS",
  USD: "USD",
};
