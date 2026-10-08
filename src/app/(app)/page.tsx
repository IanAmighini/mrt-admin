import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { puedeVerRuta } from "@/lib/nav";
import {
  getAccountBalance,
  getEntitySaldos,
  getTreasuries,
  getUltimaCotizacion,
  getVencimientos,
  separarRetiroSocietario,
} from "@/lib/ledger";
import { getCartera } from "@/lib/cheques";
import { getInsumosMinimoReport } from "@/lib/reports";
import { getCajaChica } from "@/lib/caja";
import { circuitoDeTesoreria } from "@/lib/pagos";
import { formatMoney, formatQuantity, sumDecimals, toDecimal, ZERO } from "@/lib/money";
import { formatFecha, hoyComoFecha } from "@/lib/period";
import { formatProductBrandLabel } from "@/lib/product-label";
import { buttonClass } from "@/components/ui/Button";

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * Los atajos a lo que cada uno hace todos los días. Se muestran sólo los que su rol puede abrir
 * (`seccion` es la ruta del menú que da el permiso), y quien no carga ve el nombre de la sección en
 * vez del verbo: al encargado de producción "Cargar producción" le prometía algo que no puede hacer.
 */
const ATAJOS: { href: string; seccion?: string; carga: string; mira: string; roles?: UserRole[] }[] = [
  { href: "/entregas/nueva", seccion: "/entregas", carga: "Nueva entrega", mira: "Entregas" },
  { href: "/pagos-clientes", carga: "Registrar cobro", mira: "Cobros" },
  { href: "/pagos-proveedores", carga: "Registrar pago", mira: "Pagos" },
  { href: "/compras", carga: "Compras y gastos", mira: "Compras y gastos" },
  { href: "/pedidos", carga: "Pedidos", mira: "Pedidos" },
  { href: "/produccion", carga: "Cargar producción", mira: "Producción" },
  // El admin llega a la caja chica por Tesorería; a la secretaría le sirve tenerla acá.
  { href: "/caja-chica", carga: "Caja chica", mira: "Caja chica", roles: ["SECRETARIA"] },
  { href: "/stock", carga: "Stock", mira: "Stock" },
];

/**
 * El Inicio: lo que hay que atender hoy, para cualquiera que entre.
 *
 * Cada tarjeta sale sólo si el rol puede abrir la pantalla a la que lleva —con la misma lista que
 * arma el menú—, así que el encargado de producción ve pedidos, stock y producción, la secretaría
 * suma cobros, pagos, cheques y caja chica, y quien ve Tesorería suma los saldos. Nada de esto se
 * carga acá: cada tarjeta lleva a la pantalla donde se resuelve.
 */
