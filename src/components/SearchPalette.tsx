"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Contact,
  Factory,
  Landmark,
  Package,
  Search,
  Send,
  ShoppingCart,
  type LucideIcon,
} from "lucide-react";
import type { SearchResult, SearchResultKind } from "@/lib/search";

/** Cada tipo usa el mismo ícono que el sidebar le da a su sección, así se ve adónde vas a caer. */
const KIND_ICONS: Record<SearchResultKind, LucideIcon> = {
  cliente: Contact,
  proveedor: Building2,
  tesoreria: Landmark,
  insumo: Package,
  producto: Factory,
  entrega: Send,
  compra: ShoppingCart,
};

const KIND_GROUPS: Record<SearchResultKind, string> = {
  cliente: "Clientes y proveedores",
  proveedor: "Clientes y proveedores",
  tesoreria: "Clientes y proveedores",
  insumo: "Insumos",
  producto: "Productos",
  entrega: "Remitos",
  compra: "Remitos",
};

const MIN_TERM_LENGTH = 2;
const DEBOUNCE_MS = 200;

type Status = "idle" | "loading" | "done" | "error";

export function SearchPalette() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();

  // No hay estado `open`: la fuente de verdad es el <dialog>, y onClose limpia todo — mismo rol
  // que el resetKey de FormModal.
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [activeIndex, setActiveIndex] = useState(0);

  // Atajo global. Las dependencias vacías son seguras porque el handler solo lee dialogRef (un ref,
  // que se resuelve al invocarse); por eso las flechas y Enter van en el input y no acá.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat || event.defaultPrevented) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); // sin esto el navegador se lleva el foco a la barra de direcciones
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (dialog.open) dialog.close();
        else dialog.showModal();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Las transiciones que dispara el usuario al tipear viven acá, no en el efecto: el efecto solo
  // se sincroniza con la red.
  function onQueryChange(value: string) {
    setQuery(value);
    if (value.trim().length < MIN_TERM_LENGTH) {
      setResults([]);
      setStatus("idle");
      setActiveIndex(0);
    } else {
      setStatus("loading");
    }
  }

  // Debounce + cancelación en un solo efecto: React corre esta limpieza antes del próximo efecto,
  // así solo la consulta más nueva puede llegar a setResults y no hay carrera de respuestas viejas.
  useEffect(() => {
    const term = query.trim();
    if (term.length < MIN_TERM_LENGTH) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/buscar?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("La búsqueda falló");
        const data = (await response.json()) as { results: SearchResult[] };
        setResults(data.results);
        setActiveIndex(0);
        setStatus("done");
      } catch (error) {
        // Se descarta por nombre: en dev con StrictMode el efecto se monta dos veces y si no
        // parpadearía un error en cada apertura.
        if ((error as Error)?.name === "AbortError") return;
        setResults([]);
        setStatus("error");
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    document.getElementById(`search-option-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  function go(result: SearchResult) {
    if (!result.href.startsWith("/")) return;
    // Cerrar antes de navegar: devuelve el foco al botón y evita que la paleta quede flotando
    // sobre la página entrante.
    dialogRef.current?.close();
    router.push(result.href);
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (i - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const result = results[activeIndex];
      if (result) go(result);
    }
    // Escape no se toca: lo maneja el <dialog> nativo, que además dispara onClose.
  }

  const term = query.trim();
  const showResults = results.length > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        title="Buscar (⌘K / Ctrl K)"
        aria-label="Buscar"
        className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground"
      >
        <Search size={16} />
        <span className="hidden sm:inline">Buscar</span>
      </button>

      <dialog
        ref={dialogRef}
        aria-label="Búsqueda"
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
        onClose={() => {
          setQuery("");
          setResults([]);
          setStatus("idle");
          setActiveIndex(0);
        }}
        className="fixed inset-x-0 top-[10vh] mx-auto w-[calc(100%-2rem)] max-w-xl rounded-xl border border-foreground/10 bg-background p-0 text-foreground shadow-xl backdrop:bg-black/50"
      >
        <div className="flex items-center gap-2 border-b border-foreground/10 px-4 py-3">
          <Search size={16} className="shrink-0 text-foreground/40" />
          <input
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Buscar cliente, insumo, producto o número de remito…"
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-label="Buscar"
            aria-expanded={showResults}
            aria-controls="search-listbox"
            aria-autocomplete="list"
            aria-activedescendant={showResults ? `search-option-${activeIndex}` : undefined}
            className="w-full bg-transparent text-sm outline-none placeholder:text-foreground/40"
          />
        </div>

        <p className="sr-only" role="status" aria-live="polite">
          {showResults ? `${results.length} resultados` : ""}
        </p>

        <div className="max-h-[60vh] overflow-y-auto">
          {showResults && (
            <ul
              id="search-listbox"
              role="listbox"
              aria-label="Resultados"
              // Mientras recarga se deja la lista anterior atenuada: si se vaciara, colapsaría y
              // se re-expandiría en cada tecla.
              className={status === "loading" ? "py-2 opacity-60" : "py-2"}
            >
              {results.map((result, index) => {
                const Icon = KIND_ICONS[result.kind];
                const grupo = KIND_GROUPS[result.kind];
                const grupoAnterior = index > 0 ? KIND_GROUPS[results[index - 1].kind] : null;
                return (
                  <li key={`${result.kind}-${result.id}`} role="presentation">
                    {grupo !== grupoAnterior && (
                      <p
                        aria-hidden="true"
                        className="px-4 pb-1 pt-3 text-xs font-medium uppercase tracking-wide text-foreground/40"
                      >
                        {grupo}
                      </p>
                    )}
                    <div
                      id={`search-option-${index}`}
                      role="option"
                      aria-selected={index === activeIndex}
                      onClick={() => go(result)}
                      // onMouseMove y no onMouseEnter: si no, flechar se interrumpe apenas una
                      // fila pasa bajo un cursor quieto.
                      onMouseMove={() => setActiveIndex(index)}
                      className={`flex cursor-pointer items-center gap-3 px-4 py-2 ${
                        index === activeIndex ? "bg-foreground/5" : ""
                      }`}
                    >
                      <Icon size={16} className="shrink-0 text-foreground/50" />
                      <div className="min-w-0">
                        <p className="truncate text-sm">{result.label}</p>
                        <p className="truncate text-xs text-foreground/60">{result.sublabel}</p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {!showResults && (
            <p className="px-4 py-8 text-center text-sm text-foreground/50">
              {term.length < MIN_TERM_LENGTH
                ? "Buscá un cliente, proveedor, insumo, producto o número de remito."
                : status === "loading"
                  ? "Buscando…"
                  : status === "error"
                    ? "No se pudo buscar. Probá de nuevo."
                    : `Sin resultados para "${term}".`}
            </p>
          )}
        </div>

        <p className="hidden border-t border-foreground/10 px-4 py-2 text-xs text-foreground/40 sm:block">
          ↑↓ para moverte · Enter para abrir · Esc para cerrar
        </p>
      </dialog>
    </>
  );
}
