"use client";

import { useActionState, useState } from "react";
import type { Currency } from "@prisma/client";
import { Package, Receipt } from "lucide-react";
import { esSenalDeNavegacion, userErrorMessage } from "@/lib/user-error";
import { SelectBuscable } from "@/components/ui/SelectBuscable";
import { NuevaCompraForm, type ItemDeCompra } from "./NuevaCompraForm";
import { GastoFormFields } from "./GastoFormFields";
import { useEnvioUnico } from "./useEnvioUnico";
import type { ViajeOption } from "./ViajeFields";

export type Tipo = "COMPRA" | "GASTO";

export type ProveedorParaCargar = {
  id: string;
  name: string;
  moneda: Currency;
  /** El rubro, para saber qué se le carga casi siempre: un proveedor de insumos vende insumos. */
  tipoHabitual: Tipo | null;
  expenseCategory: string | null;
  rubro: string | null;
};

const inputClass =
  "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";

/**
 * Una sola pantalla para lo que se le compra a un proveedor: insumos o un gasto. Arriba se elige a
 * quién y qué es —y el qué arranca solo según el rubro del proveedor: al de tapas se le cargan
 * insumos, a Edenor un gasto—; abajo aparece el formulario que corresponde.
 *
 * Son dos comprobantes distintos y siguen siéndolo: la compra suma stock y lleva líneas de
 * insumos; el gasto lleva rubro y el desglose de la factura. Lo que se unifica es la entrada.
 */
export function CargarCompraOGasto({
  proveedores,
  items,
  subcuentasPorProveedor,
  compraAction,
  gastoAction,
  tipoInicial,
  proveedorInicial,
  sopladores,
}: {
  proveedores: ProveedorParaCargar[];
  items: ItemDeCompra[];
  subcuentasPorProveedor: Record<string, { viajes: ViajeOption[]; rotulo: string }>;
  compraAction: (formData: FormData) => Promise<void>;
  gastoAction: (formData: FormData) => Promise<void>;
  tipoInicial?: Tipo;
  proveedorInicial?: string;
  sopladores?: { id: string; name: string }[];
}) {
  const [proveedorId, setProveedorId] = useState(proveedorInicial ?? "");
  const proveedor = proveedores.find((p) => p.id === proveedorId);
  const [tipo, setTipo] = useState<Tipo | null>(tipoInicial ?? proveedor?.tipoHabitual ?? null);
  const [tipoTocado, setTipoTocado] = useState(Boolean(tipoInicial));

  const [errorGasto, gastoFormAction, gastoPending] = useActionState<string | null, FormData>(async (_prev, formData) => {
    try {
      await gastoAction(formData);
      return null;
    } catch (e) {
      if (esSenalDeNavegacion(e)) throw e;
      return userErrorMessage(e);
    }
  }, null);
  const unaVez = useEnvioUnico(gastoPending);

  const opcion = (valor: Tipo, Icono: typeof Package, titulo: string, texto: string) => (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
        tipo === valor ? "border-primary bg-primary/15" : "border-foreground/15 hover:border-primary"
      }`}
    >
      <input
        type="radio"
        name="tipoDeCarga"
        value={valor}
        checked={tipo === valor}
        onChange={() => {
          setTipo(valor);
          setTipoTocado(true);
        }}
        className="sr-only"
      />
      <Icono size={18} className="mt-0.5 shrink-0 text-foreground/50" />
      <span>
        <span className="block text-sm font-medium">{titulo}</span>
        <span className="block text-xs text-foreground/60">{texto}</span>
      </span>
    </label>
  );

  return (
    <div className="space-y-6">
      <div className="space-y-4 rounded-xl border border-foreground/10 bg-background p-4 shadow-sm">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="cargar-proveedor">
              Proveedor
            </label>
            <SelectBuscable
              id="cargar-proveedor"
              value={proveedorId}
              onChange={(id) => {
                setProveedorId(id);
                // Lo que se le carga sale de su rubro, salvo que ya se haya elegido a mano.
                const elegido = proveedores.find((p) => p.id === id);
                if (!tipoTocado && elegido?.tipoHabitual) setTipo(elegido.tipoHabitual);
              }}
              opciones={proveedores.map((p) => ({ value: p.id, label: p.name, detalle: p.rubro ?? undefined }))}
              placeholder="Escribí el proveedor…"
              className={inputClass}
            />
            {proveedor && (
              <p className="flex flex-wrap gap-1.5 pt-1 text-xs">
                {proveedor.rubro && <span className="rounded bg-foreground/[0.06] px-1.5 py-0.5 text-foreground/60">{proveedor.rubro}</span>}
                {proveedor.moneda === "USD" && (
                  <span className="rounded bg-blue-100 px-1.5 py-0.5 font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                    Cuenta en U$S: los montos van en dólares
                  </span>
                )}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">Qué es</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {opcion("COMPRA", Package, "Compra de insumos", "Entra al depósito: aceite, envases, tapas, cajas, etiquetas. Suma stock.")}
              {opcion("GASTO", Receipt, "Gasto", "No entra al depósito: flete, alquiler, luz, ferretería, honorarios.")}
            </div>
          </div>
        </div>
      </div>

      {!proveedor || !tipo ? (
        <p className="rounded-xl border border-dashed border-foreground/15 px-4 py-8 text-center text-sm text-foreground/50">
          {!proveedor ? "Elegí el proveedor para empezar." : "Elegí si es una compra de insumos o un gasto."}
        </p>
      ) : tipo === "COMPRA" ? (
        <NuevaCompraForm
          // Cambiar de proveedor arranca el formulario de nuevo: la moneda y los precios son suyos.
          key={`compra-${proveedor.id}`}
          action={compraAction}
          proveedores={[]}
          items={items}
          fixedEntity={{ id: proveedor.id, name: proveedor.name, moneda: proveedor.moneda }}
          sopladores={sopladores}
          ocultarProveedor
        />
      ) : (
        <form
          key={`gasto-${proveedor.id}`}
          action={gastoFormAction}
          onSubmit={unaVez}
          className="space-y-3 rounded-xl border border-foreground/10 bg-background p-4 shadow-sm"
        >
          <h2 className="text-sm font-semibold">Factura del gasto</h2>
          {errorGasto && (
            <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">{errorGasto}</p>
          )}
          <fieldset disabled={gastoPending} className="m-0 min-w-0 space-y-3 border-0 p-0 disabled:opacity-60">
            <GastoFormFields
              entityId={proveedor.id}
              monedaCuenta={proveedor.moneda}
              viajes={subcuentasPorProveedor[proveedor.id]?.viajes}
              rotuloSubcuenta={subcuentasPorProveedor[proveedor.id]?.rotulo}
              defaultValues={{ expenseCategory: proveedor.expenseCategory ?? undefined }}
            />
          </fieldset>
        </form>
      )}
    </div>
  );
}