export default async function InicioPage() {
  const user = await requireUser();
  const ve = (href: string) => puedeVerRuta(user.role, href);
  const hoy = new Date();
  const enUnaSemana = new Date(hoy.getTime() + 7 * MS_POR_DIA);

  const [pedidos, insumos, vencimientos, proveedores, cotizacion, cartera, cajaChica, tesorerias, ultimaProduccion] =
    await Promise.all([
    ve("/pedidos")
      ? prisma.pedido.findMany({
          where: { status: "EN_COLA" },
          include: { entity: true, lines: { include: { product: true } } },
          orderBy: { date: "asc" },
        })
      : null,
    ve("/stock") ? getInsumosMinimoReport() : null,
    ve("/entregas") ? getVencimientos() : null,
    ve("/proveedores") ? getEntitySaldos(["PROVEEDOR", "AMBOS"]) : null,
    ve("/proveedores") ? getUltimaCotizacion() : null,
    ve("/tesoreria/cheques") ? getCartera() : null,
    ve("/caja-chica") ? getCajaChica().then(async (c) => ({ ...c, saldo: await getAccountBalance(c.accountId) })) : null,
    ve("/tesoreria")
      ? getTreasuries().then((ts) =>
          Promise.all(
            ts.map(async (t) => {
              const cuenta = t.accounts.find((a) => a.circuit === circuitoDeTesoreria(t.name));
              return { id: t.id, slug: t.slug, name: t.name, saldo: cuenta ? await getAccountBalance(cuenta.id) : ZERO };
            })
          )
        )
      : null,
    ve("/produccion")
      ? prisma.productionRun.findFirst({ orderBy: { date: "desc" }, include: { lines: { include: { product: true } } } })
      : null,
  ]);

  // Lo que nos deben y ya venció.
  const vencidosClientes = (vencimientos ?? []).filter(
    (d) =>
      (d.account.entity.type === "CLIENTE" || d.account.entity.type === "AMBOS") && d.dueDate && d.dueDate < hoyComoFecha()
  );
  // Lo que les debemos a los proveedores, por saldo y no por vencimiento: a Cristian se le paga por
  // adelantado, así que sus compras figuraban "por vencer" aunque la cuenta esté a favor nuestro. La
  // cuenta por la que retiran los socios queda afuera, igual que en la lista de Proveedores.
  const enPesos = (fila: { entity: { moneda: string }; total: number }) =>
    fila.entity.moneda === "USD" && cotizacion ? toDecimal(fila.total).times(cotizacion) : toDecimal(fila.total);
  const lesDebemos = separarRetiroSocietario(proveedores ?? [])
    .deuda.filter((f) => f.total > 0)
    .sort((a, b) => enPesos(b).comparedTo(enPesos(a)));
  const deudaPesos = sumDecimals(lesDebemos.filter((f) => f.entity.moneda !== "USD").map((f) => f.total));
  const deudaDolares = sumDecimals(lesDebemos.filter((f) => f.entity.moneda === "USD").map((f) => f.total));
  // Los que ya se pueden depositar o se pueden esta semana.
  const chequesParaDepositar = (cartera ?? []).filter((c) => !c.fechaCobro || c.fechaCobro <= enUnaSemana);
  const palletsEnCola = sumDecimals((pedidos ?? []).flatMap((p) => p.lines.map((l) => l.pallets)));

  const carga = user.role === "ADMIN" || user.role === "SECRETARIA";
  const atajos = ATAJOS.filter((a) => ve(a.seccion ?? a.href) && (!a.roles || a.roles.includes(user.role)));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Hola, {(user.name ?? "").split(" ")[0]}</h1>
        <p className="text-sm text-foreground/60">
          {new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long" }).format(hoy)}
        </p>
      </div>

      {atajos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {atajos.map((a) => (
            <Link key={a.href} href={a.href} className={buttonClass("secundario", "w-fit")}>
              {carga ? a.carga : a.mira}
            </Link>
          ))}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {pedidos && (
          <Tarjeta
            titulo="Pedidos en cola"
            resumen={
              pedidos.length === 0
                ? "No hay pedidos esperando."
                : `${pedidos.length} ${pedidos.length === 1 ? "pedido" : "pedidos"} · ${formatQuantity(palletsEnCola)} pallets`
            }
            href="/pedidos?estado=EN_COLA"
            alerta={pedidos.length > 0}
          >
            {pedidos.slice(0, 5).map((p) => (
              <Renglon
                key={p.id}
                izquierda={`${p.entity.name} · #${p.orderNumber}`}
                debajo={p.lines
                  .map((l) => `${formatQuantity(l.pallets)} ${formatProductBrandLabel(l.product)} ${l.product.presentation}`)
                  .join(" · ")}
                derecha={p.deliveryDate ? `Entrega ${formatFecha(p.deliveryDate)}` : formatFecha(p.date)}
              />
            ))}
          </Tarjeta>
        )}

        {insumos && (
          <Tarjeta
            titulo="Insumos en el mínimo"
            resumen={
              insumos.rows.length === 0
                ? insumos.itemsSinMinimo === insumos.totalItems
                  ? "Ningún insumo tiene stock mínimo cargado: se carga en la ficha de cada uno."
                  : "Ningún insumo está en su mínimo."
                : `${insumos.rows.length} ${insumos.rows.length === 1 ? "insumo" : "insumos"} para reponer`
            }
            href="/stock?bajo=1"
            alerta={insumos.rows.length > 0}
          >
            {insumos.rows.slice(0, 6).map((i) => (
              <Renglon
                key={i.itemId}
                izquierda={i.itemName}
                derecha={`${formatQuantity(i.stock, i.unit)} / mín. ${formatQuantity(i.minStock, i.unit)}`}
              />
            ))}
          </Tarjeta>
        )}

        {ve("/entregas") && (
          <Tarjeta
            titulo="Cobros vencidos"
            resumen={
              vencidosClientes.length === 0
                ? "Nadie tiene comprobantes vencidos."
                : `${vencidosClientes.length} ${vencidosClientes.length === 1 ? "comprobante" : "comprobantes"} · ${formatMoney(
                    sumDecimals(vencidosClientes.filter((d) => d.currency === "ARS").map((d) => d.pending))
                  )}`
            }
            href="/entregas?pago=sin_pagar"
            alerta={vencidosClientes.length > 0}
          >
            {[...vencidosClientes]
              .sort((a, b) => a.dueDate!.getTime() - b.dueDate!.getTime())
              .slice(0, 5)
              .map((d) => (
                <Renglon
                  key={d.id}
                  izquierda={`${d.account.entity.name} · #${d.number}`}
                  debajo={`Venció el ${formatFecha(d.dueDate!)}`}
                  derecha={formatMoney(d.pending, d.currency)}
                />
              ))}
          </Tarjeta>
        )}

        {proveedores && (
          <Tarjeta
            titulo="Lo que les debemos"
            resumen={
              lesDebemos.length === 0
                ? "No le debemos nada a ningún proveedor."
                : `${lesDebemos.length} ${lesDebemos.length === 1 ? "proveedor" : "proveedores"} · ${formatMoney(deudaPesos)}${
                    deudaDolares.isZero() ? "" : ` + ${formatMoney(deudaDolares, "USD")}`
                  }`
            }
            href="/proveedores?saldo=deuda"
          >
            {lesDebemos.slice(0, 6).map((f) => (
              <Renglon key={f.entity.id} izquierda={f.entity.name} derecha={formatMoney(f.total, f.entity.moneda)} />
            ))}
          </Tarjeta>
        )}


        {(cajaChica || tesorerias || cartera) && (
          <Tarjeta titulo="Plata" href={tesorerias ? "/tesoreria" : "/caja-chica"}>
            {tesorerias?.map((t) => (
              <Renglon key={t.id} izquierda={t.name} derecha={formatMoney(t.saldo)} />
            ))}
            {!tesorerias && cajaChica && (
              <Renglon izquierda={cajaChica.name} debajo="Efectivo del cajón" derecha={formatMoney(cajaChica.saldo)} />
            )}
            {cartera && (
              <Renglon
                izquierda="Cheques en cartera"
                debajo={`${cartera.length} ${cartera.length === 1 ? "cheque" : "cheques"}${
                  chequesParaDepositar.length > 0
                    ? ` · ${chequesParaDepositar.length} para depositar`
                    : ""
                }`}
                derecha={formatMoney(sumDecimals(cartera.map((c) => c.amount)))}
                href="/tesoreria/cheques"
              />
            )}
          </Tarjeta>
        )}

        {ultimaProduccion !== null && ve("/produccion") && (
          <Tarjeta
            titulo="Última producción"
            resumen={ultimaProduccion ? formatFecha(ultimaProduccion.date) : "Todavía no hay producción cargada."}
            href="/produccion"
          >
            {ultimaProduccion?.lines
              .filter((l) => l.tipo === "PALLETS" || l.tipo === "CAJAS")
              .slice(0, 5)
              .map((l) => (
                <Renglon
                  key={l.id}
                  izquierda={`${formatProductBrandLabel(l.product)} ${l.product.presentation}`}
                  derecha={`${formatQuantity(l.quantity)} ${l.tipo === "CAJAS" ? "cajas" : "pallets"}`}
                />
              ))}
          </Tarjeta>
        )}
      </div>
    </div>
  );
}

function Tarjeta({
  titulo,
  resumen,
  href,
  alerta = false,
  children,
}: {
  titulo: string;
  resumen?: string;
  href: string;
  /** Hay algo para hacer: el resumen se resalta. */
  alerta?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col rounded-xl border border-foreground/10 bg-background p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{titulo}</h2>
          {resumen && (
            <p className={`text-sm ${alerta ? "font-medium text-amber-700 dark:text-amber-400" : "text-foreground/60"}`}>
              {resumen}
            </p>
          )}
        </div>
        <Link
          href={href}
          className="flex shrink-0 items-center gap-1 text-xs text-foreground/50 hover:text-foreground"
        >
          Ver <ArrowRight size={12} />
        </Link>
      </div>
      <div className="divide-y divide-foreground/5">{children}</div>
    </section>
  );
}

function Renglon({
  izquierda,
  debajo,
  derecha,
  href,
}: {
  izquierda: string;
  debajo?: string;
  derecha: string;
  /** Si el renglón lleva a otra pantalla que la de su tarjeta: los cheques adentro de Plata. */
  href?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <div className="min-w-0">
        <p className="truncate">
          {href ? (
            <Link href={href} className="underline-offset-2 hover:underline">
              {izquierda}
            </Link>
          ) : (
            izquierda
          )}
        </p>
        {debajo && <p className="truncate text-xs text-foreground/50">{debajo}</p>}
      </div>
      <p className="shrink-0 text-right tabular-nums">{derecha}</p>
    </div>
  );
}
