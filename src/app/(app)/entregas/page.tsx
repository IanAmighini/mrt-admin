import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { getDocumentPending, getRecentRemitos } from "@/lib/ledger";
import { formatMoney, formatQuantity, sumDecimals } from "@/lib/money";

const PAGO_FILTERS: { value: "" | "pagado" | "sin_pagar"; label: string }[] = [
  { value: "", label: "Todos" },
  { value: "pagado", label: "Pagado" },
  { value: "sin_pagar", label: "Sin pagar" },
];

export default async function EntregasPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pago?: string }>;
}) {
  const { q, pago } = await searchParams;
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "CARGA_DIARIA";

  const pagoFilter = PAGO_FILTERS.some((f) => f.value === pago) ? (pago as "" | "pagado" | "sin_pagar") : "";

  const remitos = await getRecentRemitos(500, undefined, q);

  const rows = remitos.map((doc) => {
    const pending = getDocumentPending(doc);
    const pallets = sumDecimals(doc.lines.map((l) => l.quantity));
    return { doc, pallets, pagado: pending.lessThanOrEqualTo(0) };
  });

  const filteredRows = rows.filter((r) => {
    if (pagoFilter === "pagado") return r.pagado;
    if (pagoFilter === "sin_pagar") return !r.pagado;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold mb-1">Entregas</h1>
          <p className="text-sm text-black/60">{filteredRows.length} entregas registradas</p>
        </div>
        {canEdit && (
          <Link
            href="/entregas/nueva"
            className="w-fit rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            + Nueva entrega
          </Link>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <form className="flex flex-1 min-w-[240px] gap-2">
          {pagoFilter && <input type="hidden" name="pago" value={pagoFilter} />}
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Buscar por cliente o remito…"
            className="flex-1 rounded border border-black/20 px-3 py-2 text-sm"
          />
          <button type="submit" className="rounded border border-black/20 px-3 py-2 text-sm hover:bg-black/5">
            Buscar
          </button>
        </form>
        <div className="flex flex-wrap gap-1">
          {PAGO_FILTERS.map((f) => (
            <Link
              key={f.value}
              href={{ pathname: "/entregas", query: { ...(q ? { q } : {}), ...(f.value ? { pago: f.value } : {}) } }}
              className={`rounded px-3 py-1.5 text-sm ${
                pagoFilter === f.value
                  ? "bg-primary text-primary-foreground"
                  : "border border-black/20 hover:bg-black/5"
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/10 text-left text-black/60">
              <th className="py-2 pr-4">Remito</th>
              <th className="py-2 pr-4">Cliente</th>
              <th className="py-2 pr-4">Fecha</th>
              <th className="py-2 pr-4">Pallets</th>
              <th className="py-2 pr-4">Total</th>
              <th className="py-2 pr-4">Pago</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map(({ doc, pallets, pagado }) => (
              <tr key={doc.id} className="border-b border-black/5">
                <td className="py-2 pr-4">#{doc.number}</td>
                <td className="py-2 pr-4">
                  <Link
                    href={`/cuentas-corrientes/${doc.account.entityId}`}
                    className="underline underline-offset-2"
                  >
                    {doc.account.entity.name}
                  </Link>
                </td>
                <td className="py-2 pr-4">{doc.date.toLocaleDateString("es-AR")}</td>
                <td className="py-2 pr-4">{formatQuantity(pallets, "pallets")}</td>
                <td className="py-2 pr-4">{formatMoney(doc.totalAmount, doc.currency)}</td>
                <td className="py-2 pr-4">
                  <span
                    className={`rounded px-2 py-1 text-xs font-medium ${
                      pagado ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {pagado ? "Pagado" : "Sin pagar"}
                  </span>
                </td>
              </tr>
            ))}
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-black/40">
                  {q || pagoFilter ? "No hay entregas con este filtro." : "Todavía no hay entregas cargadas."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
