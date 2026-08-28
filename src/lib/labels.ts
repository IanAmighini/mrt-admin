import type {
  Circuit,
  Currency,
  DocumentType,
  ItemMovementType,
  PaymentMethod,
  PedidoStatus,
  ProductMovementType,
  SupplierCategory,
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
  ECHEQ: "Echeq",
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
  ENTREGA: "Entrega",
};

export const SUPPLIER_CATEGORY_LABELS: Record<SupplierCategory, string> = {
  ACEITE: "Aceite",
  ENVASES: "Envases",
  CAJAS: "Cajas",
  TAPAS: "Tapas",
  CINTA: "Cinta",
  ETIQUETAS: "Etiquetas",
  PALLET_NORMALIZADO: "Pallet normalizado",
  OTRO: "Otro",
};

export const PEDIDO_STATUS_LABELS: Record<PedidoStatus, string> = {
  EN_COLA: "En cola",
  COMPLETADO: "Terminado",
  ENTREGADO: "Entregado",
};

export const PEDIDO_STATUS_COLORS: Record<PedidoStatus, string> = {
  EN_COLA: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  COMPLETADO: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  ENTREGADO: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
};
