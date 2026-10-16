import type { Entity, Product } from "@prisma/client";
import { DevolucionFields } from "./DevolucionFields";
import { formatFecha, hoyEnInput } from "@/lib/period";
import type { RecentMovement } from "@/lib/ledger";
import { getDocumentEffect, getDocumentPending } from "@/lib/ledger";
import Link from "next/link";
import { ETIQUETA, ETIQUETA_DESTACADA, EstadoDePago } from "./Etiquetas";
import { formatMoney } from "@/lib/money";
import { tituloDeCaja } from "@/lib/account-statement";
import { CIRCUIT_LABELS, DOCUMENT_TYPE_LABELS, PAYMENT_CONCEPTO_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { EntradaFormFields, type VentaOpcion } from "./EntradaFormFields";
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
  parte,
  entitySlug,
  entityId,
  entityName,
  entityType,
  esSocio = false,
  ventasACobrar = [],
  rubroGasto,
  moneda,
  movements,
  canEdit,
  factura,
  treasuries,
  proveedores,
  cartera,
  saldos,
  pagosSinOrden,
  items,
  viajes,
  destinatarios,
  rotuloSubcuenta,
  devolucion,
}: {
  /**
   * La ficha muestra los botones arriba de todo y los movimientos en su tarjeta, cada parte por su
   * lado. Sin esto, las dos juntas en una tarjeta, como se usa en la ficha de una caja.
   */
  parte?: "acciones" | "movimientos";
  /** Para los links al libro mayor de cada cuenta. */
  entitySlug?: string;
  entityId: string;
  entityName: string;
  entityType: Entity["type"];
  /** La cuenta por la que se retira para los socios: además de cobros, carga aportes de capital. */
  esSocio?: boolean;
  /** Las ventas de insumos que el proveedor todavía no nos pagó, para que el cobro diga cuál paga. */
  ventasACobrar?: VentaOpcion[];
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
  /** Lo que tiene cada cuenta ahora: el formulario de cobro o pago lo muestra al elegir la cuenta. */
  saldos?: { blanco: number; negro: number };
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

  const acciones = canEdit ? (
          <div className="flex flex-wrap gap-2">
            {!isTreasury && (
              <FormModal
                triggerLabel={isCliente ? "Registrar cobro" : "Registrar pago"}
                title={isCliente ? "Registrar cobro" : "Registrar pago"}
                action={createPaymentForEntity}
                maxWidthClass="max-w-xl"
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
                  saldos={saldos ? { [entityId]: saldos } : undefined}
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
                  ventas={ventasACobrar}
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
                peso="secundario"
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
  ) : null;

  if (parte === "acciones") return acciones;

  const lista = (
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
  );

  // Una caja lee sus movimientos con su propio título ("Pago a Teoplast — Efectivo"): sigue con la
  // lista de siempre.
  if (parte === "movimientos" && isTreasury) {
    return (
      <div className="rounded-xl border border-foreground/10 bg-background shadow-sm p-5 space-y-4">
        <h2 className="text-sm font-semibold">Movimientos</h2>
        {lista}
      </div>
    );
  }

  if (parte === "movimientos") {
    return (
      <MovimientosRecientes
        movements={movements}
        entitySlug={entitySlug}
        esCliente={entityType === "CLIENTE"}
      />
    );
  }

  return (
    <div className="rounded-xl border border-foreground/10 bg-background shadow-sm p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Cuenta corriente</h2>
        {acciones}
      </div>
      {lista}
    </div>
  );
}

/**
 * Lo último que pasó en la cuenta, de las dos cuentas juntas: una fila por movimiento, con lo que
 * hay que saber de un vistazo en etiquetas —por qué medio entró, a qué caja, en qué cuenta, si el
 * comprobante ya está pagado— y el monto a la derecha. Lo completo está en el libro mayor.
 */
function MovimientosRecientes({
  movements,
  entitySlug,
  esCliente,
}: {
  movements: RecentMovement[];
  entitySlug?: string;
  esCliente: boolean;
}) {
  const cuenta = (c: "BLANCO" | "NEGRO") => CIRCUIT_LABELS[c].split(" (")[0];
  return (
    <section className="rounded-xl border border-foreground/10 bg-background shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <h2 className="text-sm font-semibold">Últimos movimientos</h2>
        {entitySlug && (
          <div className="flex items-center gap-3 text-xs">
            <span className="text-foreground/50">Libro mayor:</span>
            <Link href={`/cuentas-corrientes/${entitySlug}/blanco`} className="font-medium hover:underline">
              Cuenta 1 →
            </Link>
            <Link href={`/cuentas-corrientes/${entitySlug}/negro`} className="font-medium hover:underline">
              Cuenta 2 →
            </Link>
          </div>
        )}
      </div>
      <div className="divide-y divide-foreground/10 border-t border-foreground/10">
        {movements.map((m) => {
          if (m.kind === "payment") {
            const p = m.payment;
            const entra = p.concepto !== null || esCliente;
            const cheques = [...p.chequesEntregados, ...(p.chequeRecibido ? [p.chequeRecibido] : [])].map((c) => `#${c.numero}`);
            const medio = [
              PAYMENT_METHOD_LABELS[p.method],
              p.numeroOperacion ? `Op. ${p.numeroOperacion}` : null,
              cheques.length > 0 ? cheques.join(", ") : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <div key={p.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {p.concepto ? PAYMENT_CONCEPTO_LABELS[p.concepto] : esCliente ? "Cobro" : "Pago"}{" "}
                    <span className="font-normal text-foreground/50">· {formatFecha(p.date)}</span>
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <span className={ETIQUETA}>{medio}</span>
                    {m.directo ? (
                      <span className={ETIQUETA_DESTACADA}>{esCliente ? `→ ${m.directo}` : `cobro directo de ${m.directo}`}</span>
                    ) : (
                      p.treasury && <span className={ETIQUETA}>{entra ? `→ ${p.treasury.name}` : `desde ${p.treasury.name}`}</span>
                    )}
                    <span className={ETIQUETA}>{cuenta(m.circuit)}</span>
                  </div>
                </div>
                <p className="shrink-0 text-sm font-semibold tabular-nums text-green-700 dark:text-green-400">
                  {formatMoney(p.amount.abs(), p.currency)}
                </p>
              </div>
            );
          }
          const d = m.document;
          const efecto = getDocumentEffect(d);
          const esVenta = (d.type === "NOTA_DEBITO" || d.type === "NOTA_CREDITO") && Boolean(d.reason?.startsWith("Venta de "));
          const titulo =
            d.type === "NOTA_CREDITO" && d.lines.length > 0
              ? "Devolución"
              : esVenta
                ? "Venta de insumo"
                : d.number === "SALDO-INICIAL"
                  ? "Saldo inicial"
                  : DOCUMENT_TYPE_LABELS[d.type];
          return (
            <div key={d.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {titulo}
                  {d.number !== "SALDO-INICIAL" && ` #${d.number}`}{" "}
                  <span className="font-normal text-foreground/50">· {formatFecha(d.date)}</span>
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <span className={ETIQUETA}>{cuenta(m.circuit)}</span>
                  {/* Sólo lo que suma deuda tiene algo que pagar o cobrar. */}
                  {efecto.greaterThan(0) && (
                    <EstadoDePago pendiente={getDocumentPending(d)} total={efecto} moneda={d.currency} verbo={esCliente ? "Cobrado" : "Pagado"} />
                  )}
                </div>
              </div>
              <p className="shrink-0 text-sm font-semibold tabular-nums">{formatMoney(efecto, d.currency)}</p>
            </div>
          );
        })}
        {movements.length === 0 && <p className="px-4 py-6 text-center text-sm text-foreground/40">Sin movimientos.</p>}
      </div>
    </section>
  );
}
