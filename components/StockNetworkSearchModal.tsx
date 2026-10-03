import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  Clock,
  CornerDownLeft,
  History,
  Loader2,
  Package,
  Search,
  X,
} from "lucide-react";
import {
  buildProductIndex,
  countPharmaciesInResults,
  exactProductMatch,
  searchNetworkStock,
  searchNetworkStockByProduct,
  suggestProducts,
  type StockNetworkRow,
  type StockProduct,
} from "../services/stockNetworkSearch";
import { describePharmacyCode } from "../services/facilitySheetLink";

/** Dónde se busca: la UNGET abierta o todas las UNGET a la vista. */
export type StockSearchScope = "unget" | "region";

interface StockNetworkSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Nombre de la UNGET, para que se sepa dónde se está buscando. */
  ungetName: string;
  /** Todas las filas de stock ya descargadas en el alcance elegido. */
  rows: any[];
  /** Establecimientos registrados, para poner nombre a cada código de farmacia. */
  facilities: Array<{ code?: string | null; name?: string | null }>;
  /** Cobertura de la búsqueda: hojas con stock descargado sobre el total. */
  sheetsLoaded: number;
  sheetsTotal: number;
  /** Descarga las hojas que faltan. Sin ella no se ofrece completar. */
  onCompleteSearch?: () => void;
  isCompleting?: boolean;
  /**
   * Con qué se abre: un producto ya elegido en las sugerencias del buscador de la lista, o
   * lo escrito allí para buscarlo tal cual. Sin ellos se abre vacío.
   */
  initialProduct?: StockProduct | null;
  initialQuery?: string;
  /**
   * Alcance. Con `onScopeChange` se ofrece cambiarlo («esta UNGET» / «Toda la región»);
   * sin él, se busca solo donde diga `scope`.
   */
  scope?: StockSearchScope;
  onScopeChange?: (scope: StockSearchScope) => void;
  /** A qué UNGET pertenece un código de farmacia: se muestra al buscar en la región. */
  ungetOfCode?: (almcod: string) => string;
}

/**
 * Cantidad sin separador de miles.
 *
 * `31,918` se lee como «treinta y uno coma…» en una pantalla donde el resto de saldos van
 * sin agrupar, y la coma confunde con el decimal. Los saldos se escriben con sus cifras.
 */
const formatearCantidad = (valor: number): string =>
  new Intl.NumberFormat("es-PE", { maximumFractionDigits: 2, useGrouping: false }).format(valor);

/** `d/m/aaaa` → marca de tiempo, para ordenar y para saber si un lote venció. */
const fechaDeVencimiento = (texto: string): number => {
  const partes = String(texto || "").trim().split(/[/-]/).map(Number);
  if (partes.length !== 3 || partes.some((n) => !Number.isFinite(n))) return Number.POSITIVE_INFINITY;
  const [a, b, c] = partes;
  const [dia, mes, anio] = a > 31 ? [c, b, a] : [a, b, c];
  return new Date(anio, mes - 1, dia).getTime();
};

/** Vencimiento más próximo de una fila. */
const proximoVencimiento = (fila: StockNetworkRow) =>
  fila.lotes.reduce(
    (min, lote) => {
      const t = fechaDeVencimiento(lote.vencimiento);
      return t < min.t ? { t, texto: lote.vencimiento } : min;
    },
    { t: Number.POSITIVE_INFINITY, texto: "" },
  );

type Orden = "saldo" | "vencimiento" | "nombre";

const RECIENTES_KEY = "consulta-stock:busquedas-recientes";
const MAX_RECIENTES = 6;

const leerRecientes = (): Array<Pick<StockProduct, "key" | "producto" | "codigoSismed">> => {
  try {
    const crudo = JSON.parse(localStorage.getItem(RECIENTES_KEY) || "[]");
    return Array.isArray(crudo) ? crudo.slice(0, MAX_RECIENTES) : [];
  } catch {
    return [];
  }
};

