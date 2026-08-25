import type {
  BoxMovementType,
  Circuit,
  Currency,
  DocumentType,
  ItemMovementType,
  PalletStatus,
  PaymentMethod,
  ProductMovementType,
} from "@prisma/client";

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

export const ITEM_MOVEMENT_TYPE_LABELS: Record<ItemMovementType, string> = {
  INGRESO: "Ingreso",
  CONSUMO_PRODUCCION: "Consumo por producción",
  CONSUMO_PALLET: "Consumo por armado de pallet",
  AJUSTE: "Ajuste",
  MERMA: "Merma",
  VENTA: "Venta",
};

export const PRODUCT_MOVEMENT_TYPE_LABELS: Record<ProductMovementType, string> = {
  PRODUCCION: "Producción",
  CONSUMO_ARMADO_CAJA: "Consumo por armado de cajas",
  AJUSTE: "Ajuste",
  MERMA: "Merma",
};

export const BOX_MOVEMENT_TYPE_LABELS: Record<BoxMovementType, string> = {
  ARMADO: "Armado",
  CONSUMO_PALLET: "Consumo por armado de pallet",
  DEVUELTO_PALLET: "Devuelto por desarmado de pallet",
  AJUSTE: "Ajuste",
  MERMA: "Merma",
};

export const PALLET_STATUS_LABELS: Record<PalletStatus, string> = {
  ARMADO: "Armado",
  DESARMADO: "Desarmado",
};
