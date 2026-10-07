import Link from "next/link";
import type { Currency, EntityType, PaymentMethod, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { getRecentPayments, getTreasuries } from "@/lib/ledger";
import { formatMoney, formatNumeroExacto, ZERO } from "@/lib/money";
import { CIRCUIT_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { FormModal } from "./Modal";
import { DeleteButton } from "./DeleteButton";
import { PaymentFormFields } from "./PaymentFormFields";
import { getCarteraParaFormulario } from "@/lib/cheques";
import { PROVEEDOR_DIRECTO_VALUE } from "@/lib/payment-destino";
import { EditPaymentFields } from "./EditPaymentFields";
import {
  createPaymentForEntity,
  deletePayment,
  updatePayment,
} from "@/app/(app)/cuentas-corrientes/[entityId]/actions";
import { addDays, formatFecha, parseFecha, toDateInputValue } from "@/lib/period";
import { FilterBar, FiltroFechas, FiltroSelect } from "@/components/ui/FilterBar";
import { APILADA } from "@/components/ui/Table";

export type FiltrosDePagos = { entityId?: string; medio?: string; from?: string; to?: string };

export async function PagosPageContent({
  typeFilter,
  title,
  entityNoun,
  basePath,
  filtros = {},
}: {
  typeFilter: EntityType[];
  title: string;
  entityNoun: string;
  /** Para el botón Limpiar de los filtros. */
  basePath: string;
  filtros?: FiltrosDePagos;
}) {
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "SECRETARIA";
  const isCobro = entityNoun === "Cliente";
  // Lo que entra de un cliente es un cobro; lo que sale a un proveedor, un pago.
  const pago = isCobro ? "cobro" : "pago";

  const medio = filtros.medio && filtros.medio in PAYMENT_METHOD_LABELS ? (filtros.medio as PaymentMethod) : undefined;
  const hayFiltro = Boolean(filtros.entityId || medio || filtros.from || filtros.to);

  const [entities, pagos, treasuries, proveedores, cartera, conSubcuentas] = await Promise.all([
    prisma.entity.findMany({ where: { type: { in: typeFilter } }, orderBy: { name: "asc" } }),
    // Sin filtros, los últimos 30, que es lo que se mira para ver si ya se cargó algo. Con filtros,
    // todo lo que coincida: es para sumar un período o un cliente, y cortar en 30 daría mal el total.
    getRecentPayments(typeFilter, hayFiltro ? 2000 : 30, {
      entityId: filtros.entityId || undefined,
      method: medio,
      from: filtros.from ? parseFecha(filtros.from) : null,
      to: filtros.to ? addDays(parseFecha(filtros.to), 1) : null,
    }),
    getTreasuries(),
    isCobro
      ? prisma.entity.findMany({ where: { type: { in: ["PROVEEDOR", "AMBOS"] } }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
    // Para pagarle a un proveedor con cheques de la cartera. Antes sólo estaba en la ficha del
    // proveedor, y desde acá no había forma de elegir uno: se cargaba como cheque nuevo.
    isCobro ? Promise.resolve([]) : getCarteraParaFormulario(),
    // Los que dividen su cuenta: el selector de subcuenta aparece sólo al elegir uno de éstos.
    prisma.entity.findMany({
      where: { type: { in: typeFilter }, llevaViajes: true },
      select: {
        id: true,
        rotuloSubcuenta: true,
        entregas: { select: { id: true, nombre: true, destino: true }, orderBy: [{ fecha: "desc" }, { createdAt: "desc" }] },
      },
    }),
  ]);
  const subcuentasPorEntidad = Object.fromEntries(
    conSubcuentas.map((e) => [e.id, { viajes: e.entregas, rotulo: e.rotuloSubcuenta ?? "Viaje" }])
  );

  const linkedPaymentIds = pagos.map((p) => p.linkedPaymentId).filter((id): id is string => !!id);
  const linkedPayments = linkedPaymentIds.length
    ? await prisma.payment.findMany({
        where: { id: { in: linkedPaymentIds } },
        include: { account: { include: { entity: true } } },
      })
    : [];
  const linkedPaymentById = new Map(linkedPayments.map((p) => [p.id, p]));
  const treasuryById = new Map(treasuries.map((t) => [t.id, t]));

  // El total de lo que se está viendo, por moneda: un cobro en dólares no se suma a los pesos.
  const totalPorMoneda = new Map<string, Prisma.Decimal>();
  for (const p of pagos) totalPorMoneda.set(p.currency, (totalPorMoneda.get(p.currency) ?? ZERO).plus(p.amount));
  const totales = Array.from(totalPorMoneda.entries())
    .sort(([a]) => (a === "ARS" ? -1 : 1))
    .map(([moneda, monto]) => formatMoney(monto, moneda as Currency))
    .join(" + ");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold mb-1">{title}</h1>
          <p className="text-sm text-foreground/60">
            {hayFiltro
              ? `${pagos.length} ${pagos.length === 1 ? pago : `${pago}s`}${totales ? ` · ${totales}` : ""}`
              : `Últimos ${pagos.length} ${pago}s · ${totales || formatMoney(0)}`}
          </p>
        </div>
        {canEdit && (
          <FormModal
            triggerLabel={`Nuevo ${pago}`}
            title={`Registrar ${pago}`}
            action={createPaymentForEntity}
            maxWidthClass="max-w-xl"
          >
            <PaymentFormFields
              entities={entities}
              entityNoun={entityNoun}
              treasuries={treasuries}
              cartera={isCobro ? undefined : cartera}
              proveedores={isCobro ? proveedores : undefined}
              subcuentasPorEntidad={subcuentasPorEntidad}
            />
          </FormModal>
        )}
      </div>

      <FilterBar limpiarHref={basePath} hayFiltro={hayFiltro}>
        <FiltroSelect
          label={entityNoun}
          name="entityId"
          defaultValue={filtros.entityId}
          opciones={entities.map((e) => ({ value: e.id, label: e.name }))}
          className="w-full sm:w-56"
        />
        <FiltroSelect
          label="Medio"
          name="medio"
          defaultValue={medio}
          opciones={Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({ value, label }))}
        />
        <FiltroFechas from={filtros.from} to={filtros.to} />
      </FilterBar>

      <section>
        <h2 className="text-sm font-semibold mb-2">{hayFiltro ? `${pago[0].toUpperCase()}${pago.slice(1)}s` : `Últimos ${pago}s`}</h2>
        <div className="overflow-x-auto">
          <table className={`w-full text-sm ${APILADA}`}>
            <thead>
              <tr className="border-b border-foreground/10 text-left text-foreground/60">
                <th className="py-2 pr-4">{entityNoun}</th>
                <th className="py-2 pr-4">Monto</th>
                <th className="py-2 pr-4">Medio</th>
                <th className="py-2 pr-4">{isCobro ? "Destino" : "Origen"}</th>
                <th className="py-2 pr-4">Descripción</th>
                <th className="py-2 pr-4">Fecha</th>
                {canEdit && <th className="py-2 pr-4">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {pagos.map((payment) => {
                const linkedPayment = payment.linkedPaymentId
                  ? linkedPaymentById.get(payment.linkedPaymentId)
                  : undefined;
                const destinoLabel = payment.treasuryId
                  ? treasuryById.get(payment.treasuryId)?.name
                  : linkedPayment
                    ? `Directo a ${linkedPayment.account.entity.name}${
                        linkedPayment.account.circuit === payment.account.circuit
                          ? ""
                          : ` (${CIRCUIT_LABELS[linkedPayment.account.circuit]})`
                      }`
                    : null;
                const defaultDestino = payment.treasuryId ?? (linkedPayment ? PROVEEDOR_DIRECTO_VALUE : "");
                return (
                  <tr key={payment.id} className="border-b border-foreground/5">
                    <td className="py-2 pr-4">
                      <Link
                        href={`/cuentas-corrientes/${payment.account.entity.slug}`}
                        className="underline underline-offset-2"
                      >
                        {payment.account.entity.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">{formatMoney(payment.amount, payment.currency)}</td>
                    <td className="py-2 pr-4">{PAYMENT_METHOD_LABELS[payment.method]}</td>
                    <td className="py-2 pr-4">{destinoLabel ?? "—"}</td>
                    <td className="py-2 pr-4">
                      {[payment.numeroOperacion && `Op. ${payment.numeroOperacion}`, payment.reference].filter(Boolean).join(" · ") ||
                        "—"}
                    </td>
                    <td className="py-2 pr-4">{formatFecha(payment.date)}</td>
                    {canEdit && (
                      <td className="py-2 pr-4">
                        <div className="flex items-center gap-2">
                          <FormModal
                            triggerLabel="Editar"
                            soloIcono
                            iconName="edit"
                            title={`Editar ${pago}`}
                            action={updatePayment}
                            maxWidthClass="max-w-xl"
                          >
                            <EditPaymentFields
                              paymentId={payment.id}
                              moneda={payment.account.entity.moneda}
                              treasuries={treasuries}
                              proveedores={isCobro ? proveedores : undefined}
                              defaultValues={{
                                circuit: payment.account.circuit,
                                method: payment.method,
                                date: toDateInputValue(payment.date),
                                // En una cuenta en dólares se edita en pesos, igual que se cargó:
                                // se rehace la multiplicación para prellenar lo que salió del banco.
                                amount: (payment.exchangeRate
                                  ? payment.amount.times(payment.exchangeRate)
                                  : payment.amount
                                ).toString(),
                                exchangeRate: formatNumeroExacto(payment.exchangeRate),
                                reference: payment.reference ?? undefined,
                                numeroOperacion: payment.numeroOperacion ?? undefined,
                                destino: defaultDestino,
                                proveedorId: linkedPayment?.account.entityId,
                                proveedorCircuit: linkedPayment?.account.circuit,
                              }}
                              viajes={subcuentasPorEntidad[payment.account.entityId]?.viajes}
                              rotuloSubcuenta={subcuentasPorEntidad[payment.account.entityId]?.rotulo}
                              defaultViajeId={payment.entregaId}
                            />
                          </FormModal>
                          <DeleteButton
                            action={deletePayment}
                            hiddenName="paymentId"
                            hiddenValue={payment.id}
                            nombre={`el ${pago} de ${formatMoney(payment.amount, payment.currency)} del ${formatFecha(payment.date)}`}
                          />
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {pagos.length === 0 && (
                <tr>
                  <td colSpan={canEdit ? 7 : 6} className="py-6 text-center text-foreground/40">
                    {hayFiltro ? `No hay ${pago}s con este filtro.` : `Todavía no hay ${pago}s cargados.`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
