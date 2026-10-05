import { Wallet } from "lucide-react";
import { requireUser } from "@/lib/auth-helpers";
import { getAccountStatement } from "@/lib/account-statement";
import { getCajaChica, getOtrasCajas } from "@/lib/caja";
import { formatMoney, ZERO } from "@/lib/money";
import {
  EXPENSE_CATEGORY_LABELS,
  TREASURY_MOVEMENT_CATEGORY_LABELS,
} from "@/lib/labels";
import { formatFecha, formatPeriodLabel, hoyEnInput, periodFromSearchParams, periodLastDay } from "@/lib/period";
import { FormModal } from "@/components/Modal";
import { DeleteButton } from "@/components/DeleteButton";
import { AjusteDeCajaFields, GastoDeCajaFields, PaseDeCajaFields } from "@/components/CajaFormFields";
import { PeriodoFilter } from "@/components/ui/PeriodoFilter";
import { Table, TableEmpty, Td, Th, Thead, Tr } from "@/components/ui/Table";
import { crearAjusteDeCaja, crearGastoDeCaja, crearPaseDeCaja, borrarMovimientoDeCaja } from "./actions";

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

  const hoy = hoyEnInput();
  // La tarjeta decía "Saldo de hoy" siempre, pero muestra el saldo al final del período elegido:
  // con "Mes pasado" mentía. Es el número contra el que se cuenta el efectivo del cajón, así que
  // tiene que decir a qué día corresponde.
  const ultimoDia = periodLastDay(period);
  const esHasta_hoy = ultimoDia >= new Date(new Date().setHours(0, 0, 0, 0));
  const etiquetaSaldo = esHasta_hoy ? "Saldo de hoy" : `Saldo al ${formatFecha(ultimoDia)}`;

  /** Lo que muestra cada movimiento, igual en la lista del teléfono y en la tabla. */
  function filaDe(entry: (typeof statement.entries)[number]) {
    const doc = entry.source.kind === "document" ? entry.source.document : null;
    // El concepto es lo que escribió quien lo cargó; el título con número sólo aporta ruido en
    // una planilla de caja, donde nadie busca por "Ajuste #CAJA-00012".
    const concepto = doc?.reason ?? entry.title;
    const rubro = doc?.expenseCategory
      ? EXPENSE_CATEGORY_LABELS[doc.expenseCategory]
      : doc?.treasuryCategory
        ? TREASURY_MOVEMENT_CATEGORY_LABELS[doc.treasuryCategory]
        : null;
    // Lo que escribió un cobro o un pago se borra desde ese pago, no desde acá.
    const borrar =
      canEdit && doc && !doc.sourcePaymentId ? (
        <DeleteButton
          action={borrarMovimientoDeCaja}
          hiddenName="documentId"
          hiddenValue={doc.id}
          nombre={`${concepto} — ${formatMoney(entry.debe.plus(entry.haber))}`}
          consecuencia={doc.treasuryCategory === "PASE" ? "Se borra también la pata de la otra caja." : undefined}
        />
      ) : null;
    return { concepto, rubro, borrar };
  }

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
            <FormModal
              triggerLabel="Pase entre cajas"
              title="Pase entre cajas"
              action={crearPaseDeCaja}
              peso="secundario"
            >
              <PaseDeCajaFields hoy={hoy} cajaNombre={caja.name} otrasCajas={otrasCajas} />
            </FormModal>
            <FormModal triggerLabel="Ajuste" title="Ajuste por arqueo" action={crearAjusteDeCaja} peso="secundario">
              <AjusteDeCajaFields hoy={hoy} />
            </FormModal>
          </div>
        )}
      </div>

      {/* El saldo es el número contra el que se cuenta la plata del cajón; lo que entró y lo que
          salió son contexto. Antes los tres pesaban igual y había que leer las tres etiquetas
          para encontrar el que importa. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        <div className="col-span-2 rounded-xl border border-primary/30 bg-primary/[0.06] p-5 sm:col-span-1">
          <p className="flex items-center gap-2 text-sm text-foreground/60">
            <Wallet size={15} className="text-foreground/40" />
            {etiquetaSaldo}
          </p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{formatMoney(statement.saldoFinal)}</p>
        </div>
        <div className="min-w-0 rounded-xl border border-foreground/10 bg-background shadow-sm p-4 sm:p-5">
          <p className="text-sm text-foreground/60">Entró en el período</p>
          <p className="mt-1 text-base font-semibold tabular-nums sm:text-xl">{formatMoney(statement.totalDebe)}</p>
        </div>
        <div className="min-w-0 rounded-xl border border-foreground/10 bg-background shadow-sm p-4 sm:p-5">
          <p className="text-sm text-foreground/60">Salió en el período</p>
          <p className="mt-1 text-base font-semibold tabular-nums sm:text-xl">{formatMoney(statement.totalHaber)}</p>
        </div>
      </div>

      <div className="rounded-xl border border-foreground/10 bg-background shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-foreground/10 p-4">
          <div>
            <h2 className="text-sm font-semibold">Movimientos</h2>
            <p className="text-xs text-foreground/50">{formatPeriodLabel(period)}</p>
          </div>
          <PeriodoFilter basePath="/caja-chica" preset={preset} from={params.from} to={params.to} />
        </div>

        {/* En el teléfono, una lista: en la tabla quedaban a la vista la fecha, el concepto y el
            rubro, y los montos —lo único que importa para contar la plata— afuera. */}
        <ul className="divide-y divide-foreground/5 sm:hidden">
          <li className="flex items-center justify-between gap-3 bg-foreground/5 px-4 py-2 text-sm">
            <span>Saldo anterior</span>
            <span className="font-semibold tabular-nums">{formatMoney(statement.saldoAnterior)}</span>
          </li>
          {statement.entries.map((entry) => {
            const { concepto, rubro, borrar } = filaDe(entry);
            return (
              <li key={entry.key} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-xs text-foreground/50">
                    {formatFecha(entry.date)}
                    {rubro && ` · ${rubro}`}
                  </p>
                  <p className="text-sm break-words">{concepto}</p>
                </div>
                <div className="flex shrink-0 items-start gap-1">
                  <div className="text-right tabular-nums">
                    <p className="text-sm font-semibold">
                      {entry.debe.greaterThan(ZERO) ? `+${formatMoney(entry.debe)}` : `−${formatMoney(entry.haber)}`}
                    </p>
                    <p className="text-xs text-foreground/50">Saldo {formatMoney(entry.saldoAcumulado)}</p>
                  </div>
                  {borrar}
                </div>
              </li>
            );
          })}
          {statement.entries.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-foreground/40">No hay movimientos en este período.</li>
          )}
        </ul>

        <div className="hidden sm:block">
          <Table className="min-w-[46rem]">
            <Thead>
              <Th className="pl-4">Fecha</Th>
              <Th>Concepto</Th>
              <Th>Rubro</Th>
              <Th align="derecha">Ingreso</Th>
              <Th align="derecha">Egreso</Th>
              <Th align="derecha">Saldo</Th>
              {canEdit && <Th className="pr-4" />}
            </Thead>
            <tbody>
              <Tr className="bg-foreground/5">
                <Td className="pl-4" colSpan={5}>
                  Saldo anterior
                </Td>
                <Td numero className="font-semibold">
                  {formatMoney(statement.saldoAnterior)}
                </Td>
                {canEdit && <Td />}
              </Tr>
              {statement.entries.map((entry) => {
                const { concepto, rubro, borrar } = filaDe(entry);
                return (
                  <Tr key={entry.key}>
                    <Td className="pl-4 whitespace-nowrap">{formatFecha(entry.date)}</Td>
                    <Td>{concepto}</Td>
                    <Td className="text-foreground/60">{rubro ?? "—"}</Td>
                    <Td numero>{entry.debe.greaterThan(ZERO) ? formatMoney(entry.debe) : "—"}</Td>
                    <Td numero>{entry.haber.greaterThan(ZERO) ? formatMoney(entry.haber) : "—"}</Td>
                    <Td numero className="font-medium">
                      {formatMoney(entry.saldoAcumulado)}
                    </Td>
                    {canEdit && (
                      <Td className="pr-4">
                        {borrar}
                      </Td>
                    )}
                  </Tr>
                );
              })}
              {statement.entries.length === 0 && (
                <TableEmpty colSpan={canEdit ? 7 : 6}>No hay movimientos en este período.</TableEmpty>
              )}
            </tbody>
          </Table>
        </div>
      </div>
    </div>
  );
}
