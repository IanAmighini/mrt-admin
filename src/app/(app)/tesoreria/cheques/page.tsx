import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { formatMoney, formatNumeroEditable, sumDecimals } from "@/lib/money";
import { CHEQUE_ESTADO_LABELS } from "@/lib/labels";
import { KpiCard } from "@/components/KpiCard";
import { actualizarEstadoCheque, cambiarChequesPorEfectivo, rechazarCheque } from "./actions";
import { RechazoChequeFields } from "@/components/RechazoChequeFields";
import { FilterBar, FiltroBuscar, FiltroSelect } from "@/components/ui/FilterBar";
import { Table, TableEmpty, Td, Th, Thead, Tr } from "@/components/ui/Table";
import { FormModal } from "@/components/Modal";
import { CambioChequesFields } from "@/components/CambioChequesFields";
import { Wallet, Send, Landmark } from "lucide-react";
import type { ChequeEstado } from "@prisma/client";

const ESTADO_COLORS: Record<ChequeEstado, string> = {
  EN_CARTERA: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  ENTREGADO: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  DEPOSITADO: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  RECHAZADO: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

const FILTROS: { value: string; label: string }[] = [
  { value: "", label: "Todos" },
  { value: "EN_CARTERA", label: "En cartera" },
  { value: "ENTREGADO", label: "Entregados" },
  { value: "DEPOSITADO", label: "Depositados" },
  { value: "RECHAZADO", label: "Rechazados" },
];

const botonClass =
  "rounded-lg border border-foreground/20 bg-background px-3 py-1 text-xs transition-colors hover:bg-foreground/5";

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
  const filtro = FILTROS.some((f) => f.value === estado && f.value) ? (estado as ChequeEstado) : null;
  // El papel y el echeq se manejan distinto —uno está en la caja, el otro en el banco— así que la
  // pantalla se puede acotar a uno de los dos.
  const tipoFiltro = tipo === "echeq" ? true : tipo === "fisico" ? false : null;

  const treasuries = await prisma.entity.findMany({
    where: { type: "TESORERIA" },
    orderBy: { name: "asc" },
  });

  const cheques = await prisma.cheque.findMany({
    where: {
      ...(filtro ? { estado: filtro } : {}),
      ...(tipoFiltro === null ? {} : { esEcheq: tipoFiltro }),
      // Cuando a la secretaría le avisan que un cheque volvió, lo único que tiene es el número.
      // La guía le dice "buscalo por su número" y la pantalla no tenía dónde.
      ...(busqueda
        ? {
            OR: [
              { numero: { contains: busqueda, mode: "insensitive" as const } },
              { banco: { contains: busqueda, mode: "insensitive" as const } },
              {
                recibidoEn: {
                  account: {
                    entity: { name: { contains: busqueda, mode: "insensitive" as const } },
                  },
                },
              },
            ],
          }
        : {}),
    },
    include: {
      recibidoEn: { include: { account: { include: { entity: true } } } },
      entregadoEn: { include: { account: { include: { entity: true } } } },
    },
    // Los que se pueden cobrar antes, primero: es el orden en que importan.
    orderBy: [{ estado: "asc" }, { fechaCobro: "asc" }, { numero: "asc" }],
  });

  const enCartera = cheques.filter((c) => c.estado === "EN_CARTERA");
  const entregados = cheques.filter((c) => c.estado === "ENTREGADO");

  return (
    <div className="space-y-6">
      <div>
        {esDeTesoreria && (
          <Link href="/tesoreria" className="text-sm underline underline-offset-2">
            ← Tesorería
          </Link>
        )}
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-xl font-semibold mb-1">Cheques</h1>
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
        <p className="text-sm text-foreground/60">
          {tipoFiltro === true
            ? "Echeqs — bancarios, por Banco Galicia. "
            : tipoFiltro === false
              ? "Cheques en papel — los que están en la caja. "
              : ""}
          El mismo cheque desde que entra con el cobro de un cliente hasta que se entrega o se
          deposita. No mueve la caja: eso lo sigue haciendo el destino del pago.
        </p>
      </div>

      {esDeTesoreria && (
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="En cartera" value={formatMoney(sumDecimals(enCartera.map((c) => c.amount)))} icon={Wallet} color="amber" caption={`${enCartera.length} cheque(s)`} />
        <KpiCard label="Entregados" value={formatMoney(sumDecimals(entregados.map((c) => c.amount)))} icon={Send} color="blue" caption={`${entregados.length} cheque(s)`} />
        <KpiCard label="Total listado" value={formatMoney(sumDecimals(cheques.map((c) => c.amount)))} icon={Landmark} color="green" caption={`${cheques.length} cheque(s)`} />
      </div>
      )}

      <FilterBar limpiarHref="/tesoreria/cheques" hayFiltro={Boolean(busqueda || filtro || tipo)}>
        <FiltroBuscar defaultValue={q} placeholder="Número de cheque, banco o cliente…" />
        <FiltroSelect
          label="Estado"
          name="estado"
          defaultValue={filtro ?? ""}
          opciones={FILTROS.filter((f) => f.value)}
        />
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

      <Table>
        <Thead>
          <Th>Cheque</Th>
          <Th>Cobrable desde</Th>
          <Th>De quién</Th>
          <Th>A quién</Th>
          <Th align="derecha">Importe</Th>
          <Th>Estado</Th>
          {(canEdit || puedeRechazar) && <Th>Acciones</Th>}
        </Thead>
          <tbody>
            {cheques.map((c) => (
              <Tr key={c.id}>
                <Td>
                  #{c.numero}
                  <span className="block text-xs text-foreground/50">
                    {[c.banco, c.esEcheq ? "Echeq" : "Físico"].filter(Boolean).join(" · ")}
                  </span>
                </Td>
                <Td className="whitespace-nowrap">
                  {c.fechaCobro ? (
                    c.fechaCobro.toLocaleDateString("es-AR")
                  ) : (
                    <span className="text-foreground/40">al día</span>
                  )}
                </Td>
                <Td>
                  {c.recibidoEn ? (
                    <Link
                      href={`/cuentas-corrientes/${c.recibidoEn.account.entity.slug}`}
                      className="underline underline-offset-2"
                    >
                      {c.recibidoEn.account.entity.name}
                    </Link>
                  ) : c.cambiadoA ? (
                    <>
                      {c.cambiadoA}
                      <span className="block text-xs text-foreground/50">cambiado por efectivo</span>
                    </>
                  ) : c.cambioEnId ? (
                    <span className="text-foreground/50">cambiado por efectivo</span>
                  ) : (
                    <span className="text-foreground/40">—</span>
                  )}
                </Td>
                <Td>
                  {c.entregadoEn ? (
                    <Link
                      href={`/cuentas-corrientes/${c.entregadoEn.account.entity.slug}`}
                      className="underline underline-offset-2"
                    >
                      {c.entregadoEn.account.entity.name}
                    </Link>
                  ) : (
                    <span className="text-foreground/40">—</span>
                  )}
                </Td>
                <Td numero>{formatMoney(c.amount)}</Td>
                <Td>
                  <span className={`rounded px-2 py-1 text-xs font-medium ${ESTADO_COLORS[c.estado]}`}>
                    {CHEQUE_ESTADO_LABELS[c.estado]}
                  </span>
                </Td>
                {(canEdit || puedeRechazar) && (
                  <Td>
                    {/* Un cheque entregado no se toca desde acá: lo que lo movió fue un pago, y
                        deshacerlo por un lado dejaría el pago apuntando a un cheque que volvió. */}
                    {/* El rechazo se puede marcar esté donde esté: un cheque vuelve rechazado
                        tanto si lo tenemos como si ya se lo dimos a alguien. */}
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Depositar y volver a cartera mueven la cartera de Tesorería: sólo Admin. */}
                      {canEdit && c.estado === "EN_CARTERA" && (
                        <EstadoButton chequeId={c.id} estado="DEPOSITADO" label="Depositar" />
                      )}
                      {canEdit && c.estado === "DEPOSITADO" && (
                        <EstadoButton chequeId={c.id} estado="EN_CARTERA" label="Volver a cartera" />
                      )}
                      {c.estado !== "RECHAZADO" && puedeRechazar && (
                        <FormModal
                          triggerLabel="Rechazado"
                          title="Cheque rechazado"
                          action={rechazarCheque}
                        >
                          <RechazoChequeFields
                            chequeId={c.id}
                            numero={c.numero}
                            monto={formatNumeroEditable(c.amount)}
                            aQuien={c.entregadoEn?.account.entity.name ?? null}
                            deQuien={c.recibidoEn?.account.entity.name ?? null}
                          />
                        </FormModal>
                      )}
                      {c.estado === "ENTREGADO" && (
                        <span className="text-xs text-foreground/40">se entregó con un pago</span>
                      )}
                    </div>
                  </Td>
                )}
              </Tr>
            ))}
            {cheques.length === 0 && (
              <TableEmpty colSpan={canEdit || puedeRechazar ? 7 : 6}>
                {busqueda || filtro || tipo
                  ? "No hay cheques con este filtro."
                  : "Todavía no hay cheques. Se cargan al registrar un cobro con método Cheque o Echeq."}
              </TableEmpty>
            )}
          </tbody>
        </Table>
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
    <form action={actualizarEstadoCheque}>
      <input type="hidden" name="chequeId" value={chequeId} />
      <input type="hidden" name="estado" value={estado} />
      <button type="submit" className={botonClass}>
        {label}
      </button>
    </form>
  );
}
