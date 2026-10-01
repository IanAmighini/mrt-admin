/**
 * Las piezas de una tabla, no un componente que arma la tabla entera.
 *
 * Es a propósito: las veinte tablas de la app son todas distintas —una tiene un saldo corrido,
 * otra botones por fila, otra celdas combinadas— y un componente que recibiera `columns` y `rows`
 * terminaría con diez props para cubrir los casos raros. Lo que sí se repite es el envoltorio con
 * scroll, el borde del encabezado y el relleno de cada celda, y eso es lo que vive acá.
 *
 * El envoltorio importa más de lo que parece: una tabla sin él rompe el ancho de la página en el
 * teléfono, y la app se mira desde el teléfono para consultar un saldo o un stock.
 */
export function Table({
  children,
  className,
  /** En las tablas que van adentro de una tarjeta, el borde y el fondo los pone la tarjeta. */
  suelta = true,
}: {
  children: React.ReactNode;
  className?: string;
  suelta?: boolean;
}) {
  const envoltorio = suelta
    ? "overflow-x-auto"
    : "overflow-x-auto rounded-xl border border-foreground/10 bg-background shadow-sm";
  return (
    <div className={envoltorio}>
      <table className={`w-full text-sm ${className ?? ""}`}>{children}</table>
    </div>
  );
}

export function Thead({ children }: { children: React.ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-foreground/10 text-left text-foreground/60">{children}</tr>
    </thead>
  );
}

type Alineacion = "izquierda" | "derecha";

const alineacionClase: Record<Alineacion, string> = {
  izquierda: "",
  derecha: "text-right",
};

/**
 * `secundaria` esconde la columna en pantalla chica.
 *
 * El teléfono se usa para consultar algo rápido —un saldo, un stock— y una tabla de siete
 * columnas deja justo ese dato fuera de pantalla: hay que arrastrar la tabla al costado para
 * llegar al único número por el que uno entró. Esconder lo accesorio deja a la vista el nombre
 * y el número, que es para lo que se mira desde el celular.
 */
export function Th({
  children,
  align = "izquierda",
  secundaria = false,
  className,
}: {
  children?: React.ReactNode;
  align?: Alineacion;
  secundaria?: boolean;
  className?: string;
}) {
  const clases = [
    "py-2 pr-4",
    alineacionClase[align],
    secundaria ? "hidden md:table-cell" : "",
    className ?? "",
  ];
  return <th className={clases.filter(Boolean).join(" ")}>{children}</th>;
}

export function Tr({ children, className }: { children: React.ReactNode; className?: string }) {
  return <tr className={`border-b border-foreground/5 ${className ?? ""}`}>{children}</tr>;
}

export function Td({
  children,
  align = "izquierda",
  colSpan,
  rowSpan,
  /** Para las celdas combinadas: el contenido se apoya arriba y no en el medio del bloque. */
  arriba = false,
  /** Para los números: los alinea a la derecha y usa cifras de ancho fijo, que es lo que hace que
   *  una columna de montos se pueda leer de un vistazo. */
  numero = false,
  secundaria = false,
  className,
}: {
  children?: React.ReactNode;
  align?: Alineacion;
  numero?: boolean;
  /** Ver `Th`: se esconde en pantalla chica. */
  secundaria?: boolean;
  colSpan?: number;
  rowSpan?: number;
  arriba?: boolean;
  className?: string;
}) {
  const clases = [
    "py-2 pr-4",
    numero ? "text-right tabular-nums" : alineacionClase[align],
    arriba ? "align-top" : "",
    secundaria ? "hidden md:table-cell" : "",
    className ?? "",
  ];
  return (
    <td colSpan={colSpan} rowSpan={rowSpan} className={clases.filter(Boolean).join(" ")}>
      {children}
    </td>
  );
}

/** La fila que explica por qué no hay filas. Siempre con un texto propio: "Sin datos" no ayuda. */
export function TableEmpty({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-6 text-center text-foreground/40">
        {children}
      </td>
    </tr>
  );
}
