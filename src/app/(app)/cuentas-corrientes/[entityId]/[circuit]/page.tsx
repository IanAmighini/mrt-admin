import Link from "next/link";
import { Download } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { findBySlugOrId } from "@/lib/slug-lookup";
import { getTreasuries } from "@/lib/ledger";
import { circuitoDeTesoreria } from "@/lib/pagos";
import { puedeVerRuta } from "@/lib/nav";
import { CAJA_CHICA_SLUG } from "@/lib/caja";
import { getAccountStatement, type StatementEntry } from "@/lib/account-statement";
import { getCurrentPricesForAccount } from "@/lib/pricing";
import { formatMoney, formatNumeroExacto } from "@/lib/money";
import { CIRCUIT_BY_SLUG, CIRCUIT_LABELS, PAYMENT_CONCEPTO_LABELS } from "@/lib/labels";
import { desgloseDesdeDocumento } from "@/lib/impuestos";
import { facturaDeCompra } from "@/lib/compra-factura";
import {
  createDocumentForEntity,
  deleteCompra,
  deleteDocument,
  deleteFactura,
  deleteGasto,
  deletePayment,
  editarEntrada,
  deleteRemito,
  moveRemitoToBlanco,
  updateCompra,
  updateDocument,
  updateFactura,
  updateGasto,
  updatePayment,
  updateRemito,
} from "../actions";
import { FormModal } from "@/components/Modal";
import { DeleteButton } from "@/components/DeleteButton";
import { BotonConError } from "@/components/BotonConError";
import { RemitoFormFields, lineaDeRemito } from "@/components/RemitoForm";
import { CompraFormFields, filaDeCompra } from "@/components/CompraForm";
import { EditFacturaFields } from "@/components/EditFacturaFields";
import { GastoFormFields } from "@/components/GastoFormFields";
import { EditPaymentFields } from "@/components/EditPaymentFields";
import { EntradaFormFields } from "@/components/EntradaFormFields";
import { DocumentFormFields } from "@/components/DocumentFormFields";
import { GastoDeCajaFields } from "@/components/CajaFormFields";
import { crearGastoDeCaja } from "@/app/(app)/caja-chica/actions";
import { PROVEEDOR_DIRECTO_VALUE } from "@/lib/payment-destino";
import { addDays, formatFecha, hoyEnInput, parseFecha, toDateInputValue } from "@/lib/period";
import { getDestinatarios, getEntregasParaElegir } from "@/lib/entregas";
import { Pencil } from "lucide-react";
import { borrarVentaDeInsumo } from "@/app/(app)/stock/[itemId]/actions";
import { getVentasACobrar } from "@/lib/ventas-insumo";

const inputClass =
  "rounded-lg border border-foreground/20 bg-background px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary";

