"use client";

import { useId, useMemo, useRef, useState } from "react";

export type OpcionBuscable = {
  value: string;
  label: string;
  /** Un dato más para distinguir: el rubro de un insumo, el CUIT de un cliente. Se busca también. */
  detalle?: string;
};

/** Sin tildes y en minúscula: "jose" encuentra "Don José". */
const normalizar = (texto: string) =>
  texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/**
 * Un desplegable en el que se escribe para buscar: "camp" y aparece La Campechana.
 *
 * El `<select>` común sólo salta por la primera letra, y con veinte clientes o sesenta insumos había
 * que recorrer la lista con la rueda. Este guarda lo mismo que guardaba el select —el id, en un
 * campo oculto con el mismo `name`—, así que las acciones del servidor no se enteran del cambio.
 *
 * Sirve controlado (`value` + `onChange`) o suelto (`defaultValue`), igual que un select.
 */
export function SelectBuscable({
  id,
  name,
  opciones,
  value,
  defaultValue = "",
  onChange,
  placeholder = "Escribí para buscar…",
  required = false,
  disabled = false,
  className,
}: {
  id?: string;
  /** El nombre del campo que viaja en el formulario. Sin nombre, sólo avisa por `onChange`. */
  name?: string;
  opciones: OpcionBuscable[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const idPropio = useId();
  const inputId = id ?? idPropio;
  const listaId = `${inputId}-lista`;
  const [interno, setInterno] = useState(defaultValue);
  const elegido = value ?? interno;
  const opcionElegida = opciones.find((o) => o.value === elegido) ?? null;

  // Mientras se escribe se muestra lo tipeado; si no, el nombre de lo elegido.
  const [texto, setTexto] = useState<string | null>(null);
  const [abierta, setAbierta] = useState(false);
  const [resaltada, setResaltada] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtradas = useMemo(() => {
    if (texto === null || texto.trim() === "") return opciones;
    const buscado = normalizar(texto.trim());
    return opciones.filter((o) => normalizar(`${o.label} ${o.detalle ?? ""}`).includes(buscado));
  }, [opciones, texto]);

  function elegir(opcion: OpcionBuscable | null) {
    const nuevo = opcion?.value ?? "";
    if (value === undefined) setInterno(nuevo);
    onChange?.(nuevo);
    setTexto(null);
    setAbierta(false);
    inputRef.current?.setCustomValidity("");
  }

  function alEscribir(nuevoTexto: string) {
    setTexto(nuevoTexto);
    setAbierta(true);
    setResaltada(0);
    // Lo escrito ya no es lo elegido: hasta que se elija otro, no hay nada elegido. Si no, quedaría
    // "Cassan" a la vista y viajaría el id de La Campechana.
    if (elegido) {
      if (value === undefined) setInterno("");
      onChange?.("");
    }
  }

  function alTeclear(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAbierta(true);
      setResaltada((i) => Math.min(i + 1, filtradas.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setResaltada((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      // Enter elige; no manda el formulario a medio cargar.
      if (abierta && filtradas[resaltada]) {
        e.preventDefault();
        elegir(filtradas[resaltada]);
      }
    } else if (e.key === "Escape" && abierta) {
      e.preventDefault();
      setAbierta(false);
      setTexto(null);
    }
  }

  return (
    <div className="relative">
      {name && <input type="hidden" name={name} value={elegido} />}
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={abierta}
        aria-controls={listaId}
        aria-autocomplete="list"
        autoComplete="off"
        disabled={disabled}
        // Obligatorio = que haya algo elegido. Con texto suelto que no coincide con nada, el
        // navegador frena el envío con este aviso en vez de mandar el campo vacío.
        required={required && !elegido}
        onInvalid={(e) => {
          if (texto) e.currentTarget.setCustomValidity("Elegí una opción de la lista.");
        }}
        value={texto ?? opcionElegida?.label ?? ""}
        placeholder={placeholder}
        onChange={(e) => {
          e.currentTarget.setCustomValidity("");
          alEscribir(e.target.value);
        }}
        onFocus={(e) => {
          e.currentTarget.select();
          setAbierta(true);
          setResaltada(Math.max(0, filtradas.findIndex((o) => o.value === elegido)));
        }}
        onBlur={() => {
          setAbierta(false);
          setTexto(null);
        }}
        onKeyDown={alTeclear}
        className={className}
      />
      {abierta && !disabled && (
        <ul
          id={listaId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-foreground/15 bg-background py-1 text-sm shadow-lg"
        >
          {filtradas.length === 0 ? (
            <li className="px-3 py-2 text-foreground/50">No hay coincidencias.</li>
          ) : (
            filtradas.map((o, i) => (
              <li
                key={o.value}
                role="option"
                aria-selected={o.value === elegido}
                // mousedown y no click: el click llega después del blur, que ya cerró la lista.
                onMouseDown={(e) => {
                  e.preventDefault();
                  elegir(o);
                }}
                onMouseEnter={() => setResaltada(i)}
                className={`flex cursor-pointer items-baseline justify-between gap-3 px-3 py-1.5 ${
                  i === resaltada ? "bg-primary/15" : ""
                } ${o.value === elegido ? "font-medium" : ""}`}
              >
                <span>{o.label}</span>
                {o.detalle && <span className="shrink-0 text-xs text-foreground/50">{o.detalle}</span>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
