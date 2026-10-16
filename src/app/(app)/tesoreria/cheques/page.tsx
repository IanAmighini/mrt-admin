import Link from "next/link";
import { BotonConError } from "@/components/BotonConError";
import { formatFecha, hoyComoFecha } from "@/lib/period";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { formatMoney, formatNumeroEditable, sumDecimals } from "@/lib/money";
import { CHEQUE_ESTADO_LABELS } from "@/lib/labels";
import { ETIQUETA, ETIQUETA_DESTACADA } from "@/components/Etiquetas";
import { actualizarEstadoCheque, cambiarChequesPorEfectivo, rechazarCheque } from "./actions";
import { RechazoChequeFields } from "@/components/RechazoChequeFields";
import { FilterBar, FiltroBuscar, FiltroSelect } from "@/components/ui/FilterBar";
import { FormModal } from "@/components/Modal";
import { CambioChequesFields } from "@/components/CambioChequesFields";
import type { ChequeEstado } from "@prisma/client";

const ESTADO_COLORS: Record<ChequeEstado, string> = {
  EN_CARTERA: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  ENTREGADO: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  DEPOSITADO: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  RECHAZADO: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

/** Las pestañas, en el orden en que importan. "todos" es la única que no es un estado. */
const PESTANAS: { value: ChequeEstado | "todos"; label: string }[] = [
  { value: "EN_CARTERA", label: "En cartera" },
  { value: "ENTREGADO", label: "Entregados" },
  { value: "DEPOSITADO", label: "Depositados" },
  { value: "RECHAZADO", label: "Rechazados" },
  { value: "todos", label: "Todos" },
];

/** Un cheque se presenta hasta 30 días después de su fecha de cobro; pasado eso, el banco lo rechaza. */
const PLAZO_PARA_DEPOSITAR = 30;
const DIA_MS = 24 * 60 * 60 * 1000;

const botonClass =
  "rounded-lg border border-foreground/20 bg-background px-3 py-1 text-xs transition-colors hover:bg-foreground/5";
const rechazoClass =
  "rounded-lg border border-foreground/20 bg-background px-3 py-1 text-xs text-red-700 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40";
const pestanaClass = (activa: boolean) =>
  `flex items-baseline gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
    activa ? "bg-primary font-medium text-primary-foreground shadow-sm" : "text-foreground/70 hover:bg-foreground/5 hover:text-foreground"
  }`;

export default async function ChequesPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; tipo?: string; q?: string }>;
}) {
  const { estado, tipo, q } = await searchParams;
  const busqueda = q?.trim();
  // La secretaría entra sólo por el rechazo: a ella le avisan cuando un cheque vuelve. No ve los
  // totales ni puede depositar ni cambiar cheques por efectivo — eso sigue siendo de Tesorería.
  const user = await requireRole(["ADMIN", "SOLO_LECTURA", "SECRETARIA"]);
  const esDeTesoreria = user.role === "ADMIN" || user.role === "SOLO_LECTURA";
  const canEdit = user.role === "ADMIN";
  const puedeRechazar = user.role === "ADMIN" || user.role === "SECRETARIA";
  // Se abre en la cartera, que es lo que se mira todos los días. Buscando, en cambio, se busca en
  // todos: a la secretaría le avisan "volvió el 4521" y no sabe en qué estado está.
  const pestana: ChequeEstado | "todos" = PESTANAS.some((p) => p.value === estado)
    ? (estado as ChequeEstado | "todos")
    : busqueda
      ? "todos"
      : "EN_CARTERA";
  // El papel y el echeq se manejan distinto —uno está en la caja, el otro en el banco— así que la
  // pantalla se puede acotar a uno de los dos.
  const tipoFiltro = tipo === "echeq" ? true : tipo === "fisico" ? false : null;

  const treasuries = canEdit
    ? await prisma.entity.findMany({ where: { type: "TESORERIA" }, orderBy: { name: "asc" } })
    : [];

  // Son unas decenas: se traen todos los del filtro y se reparten en pestañas acá, así cada
  // pestaña dice cuántos tiene sin otra consulta.
  const todos = await prisma.cheque.findMany({
    where: {
      ...(tipoFiltro === null ? {} : { esEcheq: tipoFiltro }),
      // Cuando a la secretaría le avisan que un cheque volvió, lo único que tiene es el número.
      ...(busqueda
        ? {
            OR: [
              { numero: { contains: busqueda, mode: "insensitive" as const } },
              { banco: { contains: busqueda, mode: "insensitive" as const } },
              { cambiadoA: { contains: busqueda, mode: "insensitive" as const } },
              { recibidoEn: { account: { entity: { name: { contains: busqueda, mode: "insensitive" as const } } } } },
              { entregadoEn: { account: { entity: { name: { contains: busqueda, mode: "insensitive" as const } } } } },
            ],
          }
        : {}),
    },
    include: {
      recibidoEn: { include: { account: { include: { entity: true } } } },
      entregadoEn: { include: { account: { include: { entity: true } } } },
    },
    orderBy: [{ fechaCobro: "asc" }, { numero: "asc" }],
  });
  type ChequeFila = (typeof todos)[number];

  const delEstado = (e: ChequeEstado | "todos") => (e === "todos" ? todos : todos.filter((c) => c.estado === e));
  // Lo que ya salió, lo más nuevo arriba; la cartera, lo que se cobra antes arriba.
  const visibles = pestana === "EN_CARTERA" ? delEstado(pestana) : [...delEstado(pestana)].reverse();

  const hoy = hoyComoFecha();
  const enUnaSemana = new Date(hoy.getTime() + 7 * DIA_MS);
  const grupos: { titulo: string; nota?: string; cheques: ChequeFila[] }[] =
    pestana === "EN_CARTERA"
      ? [
          {
            titulo: "Ya se pueden depositar",
            nota: `Hasta ${PLAZO_PARA_DEPOSITAR} días después de su fecha de cobro`,
            cheques: visibles.filter((c) => !c.fechaCobro || c.fechaCobro <= hoy),
          },
          {
            titulo: "Esta semana",
            cheques: visibles.filter((c) => c.fechaCobro && c.fechaCobro > hoy && c.fechaCobro <= enUnaSemana),
          },
          { titulo: "Más adelante", cheques: visibles.filter((c) => c.fechaCobro && c.fechaCobro > enUnaSemana) },
        ].filter((g) => g.cheques.length > 0)
      : [{ titulo: "", cheques: visibles }];

  const href = (cambios: Record<string, string | undefined>) => {
    const query = new URLSearchParams();
    const todo = { estado: pestana === "EN_CARTERA" && !busqueda ? undefined : pestana, tipo, q, ...cambios };
    for (const [k, v] of Object.entries(todo)) if (v) query.set(k, v);
    const qs = query.toString();
    return `/tesoreria/cheques${qs ? `?${qs}` : ""}`;
  };

  /** El aviso del plazo para depositar, sólo en la cartera: es lo que hace perder un cheque. */
  const plazo = (c: ChequeFila) => {
    if (c.estado !== "EN_CARTERA" || !c.fechaCobro || c.fechaCobro > hoy) return null;
    const limite = new Date(c.fechaCobro.getTime() + PLAZO_PARA_DEPOSITAR * DIA_MS);
    const quedan = Math.round((limite.getTime() - hoy.getTime()) / DIA_MS);
    if (quedan < 0) {
      return (
        <span className="whitespace-nowrap rounded-md bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/40 dark:text-red-300">
          Se pasó el plazo ({formatFecha(limite)})
        </span>
      );
    }
    return (
      <span
        className={
          quedan <= 7
            ? "whitespace-nowrap rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
            : ETIQUETA
        }
      >
        {quedan === 0 ? "Hoy es el último día" : `Depositar hasta el ${formatFecha(limite)}`}
        {quedan > 0 && quedan <= 7 ? ` · ${quedan === 1 ? "queda 1 día" : `quedan ${quedan} días`}` : ""}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        {esDeTesoreria && (
          <Link href="/tesoreria" className="text-sm underline underline-offset-2">
            ← Tesorería
          </Link>
        )}
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="mb-1 text-xl font-semibold">Cheques</h1>
            <p className="text-sm text-foreground/60">
              {tipoFiltro === true
                ? "Echeqs — bancarios, por Banco Galicia. "
                : tipoFiltro === false
                  ? "Cheques en papel — los que están en la caja. "
                  : ""}
              El mismo cheque desde que entra con el cobro de un cliente hasta que se entrega o se
              deposita.
            </p>
          </div>
          {canEdit && (
            <FormModal
              triggerLabel="Cambiar cheques por efectivo"
              title="Cambio de cheques por efectivo"
              action={cambiarChequesPorEfectivo}
              maxWidthClass="max-w-3xl"
            >
              <CambioChequesFields treasuries={treasuries} />
            </FormModal>
          )}
        </div>
      </div>

      {/* Las pestañas dicen cuántos hay en cada estado; el importe, sólo a quien ve Tesorería. */}
      <nav className="flex flex-wrap gap-1 rounded-lg border border-foreground/10 bg-background p-1 shadow-sm">
        {PESTANAS.map((p) => {
          const lista = delEstado(p.value);
          const activa = pestana === p.value;
          return (
            <Link key={p.value} href={href({ estado: p.value === "EN_CARTERA" && !busqueda ? undefined : p.value })} className={pestanaClass(activa)}>
              {p.label}
              <span className={`text-xs tabular-nums ${activa ? "opacity-80" : "text-foreground/40"}`}>
                {lista.length}
                {esDeTesoreria && p.value !== "todos" && lista.length > 0 && <> · {formatMoney(sumDecimals(lista.map((c) => c.amount)))}</>}
              </span>
            </Link>
          );
        })}
      </nav>

      <FilterBar limpiarHref="/tesoreria/cheques" hayFiltro={Boolean(busqueda || tipo)}>
        {pestana !== "EN_CARTERA" && <input type="hidden" name="estado" value={pestana} />}
        <FiltroBuscar defaultValue={q} placeholder="Número, banco, cliente o proveedor…" />
        <FiltroSelect
          label="Tipo"
          name="tipo"
          defaultValue={tipo}
          opciones={[
            { value: "fisico", label: "En papel" },
            { value: "echeq", label: "Echeq" },
          ]}
        />
      </FilterBar>

      {grupos.map((g) => (
        <section key={g.titulo || "lista"} className="space-y-2">
          {g.titulo && (
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 px-1">
              <h2 className="text-sm font-semibold">
                {g.titulo} <span className="font-normal text-foreground/50">({g.cheques.length})</span>
                {g.nota && <span className="ml-2 text-xs font-normal text-foreground/40">{g.nota}</span>}
              </h2>
              {esDeTesoreria && (
                <span className="text-sm tabular-nums text-foreground/60">{formatMoney(sumDecimals(g.cheques.map((c) => c.amount)))}</span>
              )}
            </div>
          )}
          <div className="divide-y divide-foreground/10 rounded-xl border border-foreground/10 bg-background shadow-sm">
            {g.cheques.map((c) => {
              const deQuien = c.recibidoEn?.account.entity;
              const aQuien = c.entregadoEn?.account.entity;
              return (
                <div key={c.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {deQuien ? (
                        <Link href={`/cuentas-corrientes/${deQuien.slug}`} className="hover:underline">
                          {deQuien.name}
                        </Link>
                      ) : c.cambiadoA ? (
                        c.cambiadoA
                      ) : (
                        "Cambiado por efectivo"
                      )}
                      <span className="font-normal text-foreground/50">
                        {" "}
                        · #{c.numero}
                        {c.banco ? ` · ${c.banco}` : ""}
                      </span>
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {pestana === "todos" && (
                        <span className={`whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ${ESTADO_COLORS[c.estado]}`}>
                          {CHEQUE_ESTADO_LABELS[c.estado]}
                        </span>
                      )}
                      <span className={ETIQUETA}>{c.esEcheq ? "Echeq" : "Papel"}</span>
                      <span className={ETIQUETA}>{c.fechaCobro ? `Se cobra desde el ${formatFecha(c.fechaCobro)}` : "Al día"}</span>
                      {plazo(c)}
                      {c.cambiadoA && deQuien === undefined && <span className={ETIQUETA}>Cambiado por efectivo</span>}
                      {aQuien && (
                        <Link href={`/cuentas-corrientes/${aQuien.slug}`} className={`${ETIQUETA_DESTACADA} hover:underline`}>
                          → {aQuien.name}
                        </Link>
                      )}
                      {c.costoPct && !c.costoPct.isZero() && <span className={ETIQUETA}>Costo {formatNumeroEditable(c.costoPct)}%</span>}
                    </div>
                  </div>
                  {/* En el celular, importe y botones van abajo en su propio renglón: al costado apretaban el
                      nombre y cortaban las etiquetas. */}
                  <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:shrink-0 sm:flex-col sm:items-end">
                    <p className="text-lg font-semibold tabular-nums">{formatMoney(c.amount)}</p>
                    {/* Un cheque entregado no se vuelve atrás desde acá: lo movió un pago, y
                        deshacerlo por un lado dejaría el pago apuntando a un cheque que volvió.
                        El rechazo sí se marca esté donde esté: vuelve tanto si lo tenemos como si
                        ya se lo dimos a alguien. Depositar mueve la cartera: sólo Admin. */}
                    {(canEdit || puedeRechazar) && c.estado !== "RECHAZADO" && (
                      <div className="flex flex-wrap justify-end gap-2">
                        {canEdit && c.estado === "EN_CARTERA" && <EstadoButton chequeId={c.id} estado="DEPOSITADO" label="Depositar" />}
                        {canEdit && c.estado === "DEPOSITADO" && (
                          <EstadoButton chequeId={c.id} estado="EN_CARTERA" label="Volver a cartera" />
                        )}
                        {puedeRechazar && (
                          <FormModal triggerLabel="Rechazado" title="Cheque rechazado" action={rechazarCheque} triggerClassName={rechazoClass}>
                            <RechazoChequeFields
                              chequeId={c.id}
                              numero={c.numero}
                              monto={formatNumeroEditable(c.amount)}
                              aQuien={aQuien?.name ?? null}
                              deQuien={deQuien?.name ?? null}
                            />
                          </FormModal>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {g.cheques.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-foreground/40">
                {busqueda || tipo
                  ? "No hay cheques con este filtro."
                  : todos.length === 0
                    ? "Todavía no hay cheques. Se cargan al registrar un cobro con método Cheque o Echeq."
                    : "No hay cheques en este estado."}
              </p>
            )}
          </div>
        </section>
      ))}
      {grupos.length === 0 && (
        <p className="rounded-xl border border-dashed border-foreground/15 px-4 py-8 text-center text-sm text-foreground/50">
          {busqueda || tipo ? "No hay cheques en cartera con este filtro." : "No hay cheques en cartera."}
        </p>
      )}
    </div>
  );
}

function EstadoButton({
  chequeId,
  estado,
  label,
}: {
  chequeId: string;
  estado: ChequeEstado;
  label: string;
}) {
  return (
    <BotonConError action={actualizarEstadoCheque} hidden={{ chequeId, estado }} className={botonClass}>
      {label}
    </BotonConError>
  );
}