export default async function AccountLedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ entityId: string; circuit: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { entityId: entityParam, circuit: circuitSlug } = await params;
  const { from, to } = await searchParams;
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "SECRETARIA";

  const circuit = CIRCUIT_BY_SLUG[circuitSlug];
  if (!circuit) notFound();

  const entity = await findBySlugOrId(
    () => prisma.entity.findUnique({ where: { slug: entityParam } }),
    (id) => prisma.entity.findUnique({ where: { id } }),
    entityParam
  );
  if (!entity) notFound();
  if (entityParam !== entity.slug) redirect(`/cuentas-corrientes/${entity.slug}/${circuitSlug}`);
  const entityId = entity.id;
  const monedaCuenta = entity.moneda;
  const nombreEntidad = entity.name;
  const esSocio = entity.retiroSocietario;
  const rotuloSubcuenta = entity.rotuloSubcuenta ?? "Viaje";

  const account = await prisma.account.findUnique({
    where: { entityId_circuit: { entityId, circuit } },
  });
  if (!account) notFound();

  const isTreasuryEntity = entity.type === "TESORERIA";
  // Mismo corte que en la ficha: el libro mayor de una caja o del banco es Tesorería, aunque la
  // ruta la compartan los clientes y los proveedores.
  if (isTreasuryEntity && !puedeVerRuta(user.role, "/tesoreria")) {
    redirect(entity.slug === CAJA_CHICA_SLUG ? "/caja-chica" : "/");
  }
  // Una caja tiene una sola cuenta. Un link viejo a la otra mostraría un libro vacío que parece
  // que se perdió la plata, así que se lo manda a la buena.
  if (isTreasuryEntity && circuit !== circuitoDeTesoreria(entity.name)) {
    redirect(`/cuentas-corrientes/${entity.slug}/${circuitoDeTesoreria(entity.name).toLowerCase()}`);
  }
  const isClienteEntity = entity.type !== "PROVEEDOR" && entity.type !== "TESORERIA";

  // El "hasta" que elige el usuario es inclusivo; getAccountStatement lo espera exclusivo.
  const fromDate = from ? parseFecha(from) : null;
  const toDate = to ? addDays(parseFecha(to), 1) : null;

  const [statement, products, items, blancoPrices, negroPrices, treasuries, proveedores, viajes, destinatarios] =
    await Promise.all([
      getAccountStatement({ accountId: account.id, from: fromDate, to: toDate }),
      prisma.product.findMany({
        orderBy: [{ name: "asc" }, { oilType: "asc" }, { bottleCapacityMl: "asc" }, { boxesPerPallet: "asc" }],
      }),
      prisma.item.findMany({ orderBy: { name: "asc" } }),
      getCurrentPricesForAccount(entityId, "BLANCO"),
      getCurrentPricesForAccount(entityId, "NEGRO"),
      isTreasuryEntity ? Promise.resolve([]) : getTreasuries(),
      isClienteEntity
        ? prisma.entity.findMany({ where: { type: { in: ["PROVEEDOR", "AMBOS"] } }, orderBy: { name: "asc" } })
        : Promise.resolve([]),
      entity.llevaViajes ? getEntregasParaElegir(entityId) : Promise.resolve([]),
      entity.llevaViajes ? getDestinatarios(entityId) : Promise.resolve([]),
    ]);

  const priceMapByCircuit: Record<"BLANCO" | "NEGRO", Record<string, { amount: number; currency: string }>> = {
    BLANCO: {},
    NEGRO: {},
  };
  for (const [productId, price] of blancoPrices) {
    priceMapByCircuit.BLANCO[productId] = { amount: price.amount.toNumber(), currency: price.currency };
  }
  for (const [productId, price] of negroPrices) {
    priceMapByCircuit.NEGRO[productId] = { amount: price.amount.toNumber(), currency: price.currency };
  }

  // Las ventas de insumos de esta cuenta: se corrigen desde la ficha del insumo, que cambia la
  // cantidad, el precio y el stock juntos.
  const ventasDeInsumo = new Map(
    (
      await prisma.itemMovement.findMany({
        where: { type: "VENTA", document: { accountId: account.id } },
        select: { documentId: true, item: { select: { slug: true, name: true } } },
      })
    ).map((m) => [m.documentId!, m.item])
  );

  // Para editar los aportes y cobros a proveedores: el cheque que entró con cada uno y las ventas que
  // un cobro puede pagar (incluida la que ya paga, aunque haya quedado saldada).
  const entradas = statement.entries.flatMap((e) =>
    e.source.kind === "payment" && e.source.payment.concepto ? [e.source.payment] : []
  );
  const [chequesDeEntradas, ventasACobrar] = await Promise.all([
    entradas.length > 0
      ? prisma.cheque.findMany({ where: { recibidoEnId: { in: entradas.map((p) => p.id) } } })
      : Promise.resolve([]),
    entradas.length > 0 ? getVentasACobrar(entityId, entradas.map((p) => p.cobraDocumentoId)) : Promise.resolve([]),
  ]);
  const chequeDeEntrada = new Map(chequesDeEntradas.map((c) => [c.recibidoEnId!, c]));

  function renderActions(entry: StatementEntry): React.ReactNode {
    if (!canEdit) return null;

    if (entry.source.kind === "payment" && entry.source.payment.concepto) {
      // Un aporte o un cobro a un proveedor se edita con su propio formulario: el de pagos lo
      // guardaría como un pago común y daría vuelta el signo.
      const { payment } = entry.source;
      const etiqueta = PAYMENT_CONCEPTO_LABELS[payment.concepto!].toLowerCase();
      return (
        <div className="flex items-center gap-2">
          <FormModal triggerLabel="Editar" soloIcono iconName="edit" title={`Editar ${etiqueta}`} action={editarEntrada}>
            <EntradaFormFields
              entityId={entityId}
              moneda={monedaCuenta}
              esSocio={esSocio}
              treasuries={treasuries.map((t) => ({ id: t.id, name: t.name }))}
              defaults={{
                paymentId: payment.id,
                concepto: payment.concepto!,
                circuit,
                date: toDateInputValue(payment.date),
                amount: formatNumeroExacto((payment.amountArs ?? payment.amount).abs()),
                exchangeRate: formatNumeroExacto(payment.exchangeRate),
                method: payment.method,
                destino: payment.treasuryId ?? "",
                reference: payment.reference ?? "",
                numeroOperacion: payment.numeroOperacion ?? "",
                cobraDocumentoId: payment.cobraDocumentoId ?? "",
                chequeNumero: chequeDeEntrada.get(payment.id)?.numero ?? "",
                chequeBanco: chequeDeEntrada.get(payment.id)?.banco ?? "",
                chequeFechaCobro: chequeDeEntrada.get(payment.id)?.fechaCobro
                  ? toDateInputValue(chequeDeEntrada.get(payment.id)!.fechaCobro!)
                  : "",
              }}
              ventas={ventasACobrar}
            />
          </FormModal>
          <DeleteButton
            action={deletePayment}
            hiddenName="paymentId"
            hiddenValue={payment.id}
            nombre={`el ${etiqueta} de ${formatMoney(payment.amount.abs(), payment.currency)} del ${formatFecha(payment.date)}`}
            consecuencia="La plata sale de la caja a la que había entrado."
          />
        </div>
      );
    }

    if (entry.source.kind === "payment") {
      const { payment, linkedPayment } = entry.source;
      const defaultDestino = payment.treasuryId ?? (linkedPayment ? PROVEEDOR_DIRECTO_VALUE : "");
      return (
        <div className="flex items-center gap-2">
          <FormModal triggerLabel="Editar" soloIcono iconName="edit" title="Editar pago" action={updatePayment}>
            <EditPaymentFields
              paymentId={payment.id}
              moneda={monedaCuenta}
              treasuries={treasuries}
              proveedores={isClienteEntity ? proveedores : undefined}
              defaultValues={{
                circuit,
                method: payment.method,
                date: toDateInputValue(payment.date),
                // En una cuenta en dólares se edita en pesos, igual que se cargó: los pesos guardados,
                // no dólares × cotización, que por el redondeo daba otro número y al guardar lo pisaba.
                amount: (payment.amountArs ??
                  (payment.exchangeRate ? payment.amount.times(payment.exchangeRate).toDecimalPlaces(2) : payment.amount)
                ).toString(),
                exchangeRate: formatNumeroExacto(payment.exchangeRate),
                reference: payment.reference ?? undefined,
                numeroOperacion: payment.numeroOperacion ?? undefined,
                destino: defaultDestino,
                proveedorId: linkedPayment?.account.entityId,
                proveedorCircuit: linkedPayment?.account.circuit,
              }}
              viajes={viajes}
              rotuloSubcuenta={rotuloSubcuenta}
              defaultViajeId={payment.entregaId}
            />
          </FormModal>
          <DeleteButton
            action={deletePayment}
            hiddenName="paymentId"
            hiddenValue={payment.id}
            nombre={`el pago de ${formatMoney(payment.amount, payment.currency)} del ${formatFecha(payment.date)}`}
          />
        </div>
      );
    }

    const doc = entry.source.document;
    const headerDefaults = {
      number: doc.number,
      date: toDateInputValue(doc.date),
      dueDate: doc.dueDate ? toDateInputValue(doc.dueDate) : undefined,
      currency: doc.currency,
      exchangeRate: formatNumeroExacto(doc.exchangeRate),
      entregaId: doc.entregaId,
      destinatarioId: doc.destinatarioId,
    };

    const moveToBlanco =
      circuit === "NEGRO" && doc.remitoLinks.length === 0 ? (
        <BotonConError
          action={moveRemitoToBlanco}
          hidden={{ documentId: doc.id }}
          className="text-xs underline underline-offset-2"
        >
          Pasar a Cuenta 1 (c/factura)
        </BotonConError>
      ) : null;

    const insumoVendido = ventasDeInsumo.get(doc.id);
    if (insumoVendido) {
      return (
        <div className="flex items-center gap-2">
          <Link
            href={`/stock/${insumoVendido.slug}`}
            title={`Editar la venta en la ficha de ${insumoVendido.name}`}
            aria-label={`Editar la venta en la ficha de ${insumoVendido.name}`}
            className="rounded p-1 text-foreground/50 transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            <Pencil size={16} />
          </Link>
          <DeleteButton
            action={borrarVentaDeInsumo}
            hiddenName="documentId"
            hiddenValue={doc.id}
            nombre={`la venta #${doc.number}`}
            consecuencia={`${insumoVendido.name} vuelve al stock.`}
          />
        </div>
      );
    }

    // Una devolución: nota de crédito con la mercadería que volvió. No se edita —el importe y el
    // stock tienen que decir lo mismo—, se borra y se carga de nuevo.
    if (doc.type === "NOTA_CREDITO" && doc.lines.length > 0) {
      return (
        <DeleteButton
          action={deleteDocument}
          hiddenName="documentId"
          hiddenValue={doc.id}
          nombre={`la devolución #${doc.number}`}
          consecuencia="La mercadería devuelta sale del stock otra vez."
        />
      );
    }

    if (doc.lines.length > 0) {
      const defaultLines = doc.lines.map((l) => lineaDeRemito(l, circuit));
      return (
        <div className="flex items-center gap-2">
          <FormModal triggerLabel="Editar" soloIcono iconName="edit" title="Editar remito" action={updateRemito} maxWidthClass="max-w-3xl">
            <RemitoFormFields
              entityId={entityId}
              moneda={monedaCuenta}
              products={products}
              priceMapByCircuit={priceMapByCircuit}
              editingDocumentId={doc.id}
              defaultValues={headerDefaults}
              defaultLines={defaultLines}
              viajes={viajes}
              destinatarios={destinatarios}
              rotuloSubcuenta={rotuloSubcuenta}
            />
          </FormModal>
          <DeleteButton
            action={deleteRemito}
            hiddenName="documentId"
            hiddenValue={doc.id}
            nombre={`el remito #${doc.number}`}
          />
          {moveToBlanco}
        </div>
      );
    }

    if (doc.purchaseLines.length > 0) {
      return (
        <div className="flex items-center gap-2">
          <FormModal triggerLabel="Editar" soloIcono iconName="edit" title="Editar compra" action={updateCompra} maxWidthClass="max-w-5xl">
            <CompraFormFields
              entidad={{ id: entityId, name: nombreEntidad, moneda: monedaCuenta }}
              items={items}
              editingDocumentId={doc.id}
              defaultValues={headerDefaults}
              defaultRows={doc.purchaseLines.map((l) => filaDeCompra(l, circuit))}
              impuestos={desgloseDesdeDocumento(doc)}
              factura={facturaDeCompra(doc)}
            />
          </FormModal>
          <DeleteButton
            action={deleteCompra}
            hiddenName="documentId"
            hiddenValue={doc.id}
            nombre={`la compra #${doc.number}`}
            consecuencia="El stock que sumó se revierte."
          />
          {moveToBlanco}
        </div>
      );
    }

    if (doc.type === "FACTURA") {
      return (
        <div className="flex items-center gap-2">
          <FormModal triggerLabel="Editar" soloIcono iconName="edit" title="Editar factura" action={updateFactura}>
            <EditFacturaFields
              monedaCuenta={monedaCuenta}
              documentId={doc.id}
              defaultValues={{
                ...headerDefaults,
                netAmount: formatNumeroExacto(doc.netAmount),
                ivaRate: formatNumeroExacto(doc.ivaRate),
                retentionAmount: formatNumeroExacto(doc.retentionAmount),
                perceptionAmount: formatNumeroExacto(doc.perceptionAmount),
              }}
            />
          </FormModal>
          <DeleteButton
            action={deleteFactura}
            hiddenName="documentId"
            hiddenValue={doc.id}
            nombre={`la factura #${doc.number}`}
            consecuencia="Los remitos vinculados vuelven a quedar pendientes de facturar."
          />
        </div>
      );
    }

    if (doc.type === "GASTO") {
      return (
        <div className="flex items-center gap-2">
          <FormModal
            triggerLabel="Editar"
            soloIcono
            iconName="edit"
            title="Editar gasto"
            action={updateGasto}
            maxWidthClass="max-w-xl"
          >
            <GastoFormFields
              monedaCuenta={monedaCuenta}
              entityId={entityId}
              editingDocumentId={doc.id}
              defaultValues={{
                ...headerDefaults,
                circuit,
                expenseCategory: doc.expenseCategory ?? undefined,
                reason: doc.reason ?? undefined,
                amount: formatNumeroExacto(doc.totalAmount),
                retentionAmount: formatNumeroExacto(doc.retentionAmount),
                tributos: desgloseDesdeDocumento(doc),
              }}
              viajes={viajes}
              rotuloSubcuenta={rotuloSubcuenta}
            />
          </FormModal>
          <DeleteButton
            action={deleteGasto}
            hiddenName="documentId"
            hiddenValue={doc.id}
            nombre={`el gasto #${doc.number}`}
          />
        </div>
      );
    }

    return (
      <div className="flex items-center gap-2">
        <FormModal
          triggerLabel="Editar"
          soloIcono
          iconName="edit"
          title="Editar movimiento"
          action={updateDocument}
          maxWidthClass="max-w-xl"
        >
          <DocumentFormFields monedaCuenta={monedaCuenta}
            editingDocumentId={doc.id}
            circuitoFijo={circuit}
            isTreasury={isTreasuryEntity}
            defaultValues={{
              ...headerDefaults,
              type: doc.type as "NOTA_CREDITO" | "NOTA_DEBITO" | "AJUSTE",
              amount: formatNumeroExacto(doc.netAmount),
              ajusteEffect: doc.totalAmount.lessThan(0) ? "RESTA" : "SUMA",
              reason: doc.reason ?? undefined,
              impuestos: desgloseDesdeDocumento(doc),
            }}
          />
        </FormModal>
        <DeleteButton
          action={deleteDocument}
          hiddenName="documentId"
          hiddenValue={doc.id}
          nombre={`el movimiento #${doc.number}`}
        />
      </div>
    );
  }

  const exportQuery = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString();
  const exportHref = `/cuentas-corrientes/${entity.slug}/${circuitSlug}/export${exportQuery ? `?${exportQuery}` : ""}`;
  const hasFilter = Boolean(fromDate || toDate);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href={isTreasuryEntity ? "/tesoreria" : `/cuentas-corrientes/${entity.slug}`}
            className="text-sm underline underline-offset-2"
          >
            ← Volver a {isTreasuryEntity ? "Tesorería" : entity.name}
          </Link>
          <h1 className="text-xl font-semibold mt-2">
            {isTreasuryEntity ? entity.name : `${entity.name} — ${CIRCUIT_LABELS[circuit]}`}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isTreasuryEntity && canEdit && (
            <>
              {/* Lo que más sale de una caja: un sueldo, la limpieza, el remís. */}
              <FormModal triggerLabel="Gasto" title={`Gasto de ${entity.name}`} action={crearGastoDeCaja}>
                <GastoDeCajaFields hoy={hoyEnInput()} cajaId={entityId} cajaNombre={entity.name} />
              </FormModal>
              <FormModal triggerLabel="Movimiento" title="Nuevo movimiento" action={createDocumentForEntity} peso="secundario">
                <DocumentFormFields monedaCuenta={monedaCuenta} fixedEntityId={entityId} isTreasury />
              </FormModal>
            </>
          )}
          <a
            href={exportHref}
            className="flex w-fit items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
          >
            <Download size={16} />
            Descargar Excel
          </a>
        </div>
      </div>

      <form className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label className="text-xs text-foreground/60" htmlFor="from">
            Desde
          </label>
          <input id="from" type="date" name="from" defaultValue={from} className={`block ${inputClass}`} />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-foreground/60" htmlFor="to">
            Hasta
          </label>
          <input id="to" type="date" name="to" defaultValue={to} className={`block ${inputClass}`} />
        </div>
        <button type="submit" className={`${inputClass} hover:bg-foreground/5`}>
          Filtrar
        </button>
        {hasFilter && (
          <Link
            href={`/cuentas-corrientes/${entity.slug}/${circuitSlug}`}
            className="px-2 py-2 text-sm text-foreground/60 underline underline-offset-2"
          >
            Ver todo
          </Link>
        )}
      </form>

      {/* De a dos en el teléfono: una abajo de la otra ocupaban la pantalla entera antes del
          primer movimiento. */}
      <div className="grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {[
          ["Saldo anterior", statement.saldoAnterior],
          ["Debe", statement.totalDebe],
          ["Haber", statement.totalHaber],
          ["Saldo", statement.saldoFinal],
        ].map(([rotulo, monto]) => (
          <div key={String(rotulo)} className="min-w-0 rounded-xl border border-foreground/10 bg-background shadow-sm p-3 sm:p-4">
            <p className="text-xs text-foreground/60 sm:text-sm">{String(rotulo)}</p>
            <p className="text-base font-semibold tabular-nums sm:text-lg">{formatMoney(monto as typeof statement.saldoFinal)}</p>
          </div>
        ))}
      </div>

      {/* En el teléfono, una lista: la tabla de cinco columnas dejaba la descripción en una tira de
          tres palabras por renglón y los montos cortados contra el borde. */}
      <ul className="divide-y divide-foreground/5 border-y border-foreground/10 sm:hidden">
        {statement.entries
          .slice()
          .reverse()
          .map((entry) => (
            <li key={entry.key} className="space-y-2 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-foreground/50">{formatFecha(entry.date)}</p>
                  <p className="text-sm font-medium break-words">{entry.title}</p>
                  {entry.subtitle && <p className="text-xs text-foreground/50 break-words">{entry.subtitle}</p>}
                </div>
                <div className="shrink-0 text-right tabular-nums">
                  <p className="text-sm font-semibold">
                    {entry.debe.isZero() ? `−${formatMoney(entry.haber)}` : `+${formatMoney(entry.debe)}`}
                  </p>
                  <p className="text-xs text-foreground/50">Saldo {formatMoney(entry.saldoAcumulado)}</p>
                </div>
              </div>
              {canEdit && <div className="flex justify-end">{renderActions(entry)}</div>}
            </li>
          ))}
        {fromDate && (
          <li className="flex items-center justify-between gap-3 py-3 text-sm font-medium">
            <span>Saldo anterior al {formatFecha(fromDate)}</span>
            <span className="tabular-nums">{formatMoney(statement.saldoAnterior)}</span>
          </li>
        )}
        {statement.entries.length === 0 && (
          <li className="py-6 text-center text-sm text-foreground/40">
            {hasFilter ? "Sin movimientos en este período." : "Sin movimientos todavía."}
          </li>
        )}
      </ul>

      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-foreground/10 text-left text-foreground/60">
              <th className="py-2 pr-4">Fecha</th>
              <th className="py-2 pr-4">Descripción</th>
              <th className="py-2 pr-4">Debe</th>
              <th className="py-2 pr-4">Haber</th>
              <th className="py-2 pr-4">Saldo Acum.</th>
              {canEdit && <th className="py-2 pr-4"></th>}
            </tr>
          </thead>
          <tbody>
            {statement.entries
              .slice()
              .reverse()
              .map((entry) => (
                <tr key={entry.key} className="border-b border-foreground/5">
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {formatFecha(entry.date)}
                  </td>
                  <td className="py-2 pr-4">
                    {entry.title}
                    {entry.subtitle && (
                      <p className="text-xs font-normal text-foreground/50">{entry.subtitle}</p>
                    )}
                  </td>
                  <td className="py-2 pr-4">{entry.debe.isZero() ? "—" : formatMoney(entry.debe)}</td>
                  <td className="py-2 pr-4">{entry.haber.isZero() ? "—" : formatMoney(entry.haber)}</td>
                  <td className="py-2 pr-4 font-medium">{formatMoney(entry.saldoAcumulado)}</td>
                  {canEdit && <td className="py-2 pr-4">{renderActions(entry)}</td>}
                </tr>
              ))}
            {fromDate && (
              <tr className="border-b border-foreground/5 bg-foreground/[0.02] font-medium">
                <td className="py-2 pr-4 whitespace-nowrap">{formatFecha(fromDate)}</td>
                <td className="py-2 pr-4">Saldo anterior</td>
                <td className="py-2 pr-4">—</td>
                <td className="py-2 pr-4">—</td>
                <td className="py-2 pr-4">{formatMoney(statement.saldoAnterior)}</td>
                {canEdit && <td className="py-2 pr-4"></td>}
              </tr>
            )}
            {statement.entries.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 6 : 5} className="py-6 text-center text-foreground/40">
                  {hasFilter ? "Sin movimientos en este período." : "Sin movimientos todavía."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