const guardarReciente = (producto: StockProduct) => {
  try {
    const nuevos = [
      { key: producto.key, producto: producto.producto, codigoSismed: producto.codigoSismed },
      ...leerRecientes().filter((r) => r.key !== producto.key),
    ].slice(0, MAX_RECIENTES);
    localStorage.setItem(RECIENTES_KEY, JSON.stringify(nuevos));
  } catch {
    // Sin almacenamiento solo se pierden las búsquedas recientes.
  }
};

/**
 * Buscador de un producto en todas las hojas de la UNGET (o de la región).
 *
 * **Primero se elige el producto, después se consulta.** Mientras se escribe solo se
 * ofrecen productos —una lista corta, sacada de un catálogo que se arma una vez— y los
 * resultados aparecen cuando ya se sabe cuál es: al elegirlo de la lista, al escribir su
 * código entero o al pulsar Intro. Buscar en cada tecla recorría las decenas de miles de
 * filas de la UNGET y el campo se trababa al teclear.
 *
 * El resultado se consolida por código de farmacia: una fila por establecimiento, con el
 * total de sus lotes. Un puesto comunal aparece como fila propia y con su nombre, porque
 * su stock es suyo y no del establecimiento del que cuelga.
 *
 * Diseño (2026-10-03): una sola fila arriba con el campo (en el celular, con la flecha de
 * volver, como los buscadores de las apps), el alcance siempre visible debajo, búsquedas
 * recientes antes de escribir y, al elegir el producto, una ficha con su total y la lista
 * ordenable por saldo, vencimiento o nombre.
 */
