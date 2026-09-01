import Link from "next/link";
import { requireRole } from "@/lib/auth-helpers";
import { getAccountBalance, getTreasuries } from "@/lib/ledger";
import { formatMoney } from "@/lib/money";
import { CIRCUIT_LABELS } from "@/lib/labels";

export default async function TesoreriaPage() {
  await requireRole(["ADMIN", "SOLO_LECTURA"]);
  const treasuries = await getTreasuries();

  const cards = await Promise.all(
    treasuries.map(async (treasury) => {
      const blanco = treasury.accounts.find((a) => a.circuit === "BLANCO");
      const negro = treasury.accounts.find((a) => a.circuit === "NEGRO");
      const [blancoSaldo, negroSaldo] = await Promise.all([
        blanco ? getAccountBalance(blanco.id) : null,
        negro ? getAccountBalance(negro.id) : null,
      ]);
      const total = (blancoSaldo?.toNumber() ?? 0) + (negroSaldo?.toNumber() ?? 0);
      return { treasury, blanco, negro, blancoSaldo, negroSaldo, total };
    })
  );

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-xl font-semibold mb-1">Tesorería</h1>
        <p className="text-sm text-foreground/60">
          Saldo de Banco Galicia y Caja Bufano — se actualiza solo con cada cobro/pago que se
          asigna a una de las dos, más los movimientos manuales (comisiones, impuestos, retiros,
          depósitos).
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map(({ treasury, blanco, negro, blancoSaldo, negroSaldo, total }) => (
          <div key={treasury.id} className="rounded-xl border border-foreground/10 bg-background shadow-sm p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">{treasury.name}</h2>
              <p className="text-lg font-semibold">{formatMoney(total)}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {blanco && (
                <Link
                  href={`/cuentas-corrientes/${treasury.id}/blanco`}
                  className="rounded-lg border border-foreground/10 p-3 hover:bg-foreground/5 transition-colors"
                >
                  <p className="text-foreground/60">{CIRCUIT_LABELS.BLANCO}</p>
                  <p className="font-medium">{blancoSaldo ? formatMoney(blancoSaldo) : "—"}</p>
                </Link>
              )}
              {negro && (
                <Link
                  href={`/cuentas-corrientes/${treasury.id}/negro`}
                  className="rounded-lg border border-foreground/10 p-3 hover:bg-foreground/5 transition-colors"
                >
                  <p className="text-foreground/60">{CIRCUIT_LABELS.NEGRO}</p>
                  <p className="font-medium">{negroSaldo ? formatMoney(negroSaldo) : "—"}</p>
                </Link>
              )}
            </div>
          </div>
        ))}
        {cards.length === 0 && (
          <p className="text-sm text-foreground/40">Todavía no hay cuentas de tesorería cargadas.</p>
        )}
      </div>
    </div>
  );
}
