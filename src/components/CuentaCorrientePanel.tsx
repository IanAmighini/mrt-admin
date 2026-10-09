import type { Entity, Product } from "@prisma/client";
import { DevolucionFields } from "./DevolucionFields";
import { formatFecha, hoyEnInput } from "@/lib/period";
import type { RecentMovement } from "@/lib/ledger";
import { getDocumentEffect } from "@/lib/ledger";
import { formatMoney } from "@/lib/money";
import { tituloDeCaja } from "@/lib/account-statement";
import { DOCUMENT_TYPE_LABELS, PAYMENT_CONCEPTO_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { EntradaFormFields } from "./EntradaFormFields";
import {
  cargarEnCuenta,
  createDocumentForEntity,
  createFactura,
  crearDevolucion,
  createPaymentForEntity,
  registrarEntrada,
} from "@/app/(app)/cuentas-corrientes/[entityId]/actions";
import { FormModal } from "./Modal";
import { PaymentFormFields, type ChequeEnCartera } from "./PaymentFormFields";
import { OrdenPagoFields, type PagoSinOrden } from "./OrdenPagoFields";
import { crearOrdenPago } from "@/app/(app)/ordenes-pago/actions";
import { crearGastoDeCaja } from "@/app/(app)/caja-chica/actions";
import { GastoDeCajaFields } from "./CajaFormFields";
import { DocumentFormFields } from "./DocumentFormFields";
import { FacturaFormFields, type ComprobanteFacturable } from "./FacturaFormFields";
import { CargarEnCuentaFields } from "./CargarEnCuentaFields";
import type { ItemDeCompra } from "./NuevaCompraForm";
import type { DestinatarioOption, ViajeOption } from "./ViajeFields";

export function CuentaCorrientePanel({
  entityId,
  entityName,
  entityType,
  esSocio = false,
  rubroGasto,
  moneda,
  movements,
  canEdit,
  factura,
  treasuries,
  proveedores,
  cartera,
  pagosSinOrden,
  items,
  viajes,
  destinatarios,
  rotuloSubcuenta,
  devolucion,
}: {
  entityId: string;
  entityName: string;
  entityType: Entity["type"];
  /** La cuenta por la que se retira para los socios: además de cobros, carga aportes de capital. */
  esSocio?: boolean;
  /** El rubro del proveedor, para que un gasto suyo arranque con él puesto. */
  rubroGasto?: Entity["expenseCategory"];
  /** Moneda de la cuenta: en dólares el pago se carga en pesos y se convierte. */
  moneda: Entity["moneda"];
  movements: RecentMovement[];
  canEdit: boolean;
  /** Si viene, se muestra el botón "Factura" (siempre sobre la cuenta Blanco). */
  factura?: {
    blancoAccountId: string;
    isWithholdingAgent: boolean;
    comprobantes: ComprobanteFacturable[];
    /** "Remito" del lado de ventas, "Compra" del de proveedores. */
    sustantivo: string;
  };
  treasuries: Entity[];
  /** Los cheques en cartera, para poder entregarle uno a un proveedor. */
  cartera?: ChequeEnCartera[];
  /** Los pagos en Blanco que todavía no están en una orden de pago. Sólo proveedores. */
  pagosSinOrden?: PagoSinOrden[];
  /** Los insumos, para cargar una compra sin salir de la ficha. Sólo proveedores. */
  items?: ItemDeCompra[];
  /** Solo si esta ficha es de un cliente: lista de proveedores, para "directo a un proveedor". */
  proveedores?: Entity[];
  /** Los viajes del cliente: el pago elige contra cuál se imputa, y la nota de crédito de cuál
   * cuelga. Vacío en quien no los usa, y ahí los selectores ni aparecen. */
  viajes?: ViajeOption[];
  destinatarios?: DestinatarioOption[];
  /** Cómo llama esta ficha a las partes de su cuenta: "Viaje", "Subcuenta". */
  rotuloSubcuenta?: string;
  /** Sólo clientes: lo que hace falta para cargar una devolución. */
  devolucion?: {
    products: Product[];
    priceMapByCircuit: Record<"BLANCO" | "NEGRO", Record<string, { amount: number; currency: string }>>;
    proximoNumero: string;
  };
}) {
  const isTreasury = entityType === "TESORERIA";
  const isCliente = entityType !== "PROVEEDOR";
  // El botón de gasto es el simétrico del de factura: lo ven los proveedores, no los clientes.
  const isProveedor = entityType === "PROVEEDOR" || entityType === "AMBOS";

  return (
    <div className="rounded-xl border border-foreground/10 bg-background shadow-sm p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Cuenta corriente</h2>
        {canEdit && (
          <div className="flex flex-wrap gap-3">
            {!isTreasury && (
              <FormModal
                triggerLabel={isCliente ? "Registrar cobro" : "Registrar pago"}
                title={isCliente ? "Registrar cobro" : "Registrar pago"}
                action={createPaymentForEntity}
              >
                <PaymentFormFields
                  fixedEntityId={entityId}
                  moneda={moneda}
                  entityNoun={isCliente ? "Cliente" : "Proveedor"}
                  treasuries={treasuries}
                  proveedores={isCliente ? proveedores : undefined}
                  cartera={cartera}
                  viajes={viajes}
                  rotuloSubcuenta={rotuloSubcuenta}
                />
              </FormModal>
            )}
            {/* Plata que entra desde un proveedor: nos paga algo que le vendimos o, en la cuenta del
                socio, un aporte de capital. Antes se cargaba como un pago en negativo. */}
            {(entityType === "PROVEEDOR" || esSocio) && (
              <FormModal
                triggerLabel={esSocio ? "Aporte o cobro" : "Registrar cobro"}
                title={esSocio ? "Aporte de capital o cobro" : `Cobro a ${entityName}`}
                action={registrarEntrada}
                peso="secundario"
              >
                <EntradaFormFields
                  entityId={entityId}
                  moneda={moneda}
                  esSocio={esSocio}
                  treasuries={treasuries.map((t) => ({ id: t.id, name: t.name }))}
                />
              </FormModal>
            )}
            {/* Un proveedor tiene tres formas de cargar algo en la cuenta y elegir mal es fácil —una
                factura de alquiler cargada como compra, o al revés— así que van detrás de un solo
                botón que las explica. Un cliente sólo carga notas y ajustes: ahí el botón directo
                es más corto. */}
            {isProveedor ? (
              <FormModal
                triggerLabel="Cargar"
                title="Cargar en la cuenta"
                action={cargarEnCuenta}
                maxWidthClass="max-w-5xl"
              >
                <CargarEnCuentaFields
                  entityId={entityId}
                  entityName={entityName}
                  moneda={moneda}
                  rubroGasto={rubroGasto}
                  isTreasury={isTreasury}
                  items={items ?? []}
                  viajes={viajes}
                  rotuloSubcuenta={rotuloSubcuenta}
                />
              </FormModal>
            ) : (
              <>
                {/* Lo que más sale de una caja: un sueldo, la limpieza, el remís. Con "Movimiento"
                    también se puede, pero hay que elegir categoría, rubro y signo. */}
                {isTreasury && (
                  <FormModal triggerLabel="Gasto" title={`Gasto de ${entityName}`} action={crearGastoDeCaja}>
                    <GastoDeCajaFields hoy={hoyEnInput()} cajaId={entityId} cajaNombre={entityName} />
                  </FormModal>
                )}
                <FormModal
                  triggerLabel="Movimiento"
                  title="Nuevo movimiento"
                  action={createDocumentForEntity}
                  peso="secundario"
                >
                  <DocumentFormFields
                    monedaCuenta={moneda}
                    fixedEntityId={entityId}
                    isTreasury={isTreasury}
                    viajes={viajes}
                    destinatarios={destinatarios}
                    rotuloSubcuenta={rotuloSubcuenta}
                  />
                </FormModal>
              </>
            )}
            {devolucion && !isTreasury && (
              <FormModal
                triggerLabel="Devolución"
                title="Devolución de mercadería"
                action={crearDevolucion}
                peso="secundario"
                maxWidthClass="max-w-3xl"
              >
                <DevolucionFields
                  entityId={entityId}
                  products={devolucion.products.map((p) => ({
                    id: p.id,
                    name: p.name,
                    oilType: p.oilType,
                    presentation: p.presentation,
                    boxesPerPallet: p.boxesPerPallet,
                    unitsPerBox: p.unitsPerBox,
                  }))}
                  priceMapByCircuit={devolucion.priceMapByCircuit}
                  moneda={moneda}
                  proximoNumero={devolucion.proximoNumero}
                  viajes={viajes}
                  destinatarios={destinatarios}
                  rotuloSubcuenta={rotuloSubcuenta}
                />
              </FormModal>
            )}
            {/* Un array vacío es truthy: sin este largo el botón salía siempre, y abría un modal
                que sólo podía decir que no había nada que agrupar. */}
            {isProveedor && pagosSinOrden && pagosSinOrden.length > 0 && (
              <FormModal
                triggerLabel="Orden de pago"
                title="Nueva orden de pago"
                action={crearOrdenPago}
                maxWidthClass="max-w-xl"
                peso="secundario"
              >
                <OrdenPagoFields entityId={entityId} pagos={pagosSinOrden} />
              </FormModal>
            )}
            {factura && (
              <FormModal
                // En un proveedor este botón sirve para UNA cosa: agrupar compras en su factura.
                // Decirle "Factura" a secas lo hacía competir con "Gasto" y ganaba el que sonaba
                // más parecido a lo que uno tiene en la mano.
                triggerLabel={isCliente ? "Factura" : "Facturar compras"}
                title={isCliente ? "Nueva factura" : "Facturar compras del proveedor"}
                action={createFactura}
                maxWidthClass="max-w-xl"
                peso="secundario"
              >
                <FacturaFormFields
                  monedaCuenta={moneda}
                  accountId={factura.blancoAccountId}
                  isWithholdingAgent={factura.isWithholdingAgent}
                  comprobantes={factura.comprobantes}
                  sustantivo={factura.sustantivo}
                  viajes={viajes}
                  destinatarios={destinatarios}
                />
              </FormModal>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2">
        {movements.map((movement) =>
          movement.kind === "document" ? (
            <div
              key={movement.document.id}
              className="flex items-center justify-between border-b border-foreground/5 pb-2"
            >
              <div>
                <p className="text-sm font-medium">
                  {isTreasury
                    ? tituloDeCaja(movement.document).title
                    : `${DOCUMENT_TYPE_LABELS[movement.document.type]} #${movement.document.number}`}
                </p>
                <p className="text-xs text-foreground/50">{formatFecha(movement.date)}</p>
              </div>
              <p className="text-sm font-semibold">
                {formatMoney(getDocumentEffect(movement.document), movement.document.currency)}
              </p>
            </div>
          ) : (
            <div
              key={movement.payment.id}
              className="flex items-center justify-between border-b border-foreground/5 pb-2"
            >
              <div>
                <p className="text-sm font-medium">
                  {movement.payment.concepto
                    ? PAYMENT_CONCEPTO_LABELS[movement.payment.concepto]
                    : entityType === "CLIENTE"
                      ? "Cobro"
                      : "Pago"}{" "}
                  — {PAYMENT_METHOD_LABELS[movement.payment.method]}
                </p>
                <p className="text-xs text-foreground/50">{formatFecha(movement.date)}</p>
              </div>
              <p className="text-sm font-semibold text-green-700 dark:text-green-400">
                {formatMoney(movement.payment.amount.abs(), movement.payment.currency)}
              </p>
            </div>
          )
        )}
        {movements.length === 0 && (
          <p className="py-4 text-center text-sm text-foreground/40">Sin movimientos.</p>
        )}
      </div>
    </div>
  );
}