export const StockNetworkSearchModal: React.FC<StockNetworkSearchModalProps> = ({
  isOpen,
  onClose,
  ungetName,
  rows,
  facilities,
  sheetsLoaded,
  sheetsTotal,
  onCompleteSearch,
  isCompleting = false,
  initialProduct = null,
  initialQuery = "",
  scope = "unget",
  onScopeChange,
  ungetOfCode,
}) => {
  const [term, setTerm] = useState("");
  /** El producto que se está consultando. Sin él no hay resultados que mostrar. */
  const [elegido, setElegido] = useState<StockProduct | null>(null);
  /** Lo buscado con Intro sin elegir producto: puede traer varios productos a la vez. */
  const [consultaLibre, setConsultaLibre] = useState("");
  const [resaltada, setResaltada] = useState(0);
  const [expandida, setExpandida] = useState<string | null>(null);
  const [orden, setOrden] = useState<Orden>("saldo");
  const [recientes, setRecientes] = useState(leerRecientes);
  const campoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const foco = window.setTimeout(() => campoRef.current?.focus(), 60);
    const alPulsar = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") onClose();
    };
    document.addEventListener("keydown", alPulsar);
    return () => {
      window.clearTimeout(foco);
      document.body.style.overflow = previo;
      document.removeEventListener("keydown", alPulsar);
    };
  }, [isOpen, onClose]);

  // Al abrirse desde el buscador de la lista llega ya con lo buscado.
  useEffect(() => {
    if (!isOpen) return;
    setRecientes(leerRecientes());
    if (initialProduct) {
      setElegido(initialProduct);
      setTerm(initialProduct.producto || initialProduct.codigoSismed);
      guardarReciente(initialProduct);
    } else if (initialQuery.trim()) {
      setTerm(initialQuery);
      setConsultaLibre(initialQuery);
    }
    // Solo al abrir: después manda lo que se escriba en el propio diálogo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Al cerrarse se olvida lo buscado: la próxima vez se empieza limpio.
  useEffect(() => {
    if (!isOpen) {
      setTerm("");
      setElegido(null);
      setConsultaLibre("");
      setResaltada(0);
      setExpandida(null);
      setOrden("saldo");
    }
  }, [isOpen]);

  /**
   * Catálogo de productos del alcance. Se arma una vez por cada carga de stock, no por
   * cada tecla, y solo con el diálogo abierto: es lo que permite sugerir al instante.
   */
  const indice = useMemo(() => (isOpen ? buildProductIndex(rows) : []), [isOpen, rows]);

  // Lo escrito va al campo de inmediato; sugerir puede ir un paso por detrás sin que se
  // note. Es lo que evita que el teclado espere a la lista.
  const termDiferido = useDeferredValue(term);

  const sugerencias = useMemo(
    () => (elegido ? [] : suggestProducts(indice, termDiferido)),
    [elegido, indice, termDiferido],
  );

  const resultados: StockNetworkRow[] = useMemo(() => {
    const base = elegido
      ? searchNetworkStockByProduct(rows, elegido.key)
      : consultaLibre
        ? searchNetworkStock(rows, consultaLibre)
        : [];
    if (orden === "saldo") return base;
    const nombre = (fila: StockNetworkRow) => describePharmacyCode(fila.almcod, facilities).name || fila.almcod;
    return [...base].sort((a, b) =>
      orden === "vencimiento"
        ? proximoVencimiento(a).t - proximoVencimiento(b).t
        : nombre(a).localeCompare(nombre(b)),
    );
  }, [consultaLibre, elegido, rows, orden, facilities]);

  const totalUnidades = useMemo(
    () => resultados.reduce((suma, fila) => suma + fila.total, 0),
    [resultados],
  );

  const elegir = (producto: StockProduct) => {
    setElegido(producto);
    setTerm(producto.producto || producto.codigoSismed);
    setConsultaLibre("");
    setExpandida(null);
    guardarReciente(producto);
  };

  const alEscribir = (valor: string) => {
    setTerm(valor);
    setConsultaLibre("");
    setExpandida(null);
    setResaltada(0);
    // Un código escrito entero no necesita que se baje a la lista a confirmarlo.
    setElegido(exactProductMatch(indice, valor));
  };

  const limpiar = () => {
    setTerm("");
    setElegido(null);
    setConsultaLibre("");
    setResaltada(0);
    setExpandida(null);
    campoRef.current?.focus();
  };

  const alPulsarTecla = (evento: React.KeyboardEvent<HTMLInputElement>) => {
    if (evento.key === "ArrowDown" || evento.key === "ArrowUp") {
      if (sugerencias.length === 0) return;
      evento.preventDefault();
      const paso = evento.key === "ArrowDown" ? 1 : -1;
      setResaltada((previa) => (previa + paso + sugerencias.length) % sugerencias.length);
      return;
    }
    if (evento.key === "Enter") {
      evento.preventDefault();
      const destacada = sugerencias[resaltada];
      if (destacada) elegir(destacada);
      // Sin sugerencias, Intro busca lo escrito tal cual: puede traer varios productos.
      else if (term.trim()) setConsultaLibre(term);
    }
  };

  if (!isOpen) return null;

  const escribiendo = term.trim().length > 0;
  const hayConsulta = Boolean(elegido || consultaLibre);
  const faltanHojas = sheetsTotal > 0 && sheetsLoaded < sheetsTotal;
  const dondeSeBusca = scope === "region" ? "toda la región" : ungetName;
  const recientesDisponibles = recientes
    .map((r) => indice.find((p) => p.key === r.key))
    .filter((p): p is StockProduct => Boolean(p));
  const ahora = Date.now();
  const establecimientosConStock = countPharmaciesInResults(resultados);

  /** Cobertura en una sola línea, con la acción de completar al lado. */
  const cobertura = faltanHojas ? (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-amber-700">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span className="font-semibold">
        Stock leído de {sheetsLoaded} de {sheetsTotal} establecimientos
      </span>
      {onCompleteSearch && (
        <button
          type="button"
          onClick={onCompleteSearch}
          disabled={isCompleting}
          className="inline-flex items-center gap-1 font-bold text-teal-700 underline-offset-2 hover:underline disabled:opacity-60"
        >
          {isCompleting && <Loader2 className="h-3 w-3 animate-spin" />}
          {isCompleting ? "Leyendo…" : "Leer los que faltan"}
        </button>
      )}
    </div>
  ) : null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1250000] flex items-start justify-center bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200 sm:p-8"
      onMouseDown={(evento) => {
        if (evento.target === evento.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Buscar medicamento en ${dondeSeBusca}`}
        className="relative flex h-[100dvh] w-full max-w-4xl flex-col overflow-hidden bg-white shadow-2xl animate-in slide-in-from-bottom-4 duration-200 sm:h-auto sm:max-h-[88vh] sm:rounded-2xl sm:border sm:border-slate-200"
      >
        {/* Cabecera: una fila con el campo y, debajo, dónde se busca. */}
        <div className="shrink-0 border-b border-slate-200 bg-white px-3 pb-2.5 pt-3 sm:px-5 sm:pt-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              aria-label="Volver"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 sm:hidden"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-teal-600" />
              <input
                ref={campoRef}
                type="search"
                enterKeyHint="search"
                value={term}
                onChange={(evento) => alEscribir(evento.target.value)}
                onKeyDown={alPulsarTecla}
                placeholder="Medicamento o código SISMED"
                aria-label="Medicamento o código SISMED"
                autoComplete="off"
                spellCheck={false}
                className="h-11 w-full rounded-full border border-slate-200 bg-slate-50 pl-10 pr-10 text-[15px] font-semibold text-slate-900 outline-none transition-all placeholder:font-medium placeholder:text-slate-400 focus:border-teal-500 focus:bg-white focus:ring-4 focus:ring-teal-500/10 [&::-webkit-search-cancel-button]:hidden"
              />
              {escribiendo && (
                <button
                  type="button"
                  onClick={limpiar}
                  aria-label="Limpiar"
                  className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-slate-200 text-slate-600 hover:bg-slate-300"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 sm:flex"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Alcance: siempre a la vista, debajo del campo (el alcance que no se ve se olvida). */}
          <div className="mt-2.5 flex items-center gap-2 overflow-x-auto">
            <span className="shrink-0 pl-1 text-xs font-semibold text-slate-500">Buscar en</span>
            {onScopeChange ? (
              ([
                { value: "unget" as const, label: ungetName },
                { value: "region" as const, label: "Toda la región" },
              ]).map((opcion) => (
                <button
                  key={opcion.value}
                  type="button"
                  onClick={() => onScopeChange(opcion.value)}
                  aria-pressed={scope === opcion.value}
                  className={`max-w-[60%] shrink-0 truncate rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
                    scope === opcion.value
                      ? "border-teal-600 bg-teal-600 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                  }`}
                >
                  {opcion.label}
                </button>
              ))
            ) : (
              <span className="truncate rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-600">
                {scope === "region" ? "Toda la región" : ungetName}
              </span>
            )}
          </div>
        </div>

        {/* Cuerpo */}
        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50">
          {!hayConsulta ? (
            !escribiendo ? (
              <div className="space-y-4 p-4 sm:p-5">
                {cobertura}
                {recientesDisponibles.length > 0 && (
                  <div>
                    <p className="mb-1.5 pl-1 text-[11px] font-black uppercase tracking-wider text-slate-400">Búsquedas recientes</p>
                    <ul className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                      {recientesDisponibles.map((producto) => (
                        <li key={producto.key} className="border-b border-slate-100 last:border-0">
                          <button
                            type="button"
                            onClick={() => elegir(producto)}
                            className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
                          >
                            <History className="h-4 w-4 shrink-0 text-slate-400" />
                            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{producto.producto || producto.key}</span>
                            {producto.codigoSismed && <span className="shrink-0 font-mono text-[11px] text-slate-400">{producto.codigoSismed}</span>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="px-2 py-8 text-center">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-teal-50 text-teal-600">
                    <Package className="h-6 w-6" />
                  </div>
                  <p className="text-sm font-semibold text-slate-700">¿Qué medicamento busca?</p>
                  <p className="mx-auto mt-1 max-w-xs text-xs text-slate-500">
                    Escriba el nombre o el código SISMED y verá cuánto hay en cada establecimiento de {dondeSeBusca}.
                  </p>
                </div>
              </div>
            ) : sugerencias.length === 0 ? (
              <div className="space-y-3 p-4 sm:p-5">
                {cobertura}
                <p className="px-2 py-10 text-center text-sm text-slate-500">
                  Ningún medicamento de {dondeSeBusca} responde a <span className="font-bold text-slate-800">«{term}»</span>
                  {faltanHojas ? " en los establecimientos leídos." : "."}
                </p>
              </div>
            ) : (
              /* Sugerencias: se elige el producto y solo entonces se consulta. */
              <ul className="divide-y divide-slate-100 bg-white">
                {sugerencias.map((producto, posicion) => (
                  <li key={producto.key}>
                    <button
                      type="button"
                      onClick={() => elegir(producto)}
                      onMouseEnter={() => setResaltada(posicion)}
                      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors sm:px-5 ${
                        posicion === resaltada ? "bg-teal-50/70" : "hover:bg-slate-50"
                      }`}
                    >
                      <Search className="h-4 w-4 shrink-0 text-slate-400" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-semibold text-slate-900">
                          {producto.producto || producto.key}
                        </span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          {producto.codigoSismed && <span className="font-mono">{producto.codigoSismed} · </span>}
                          {producto.establecimientos} establecimiento{producto.establecimientos === 1 ? "" : "s"}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-sm font-black text-slate-900">{formatearCantidad(producto.total)}</span>
                        <span className="block text-[10px] font-bold uppercase text-slate-400">unidades</span>
                      </span>
                      {posicion === resaltada && <CornerDownLeft className="hidden h-3.5 w-3.5 shrink-0 text-teal-600 sm:block" />}
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <div className="space-y-3 p-3 sm:p-5">
              {/* Ficha del producto consultado */}
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[15px] font-black leading-snug text-slate-900">
                      {elegido ? elegido.producto || elegido.key : `Resultados de «${consultaLibre}»`}
                    </p>
                    {elegido?.codigoSismed && (
                      <span className="mt-1 inline-block rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-bold text-slate-600">
                        {elegido.codigoSismed}
                      </span>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-2xl font-black leading-none text-teal-700">{formatearCantidad(totalUnidades)}</p>
                    <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">unidades</p>
                  </div>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  En <b className="text-slate-700">{establecimientosConStock}</b> establecimiento
                  {establecimientosConStock === 1 ? "" : "s"} de {dondeSeBusca}
                </p>
                {cobertura && <div className="mt-2 border-t border-slate-100 pt-2">{cobertura}</div>}
              </div>

              {resultados.length === 0 ? (
                <p className="px-2 py-10 text-center text-sm text-slate-500">
                  Sin stock de este medicamento{faltanHojas ? " en los establecimientos leídos." : "."}
                </p>
              ) : (
                <>
                  {/* Orden */}
                  <div className="flex items-center gap-1.5 overflow-x-auto">
                    <span className="shrink-0 pl-1 text-xs font-semibold text-slate-500">Ordenar</span>
                    {([
                      { value: "saldo" as const, label: "Mayor saldo" },
                      { value: "vencimiento" as const, label: "Próximo a vencer" },
                      { value: "nombre" as const, label: "A–Z" },
                    ]).map((opcion) => (
                      <button
                        key={opcion.value}
                        type="button"
                        onClick={() => setOrden(opcion.value)}
                        aria-pressed={orden === opcion.value}
                        className={`shrink-0 rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
                          orden === opcion.value
                            ? "border-teal-600 bg-teal-50 text-teal-800"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                        }`}
                      >
                        {opcion.label}
                      </button>
                    ))}
                  </div>

                  <ul className="space-y-2">
                    {resultados.map((fila) => {
                      const etiqueta = describePharmacyCode(fila.almcod, facilities);
                      const abierta = expandida === fila.id;
                      const vence = proximoVencimiento(fila);
                      const vencido = vence.t < ahora;
                      const unget = scope === "region" ? ungetOfCode?.(fila.almcod) : "";
                      return (
                        <li key={fila.id} className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${abierta ? "border-teal-300" : "border-slate-200"}`}>
                          <button
                            type="button"
                            onClick={() => setExpandida(abierta ? null : fila.id)}
                            aria-expanded={abierta}
                            className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-slate-50"
                          >
                            <span className="min-w-0 flex-1">
                              {/* Sin nombre se dice por qué: un guion no distingue «no lo
                                  encontré» de «no está dado de alta en Establecimientos». */}
                              <span className="block truncate text-[14px] font-bold text-slate-900">
                                {etiqueta.name || <span className="italic text-slate-500">Sin registrar</span>}
                              </span>
                              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                                <span className="font-mono font-bold text-teal-700">{etiqueta.code}</span>
                                {unget && <span className="truncate">{unget}</span>}
                                {etiqueta.unregistered && <span className="font-semibold text-amber-700">Puesto sin registrar</span>}
                              </span>
                              {vence.texto && (
                                <span className={`mt-1 inline-flex items-center gap-1 text-xs font-semibold ${vencido ? "text-rose-700" : "text-slate-500"}`}>
                                  <Clock className="h-3 w-3" />
                                  {vencido ? "Venció" : "Vence"} {vence.texto}
                                  {fila.lotes.length > 1 && <span className="font-normal text-slate-400">· {fila.lotes.length} lotes</span>}
                                </span>
                              )}
                            </span>
                            <span className="shrink-0 text-right">
                              <span className="block text-xl font-black leading-none text-slate-900">{formatearCantidad(fila.total)}</span>
                              <span className="mt-1 block text-[10px] font-bold uppercase tracking-wide text-slate-400">saldo</span>
                            </span>
                            <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${abierta ? "rotate-180 text-teal-600" : ""}`} />
                          </button>

                          {abierta && (
                            <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-2">
                              {/* Escritorio: tabla de lotes. */}
                              <table className="hidden w-full text-left text-xs sm:table">
                                <thead>
                                  <tr className="text-[10px] font-black uppercase tracking-wide text-slate-500">
                                    <th className="py-1.5 pr-3">Lote</th>
                                    <th className="py-1.5 pr-3">Vence</th>
                                    <th className="py-1.5 pr-3">Tipo sum.</th>
                                    <th className="py-1.5 pr-3">F. financ.</th>
                                    <th className="py-1.5 pr-3">Reg. sanitario</th>
                                    <th className="py-1.5 text-right">Saldo</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {fila.lotes.map((lote, indiceLote) => (
                                    <tr key={`${lote.lote}-${indiceLote}`} className="border-t border-slate-200/70 text-slate-600">
                                      <td className="py-2 pr-3 font-mono font-bold text-slate-800">{lote.lote || "—"}</td>
                                      <td className={`py-2 pr-3 ${fechaDeVencimiento(lote.vencimiento) < ahora ? "font-semibold text-rose-700" : ""}`}>{lote.vencimiento || "—"}</td>
                                      <td className="py-2 pr-3">{lote.tipoSuministro || "—"}</td>
                                      <td className="py-2 pr-3">{lote.fuenteFinanciamiento || "—"}</td>
                                      <td className="py-2 pr-3 font-mono">{lote.registroSanitario || "—"}</td>
                                      <td className="py-2 text-right font-black text-slate-800">{formatearCantidad(lote.saldo)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              {/* Celular: un renglón por lote. */}
                              <ul className="divide-y divide-slate-200/70 sm:hidden">
                                {fila.lotes.map((lote, indiceLote) => (
                                  <li key={`${lote.lote}-${indiceLote}`} className="flex items-center justify-between gap-3 py-2 text-xs">
                                    <span className="min-w-0">
                                      <span className="block font-mono font-bold text-slate-800">Lote {lote.lote || "—"}</span>
                                      <span className={`block ${fechaDeVencimiento(lote.vencimiento) < ahora ? "font-semibold text-rose-700" : "text-slate-500"}`}>
                                        Vence {lote.vencimiento || "—"}
                                      </span>
                                    </span>
                                    <span className="shrink-0 text-sm font-black text-slate-800">{formatearCantidad(lote.saldo)}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>

        <div className="hidden shrink-0 items-center justify-end gap-4 border-t border-slate-100 px-5 py-2 text-[11px] font-semibold text-slate-400 sm:flex">
          <span className="inline-flex items-center gap-1.5">
            <CornerDownLeft className="h-3.5 w-3.5" />
            {hayConsulta ? "Toque un establecimiento para ver sus lotes" : "Flechas para elegir · Intro para consultar"}
          </span>
          <span>Esc para cerrar</span>
        </div>
      </section>
    </div>,
    document.body,
  );
};
