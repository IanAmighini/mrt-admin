import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { formatMoney, sumDecimals } from "@/lib/money";
import { CHEQUE_ESTADO_LABELS } from "@/lib/labels";
import { KpiCard } from "@/components/KpiCard";
import { actualizarEstadoCheque, cambiarChequesPorEfectivo } from "./actions";
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
  searchParams: Promise<{ estado?: string }>;
}) {
  const { estado } = await searchParams;
  // Vive dentro de Tesorería, así que lo ven los mismos: la secretaría no.
  const user = await requireRole(["ADMIN", "SOLO_LECTURA"]);
  const canEdit = user.role === "ADMIN";
  const filtro = FILTROS.some((f) => f.value === estado && f.value) ? (estado as ChequeEstado) : null;

  const treasuries = await prisma.entity.findMany({
    where: { type: "TESORERIA" },
    orderBy: { name: "asc" },
  });

  const cheques = await prisma.cheque.findMany({
    where: filtro ? { estado: filtro } : undefined,
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
        <Link href="/tesoreria" className="text-sm underline underline-offset-2">
          ← Tesorería
        </Link>
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
          El mismo cheque desde que entra con el cobro de un cliente hasta que se entrega o se
          deposita. No mueve la caja: eso lo sigue haciendo el destino del pago.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="En cartera" value={formatMoney(sumDecimals(enCartera.map((c) => c.amount)))} icon={Wallet} color="amber" caption={`${enCartera.length} cheque(s)`} />
        <KpiCard label="Entregados" value={formatMoney(sumDecimals(entregados.map((c) => c.amount)))} icon={Send} color="blue" caption={`${entregados.length} cheque(s)`} />
        <KpiCard label="Total listado" value={formatMoney(sumDecimals(cheques.map((c) => c.amount)))} icon={Landmark} color="green" caption={`${cheques.length} cheque(s)`} />
      </div>

      <div className="flex flex-wrap gap-1">
        {FILTROS.map((f) => (
          <Link
            key={f.value}
            href={{ pathname: "/tesoreria/cheques", query: f.value ? { estado: f.value } : {} }}
            className={`rounded px-3 py-1.5 text-sm ${
              (filtro ?? "") === f.value
                ? "bg-primary text-primary-foreground"
                : "border border-foreground/20 hover:bg-foreground/5"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-foreground/10 text-left text-foreground/60">
              <th className="py-2 pr-4">Cheque</th>
              <th className="py-2 pr-4">Cobrable desde</th>
              <th className="py-2 pr-4">De quién</th>
              <th className="py-2 pr-4">A quién</th>
              <th className="py-2 pr-4 text-right">Importe</th>
              <th className="py-2 pr-4">Estado</th>
              {canEdit && <th className="py-2 pr-4">Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {cheques.map((c) => (
              <tr key={c.id} className="border-b border-foreground/5">
                <td className="py-2 pr-4">
                  #{c.numero}
                  <span className="block text-xs text-foreground/50">
                    {[c.banco, c.esEcheq ? "Echeq" : "Físico"].filter(Boolean).join(" · ")}
                  </span>
                </td>
                <td className="py-2 pr-4 whitespace-nowrap">
                  {c.fechaCobro ? (
                    c.fechaCobro.toLocaleDateString("es-AR")
                  ) : (
                    <span className="text-foreground/40">al día</span>
                  )}
                </td>
                <td className="py-2 pr-4">
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
                </td>
                <td className="py-2 pr-4">
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
                </td>
                <td className="py-2 pr-4 text-right tabular-nums">{formatMoney(c.amount)}</td>
                <td className="py-2 pr-4">
                  <span className={`rounded px-2 py-1 text-xs font-medium ${ESTADO_COLORS[c.estado]}`}>
                    {CHEQUE_ESTADO_LABELS[c.estado]}
                  </span>
                </td>
                {canEdit && (
                  <td className="py-2 pr-4">
                    {/* Un cheque entregado no se toca desde acá: lo que lo movió fue un pago, y
                        deshacerlo por un lado dejaría el pago apuntando a un cheque que volvió. */}
                    {c.estado === "EN_CARTERA" ? (
                      <div className="flex flex-wrap gap-2">
                        <EstadoButton chequeId={c.id} estado="DEPOSITADO" label="Depositar" />
                        <EstadoButton chequeId={c.id} estado="RECHAZADO" label="Rechazado" />
                      </div>
                    ) : c.estado === "ENTREGADO" ? (
                      <span className="text-xs text-foreground/40">se entregó con un pago</span>
                    ) : (
                      <EstadoButton chequeId={c.id} estado="EN_CARTERA" label="Volver a cartera" />
                    )}
                  </td>
                )}
              </tr>
            ))}
            {cheques.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 7 : 6} className="py-6 text-center text-foreground/40">
                  {filtro
                    ? "No hay cheques en ese estado."
                    : "Todavía no hay cheques. Se cargan al registrar un cobro con método Cheque o Echeq."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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
