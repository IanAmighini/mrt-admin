import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { createEntity } from "./actions";

const TYPE_LABELS: Record<string, string> = {
  CLIENTE: "Cliente",
  PROVEEDOR: "Proveedor",
  AMBOS: "Cliente y proveedor",
};

export default async function EntidadesPage() {
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "CARGA_DIARIA";

  const entities = await prisma.entity.findMany({
    orderBy: { name: "asc" },
    include: { accounts: true },
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold mb-1">Clientes y proveedores</h1>
        <p className="text-sm text-black/60">
          Cada entidad recibe automáticamente dos cuentas corrientes independientes: Blanco y
          Negro.
        </p>
      </div>

      {canEdit && (
        <form
          action={createEntity}
          className="grid max-w-xl gap-3 rounded-lg border border-black/10 p-4"
        >
          <h2 className="text-sm font-semibold">Nueva entidad</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm" htmlFor="name">
                Nombre
              </label>
              <input
                id="name"
                name="name"
                required
                className="w-full rounded border border-black/20 px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="type">
                Tipo
              </label>
              <select
                id="type"
                name="type"
                required
                defaultValue="CLIENTE"
                className="w-full rounded border border-black/20 px-3 py-2 text-sm"
              >
                <option value="CLIENTE">Cliente</option>
                <option value="PROVEEDOR">Proveedor</option>
                <option value="AMBOS">Cliente y proveedor</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="taxId">
                CUIT / datos fiscales
              </label>
              <input
                id="taxId"
                name="taxId"
                className="w-full rounded border border-black/20 px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="contact">
                Contacto
              </label>
              <input
                id="contact"
                name="contact"
                className="w-full rounded border border-black/20 px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="saldoInicialBlanco">
                Saldo inicial Blanco (opcional)
              </label>
              <input
                id="saldoInicialBlanco"
                name="saldoInicialBlanco"
                inputMode="decimal"
                className="w-full rounded border border-black/20 px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="saldoInicialNegro">
                Saldo inicial Negro (opcional)
              </label>
              <input
                id="saldoInicialNegro"
                name="saldoInicialNegro"
                inputMode="decimal"
                className="w-full rounded border border-black/20 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isWithholdingAgent" />
            Es agente de retención/percepción
          </label>
          <button
            type="submit"
            className="w-fit rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Crear
          </button>
        </form>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/10 text-left text-black/60">
              <th className="py-2 pr-4">Nombre</th>
              <th className="py-2 pr-4">Tipo</th>
              <th className="py-2 pr-4">CUIT</th>
              <th className="py-2 pr-4">Contacto</th>
              <th className="py-2 pr-4">Ret./Perc.</th>
              <th className="py-2 pr-4">Cuentas</th>
            </tr>
          </thead>
          <tbody>
            {entities.map((entity) => (
              <tr key={entity.id} className="border-b border-black/5">
                <td className="py-2 pr-4">{entity.name}</td>
                <td className="py-2 pr-4">{TYPE_LABELS[entity.type]}</td>
                <td className="py-2 pr-4">{entity.taxId || "—"}</td>
                <td className="py-2 pr-4">{entity.contact || "—"}</td>
                <td className="py-2 pr-4">{entity.isWithholdingAgent ? "Sí" : "No"}</td>
                <td className="py-2 pr-4">
                  {entity.accounts.map((a) => a.circuit).join(" / ")}
                </td>
              </tr>
            ))}
            {entities.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-black/40">
                  Todavía no hay entidades cargadas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
