import Link from "next/link";
import { Wallet } from "lucide-react";
import { requireUser } from "@/lib/auth-helpers";
import { getAccountStatement } from "@/lib/account-statement";
import { getCajaChica, getOtrasCajas } from "@/lib/caja";
import { formatMoney, ZERO } from "@/lib/money";
import {
  EXPENSE_CATEGORY_LABELS,
  TREASURY_MOVEMENT_CATEGORY_LABELS,
} from "@/lib/labels";
import {
  PERIOD_PRESETS,
  formatPeriodLabel,
  periodFromSearchParams,
  toDateInputValue,
} from "@/lib/period";
import { FormModal } from "@/components/Modal";
import { DeleteButton } from "@/components/DeleteButton";
import { GastoDeCajaFields, PaseDeCajaFields } from "@/components/CajaFormFields";
import { crearGastoDeCaja, crearPaseDeCaja, borrarMovimientoDeCaja } from "./actions";

export const dynamic = "force-dynamic";

export default async function CajaChicaPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "SECRETARIA";
  const params = await searchParams;
  const { period, preset } = periodFromSearchParams(params);

  const caja = await getCajaChica();
  const [otrasCajas, statement] = await Promise.all([
    getOtrasCajas(caja.id),
    getAccountStatement({ accountId: caja.accountId, from: period.from, to: period.to }),
  ]);

  const hoy = toDateInputValue(new Date());
  const queryDe = (key: string) => (key === "mes" ? "/caja-chica" : `/caja-chica?preset=${key}`);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold mb-1">Caja chica</h1>
          <p className="text-sm text-foreground/60">
            La plata en efectivo del cajón: lo que entra de la caja grande y lo que se va pagando.
            El saldo de abajo es contra lo que se cuenta la plata.
          </p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-3">
            <FormModal triggerLabel="Nuevo gasto" title="Gasto de caja" action={crearGastoDeCaja}>
              <GastoDeCajaFields hoy={hoy} />
            </FormModal>
            <FormModal triggerLabel="Pase entre cajas" title="Pase entre cajas" action={crearPaseDeCaja}>
              <PaseDeCajaFields hoy={hoy} cajaNombre={caja.name} otrasCajas={otrasCajas} />
            </FormModal>
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-foreground/10 bg-background shadow-sm p-5">
          <p className="flex items-center gap-2 text-sm text-foreground/60">
            <Wallet size={15} className="text-foreground/40" />
            Saldo de hoy
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(statement.saldoFinal)}</p>
        </div>
        <div className="rounded-xl border border-foreground/10 bg-background shadow-sm p-5">
          <p className="text-sm text-foreground/60">Entró en el período</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(statement.totalDebe)}</p>
        </div>
        <div className="rounded-xl border border-foreground/10 bg-background shadow-sm p-5">
          <p className="text-sm text-foreground/60">Salió en el período</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(statement.totalHaber)}</p>
        </div>
      </div>

      <div className="rounded-xl border border-foreground/10 bg-background shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-foreground/10 p-4">
          <div>
            <h2 className="text-sm font-semibold">Movimientos</h2>
            <p className="text-xs text-foreground/50">{formatPeriodLabel(period)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {PERIOD_PRESETS.map((p) => (
              <Link
                key={p.key}
                href={queryDe(p.key)}
                className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                  preset === p.key
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-foreground/20 hover:bg-foreground/5"
                }`}
              >
                {p.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-foreground/50">
              <tr className="border-b border-foreground/10">
                <th className="p-3 font-medium">Fecha</th>
                <th className="p-3 font-medium">Concepto</th>
                <th className="p-3 font-medium">Rubro</th>
                <th className="p-3 text-right font-medium">Ingreso</th>
                <th className="p-3 text-right font-medium">Egreso</th>
                <th className="p-3 text-right font-medium">Saldo</th>
                {canEdit && <th className="p-3 font-medium"></th>}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-foreground/10 bg-foreground/5">
                <td className="p-3" colSpan={5}>
                  Saldo anterior
                </td>
                <td className="p-3 text-right font-semibold tabular-nums">
                  {formatMoney(statement.saldoAnterior)}
                </td>
                {canEdit && <td />}
              </tr>
              {statement.entries.map((entry) => {
                const doc = entry.source.kind === "document" ? entry.source.document : null;
                // El concepto es lo que escribió quien lo cargó; el título con número sólo aporta
                // ruido en una planilla de caja, donde nadie busca por "Ajuste #CAJA-00012".
                const concepto = doc?.reason ?? entry.title;
                const rubro = doc?.expenseCategory
                  ? EXPENSE_CATEGORY_LABELS[doc.expenseCategory]
                  : doc?.treasuryCategory
                    ? TREASURY_MOVEMENT_CATEGORY_LABELS[doc.treasuryCategory]
                    : null;
                // Lo que escribió un cobro o un pago se borra desde ese pago, no desde acá.
                const propio = Boolean(doc && !doc.sourcePaymentId);
                return (
                  <tr key={entry.key} className="border-b border-foreground/5">
                    <td className="p-3 whitespace-nowrap">{entry.date.toLocaleDateString("es-AR")}</td>
                    <td className="p-3">{concepto}</td>
                    <td className="p-3 text-foreground/60">{rubro ?? "—"}</td>
                    <td className="p-3 text-right tabular-nums">
                      {entry.debe.greaterThan(ZERO) ? formatMoney(entry.debe) : "—"}
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {entry.haber.greaterThan(ZERO) ? formatMoney(entry.haber) : "—"}
                    </td>
                    <td className="p-3 text-right font-medium tabular-nums">
                      {formatMoney(entry.saldoAcumulado)}
                    </td>
                    {canEdit && (
                      <td className="p-3">
                        {propio && doc && (
                          <DeleteButton
                            action={borrarMovimientoDeCaja}
                            hiddenName="documentId"
                            hiddenValue={doc.id}
                            nombre={`${concepto} — ${formatMoney(entry.debe.plus(entry.haber))}`}
                            consecuencia={
                              doc.treasuryCategory === "PASE"
                                ? "Se borra también la pata de la otra caja."
                                : undefined
                            }
                          />
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {statement.entries.length === 0 && (
                <tr>
                  <td className="p-6 text-center text-sm text-foreground/40" colSpan={canEdit ? 7 : 6}>
                    No hay movimientos en este período.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
