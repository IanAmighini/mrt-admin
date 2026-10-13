import Link from "next/link";
import type { Currency, EntityType, PaymentMethod, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { getRecentPayments, getTreasuries, getUltimaCotizacion } from "@/lib/ledger";
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
import { addDays, formatFecha, hoyEnInput, parseFecha, toDateInputValue } from "@/lib/period";
import { FilterBar, FiltroFechas, FiltroSelect } from "@/components/ui/FilterBar";
import { TarjetasDeSaldo, iniciales, type TarjetaDeSaldo } from "@/components/CuentasLista";
import { formatNumeroOP } from "@/lib/orden-pago";

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

  // Lo que vale cada pago en pesos, para sumar: en una cuenta en dólares, los pesos que salieron o
  // entraron (que son el dato), y si no los hay, dólares × la cotización del pago o la última.
  const ultima = (await getUltimaCotizacion())?.toNumber() ?? null;
  const enPesos = (p: { amount: Prisma.Decimal; currency: string; amountArs: Prisma.Decimal | null; exchangeRate: Prisma.Decimal | null }) =>
    p.currency !== "USD"
      ? p.amount.toNumber()
      : (p.amountArs?.toNumber() ?? p.amount.toNumber() * (p.exchangeRate?.toNumber() ?? ultima ?? 0));

  // Las fechas de los atajos y de las tarjetas, en el día de acá.
  const hoy = hoyEnInput();
  const dia = (d: Date) => toDateInputValue(d);
  const menosDias = (n: number) => dia(new Date(parseFecha(hoy).getTime() - n * 86_400_000));
  const inicioMes = `${hoy.slice(0, 8)}01`;
  const finMesPasado = dia(new Date(parseFecha(inicioMes).getTime() - 86_400_000));
  const inicioMesPasado = `${finMesPasado.slice(0, 8)}01`;
  const hace7 = menosDias(6);
  const nombreMes = parseFecha(hoy).toLocaleDateString("es-AR", { month: "long", timeZone: "UTC" });

  const [delMes, sinOrden] = await Promise.all([
    prisma.payment.findMany({
      where: { concepto: null, date: { gte: parseFecha(inicioMes < hace7 ? inicioMes : hace7) }, account: { entity: { type: { in: typeFilter } } } },
      select: { date: true, amount: true, currency: true, amountArs: true, exchangeRate: true, method: true, linkedPaymentId: true },
    }),
    // Los pagos de la Cuenta 1 que todavía no están en una orden de pago.
    isCobro
      ? Promise.resolve([])
      : prisma.payment.findMany({
          where: { concepto: null, ordenPagoId: null, account: { circuit: "BLANCO", entity: { type: { in: typeFilter } } } },
          select: { amount: true, currency: true, amountArs: true, exchangeRate: true, account: { select: { entity: { select: { name: true } } } } },
        }),
  ]);
  const esteMes = delMes.filter((p) => dia(p.date) >= inicioMes);
  const ultimos7 = delMes.filter((p) => dia(p.date) >= hace7);
  const suma = (lista: Parameters<typeof enPesos>[0][]) => lista.reduce((a, p) => a + enPesos(p), 0);
  const directos = esteMes.filter((p) => p.linkedPaymentId);

  // Cuánto del mes entró (o salió) por cada medio, para la barra.
  const porMedio = Array.from(
    esteMes.reduce((m, p) => m.set(p.method, (m.get(p.method) ?? 0) + enPesos(p)), new Map<PaymentMethod, number>())
  ).sort((a, b) => b[1] - a[1]);
  const totalMes = suma(esteMes);

  const tarjetas: TarjetaDeSaldo[] = [
    {
      label: `${isCobro ? "Cobrado" : "Pagado"} en ${nombreMes}`,
      cantidad: esteMes.length,
      valor: formatMoney(totalMes),
      href: `${basePath}?from=${inicioMes}&to=${hoy}`,
      activa: filtros.from === inicioMes && filtros.to === hoy && !filtros.entityId && !medio,
    },
    {
      label: "Últimos 7 días",
      cantidad: ultimos7.length,
      valor: formatMoney(suma(ultimos7)),
      href: `${basePath}?from=${hace7}&to=${hoy}`,
      activa: filtros.from === hace7 && filtros.to === hoy && !filtros.entityId && !medio,
    },
    isCobro
      ? {
          label: "Directo a proveedores",
          cantidad: directos.length,
          valor: formatMoney(suma(directos)),
          detalle: "este mes, sin pasar por ninguna caja",
        }
      : {
          label: "Cuenta 1 sin orden de pago",
          cantidad: sinOrden.length,
          valor: formatMoney(suma(sinOrden)),
          detalle:
            sinOrden.length > 0
              ? `${Array.from(new Set(sinOrden.map((p) => p.account.entity.name))).slice(0, 3).join(", ")} — se arma desde su ficha`
              : "todos tienen su orden",
          tono: sinOrden.length > 0 ? "deuda" : "neutro",
        },
  ];

  const atajos = [
    { label: "Este mes", from: inicioMes, to: hoy },
    { label: "Mes pasado", from: inicioMesPasado, to: finMesPasado },
    { label: "Últimos 7 días", from: hace7, to: hoy },
  ];
  const conFiltros = (extra: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ entityId: filtros.entityId, medio, from: filtros.from, to: filtros.to, ...extra })) if (v) q.set(k, v);
    const t = q.toString();
    return t ? `${basePath}?${t}` : basePath;
  };

  // La lista, de a un día por bloque y con su subtotal: es como se controla contra el extracto.
  const porDia = new Map<string, typeof pagos>();
  for (const p of pagos) porDia.set(dia(p.date), [...(porDia.get(dia(p.date)) ?? []), p]);
  const ayer = menosDias(1);
  const tituloDelDia = (d: string) => {
    const fecha = parseFecha(d);
    const semana = fecha.toLocaleDateString("es-AR", { weekday: "long", timeZone: "UTC" });
    const corto = fecha.toLocaleDateString("es-AR", { day: "numeric", month: "numeric", timeZone: "UTC" });
    if (d === hoy) return `Hoy · ${semana} ${corto}`;
    if (d === ayer) return `Ayer · ${semana} ${corto}`;
    return `${semana[0].toUpperCase()}${semana.slice(1)} ${corto}${d.slice(0, 4) !== hoy.slice(0, 4) ? `/${d.slice(0, 4)}` : ""}`;
  };
  const sumarPorMoneda = (lista: typeof pagos) => {
    const m = new Map<Currency, Prisma.Decimal>();
    for (const p of lista) m.set(p.currency, (m.get(p.currency) ?? ZERO).plus(p.amount));
    return Array.from(m.entries())
      .sort(([a]) => (a === "ARS" ? -1 : 1))
      .map(([moneda, monto]) => formatMoney(monto, moneda))
      .join(" + ");
  };
  const totales = sumarPorMoneda(pagos);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold mb-1">{title}</h1>
          <p className="text-sm text-foreground/60">
            {hayFiltro
              ? `${pagos.length} ${pagos.length === 1 ? pago : `${pago}s`}${totales ? ` · ${totales}` : ""}`
              : `Los últimos ${pagos.length} ${pago}s`}
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

      <TarjetasDeSaldo tarjetas={tarjetas} />

      {/* Por qué medio entró (o salió) la plata del mes. Cada medio filtra la lista. */}
      {totalMes > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-foreground/60">Por medio, en {nombreMes}</p>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-foreground/[0.06]">
            {porMedio.map(([m, v]) => (
              <div key={m} className={COLOR_DE_MEDIO[m]} style={{ width: `${(v / totalMes) * 100}%` }} title={PAYMENT_METHOD_LABELS[m]} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {porMedio.map(([m, v]) => (
              <Link
                key={m}
                href={`${basePath}?medio=${m}&from=${inicioMes}&to=${hoy}`}
                className={`flex items-center gap-1.5 rounded px-1 py-0.5 transition-colors hover:bg-foreground/5 ${medio === m ? "font-semibold" : "text-foreground/70"}`}
              >
                <span className={`inline-block h-2.5 w-2.5 rounded-sm ${COLOR_DE_MEDIO[m]}`} />
                {PAYMENT_METHOD_LABELS[m]} <span className="tabular-nums text-foreground/50">{formatMoney(v)} · {v / totalMes < 0.01 ? "menos de 1" : Math.round((v / totalMes) * 100)}%</span>
              </Link>
            ))}
          </div>
        </div>
      )}

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

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-foreground/50">Ver:</span>
        {atajos.map((a) => {
          const activo = filtros.from === a.from && filtros.to === a.to;
          return (
            <Link
              key={a.label}
              href={conFiltros({ from: a.from, to: a.to })}
              className={`rounded-full border px-3 py-1 transition-colors ${
                activo ? "border-primary bg-primary/20 font-medium" : "border-foreground/15 text-foreground/70 hover:border-primary"
              }`}
            >
              {a.label}
            </Link>
          );
        })}
      </div>

      <div className="space-y-5">
        {Array.from(porDia.entries()).map(([d, delDia]) => (
          <section key={d} className="space-y-2">
            <div className="flex items-baseline justify-between gap-3 px-1 text-sm">
              <h2 className="font-medium text-foreground/70">{tituloDelDia(d)}</h2>
              <span className="tabular-nums text-foreground/60">{sumarPorMoneda(delDia)}</span>
            </div>
            <div className="divide-y divide-foreground/10 rounded-xl border border-foreground/10 bg-background shadow-sm">
              {delDia.map((payment) => {
                const linkedPayment = payment.linkedPaymentId ? linkedPaymentById.get(payment.linkedPaymentId) : undefined;
                const destinoLabel = payment.treasuryId
                  ? treasuryById.get(payment.treasuryId)?.name
                  : linkedPayment
                    ? `${isCobro ? "Directo a" : "Directo de"} ${linkedPayment.account.entity.name}${
                        linkedPayment.account.circuit === payment.account.circuit
                          ? ""
                          : ` (${CIRCUIT_LABELS[linkedPayment.account.circuit]})`
                      }`
                    : null;
                const defaultDestino = payment.treasuryId ?? (linkedPayment ? PROVEEDOR_DIRECTO_VALUE : "");
                const cheques = [
                  ...payment.chequesEntregados,
                  ...(payment.chequeRecibido ? [payment.chequeRecibido] : []),
                ].map((c) => `#${c.numero}`);
                const medioLabel = [
                  PAYMENT_METHOD_LABELS[payment.method],
                  payment.numeroOperacion ? `Op. ${payment.numeroOperacion}` : null,
                  cheques.length > 0 ? cheques.join(", ") : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                // La descripción de un cobro directo repite lo que ya dice la etiqueta.
                const descripcion = payment.reference?.startsWith("Cobro directo de ") ? null : payment.reference;
                return (
                  <div key={payment.id} className="flex items-center gap-3 px-4 py-3 first:rounded-t-xl last:rounded-b-xl">
                    <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] text-xs font-semibold text-foreground/60 sm:flex">
                      {iniciales(payment.account.entity.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/cuentas-corrientes/${payment.account.entity.slug}`}
                        className="font-medium hover:underline hover:underline-offset-2"
                      >
                        {payment.account.entity.name}
                      </Link>
                      {/* En el celular el monto va acá: a la derecha pisaba las etiquetas. */}
                      <p className="font-semibold tabular-nums sm:hidden">
                        {formatMoney(payment.amount, payment.currency)}
                        {payment.currency === "USD" && payment.amountArs && (
                          <span className="ml-1 text-xs font-normal text-foreground/50">= {formatMoney(payment.amountArs)}</span>
                        )}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <span className={PILL}>{medioLabel}</span>
                        {destinoLabel && (
                          <span className={linkedPayment ? PILL_DESTACADA : PILL}>
                            {linkedPayment
                              ? isCobro
                                ? `→ ${destinoLabel.replace(/^Directo a /, "")}`
                                : `cobro directo de ${destinoLabel.replace(/^Directo de /, "")}`
                              : isCobro
                                ? `→ ${destinoLabel}`
                                : `desde ${destinoLabel}`}
                          </span>
                        )}
                        <span className={PILL}>{CIRCUIT_LABELS[payment.account.circuit].split(" (")[0]}</span>
                        {payment.ordenPago && (
                          <Link href={`/ordenes-pago/${payment.ordenPago.numero}`} className={`${PILL} hover:underline`}>
                            OP {formatNumeroOP(payment.ordenPago.numero)}
                          </Link>
                        )}
                      </div>
                      {descripcion && <p className="mt-1 truncate text-xs text-foreground/50">{descripcion}</p>}
                    </div>
                    <div className="hidden shrink-0 text-right sm:block">
                      <p className="text-lg font-semibold tabular-nums">{formatMoney(payment.amount, payment.currency)}</p>
                      {payment.currency === "USD" && payment.amountArs && (
                        <p className="text-xs tabular-nums text-foreground/50">= {formatMoney(payment.amountArs)}</p>
                      )}
                    </div>
                    {canEdit && (
                      <div className="flex shrink-0 items-center">
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
                              // En una cuenta en dólares se edita en pesos, igual que se cargó.
                              amount: (payment.amountArs ??
                                (payment.exchangeRate
                                  ? payment.amount.times(payment.exchangeRate).toDecimalPlaces(2)
                                  : payment.amount)
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
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        {pagos.length === 0 && (
          <p className="rounded-xl border border-foreground/10 px-4 py-8 text-center text-sm text-foreground/40">
            {hayFiltro ? `No hay ${pago}s con este filtro.` : `Todavía no hay ${pago}s cargados.`}
          </p>
        )}
      </div>
    </div>
  );
}

const PILL = "max-w-full truncate whitespace-nowrap rounded-md bg-foreground/[0.05] px-2 py-0.5 text-xs text-foreground/60";
const PILL_DESTACADA =
  "max-w-full truncate whitespace-nowrap rounded-md bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";

const COLOR_DE_MEDIO: Record<PaymentMethod, string> = {
  TRANSFERENCIA: "bg-blue-500",
  EFECTIVO: "bg-emerald-500",
  CHEQUE: "bg-amber-500",
  ECHEQ: "bg-rose-400",
  RETENCION: "bg-violet-400",
  OTRO: "bg-slate-400",
};
