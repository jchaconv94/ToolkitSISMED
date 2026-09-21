import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  ChevronRight,
  CornerDownLeft,
  Loader2,
  MapPin,
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

interface StockNetworkSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Nombre de la UNGET, para que se sepa dónde se está buscando. */
  ungetName: string;
  /** Todas las filas de stock ya descargadas de esa UNGET. */
  rows: any[];
  /** Establecimientos registrados, para poner nombre a cada código de farmacia. */
  facilities: Array<{ code?: string | null; name?: string | null }>;
  /** Cobertura de la búsqueda: hojas con stock descargado sobre el total. */
  sheetsLoaded: number;
  sheetsTotal: number;
  /** Descarga las hojas que faltan. Sin ella no se ofrece completar. */
  onCompleteSearch?: () => void;
  isCompleting?: boolean;
}

/**
 * Cantidad sin separador de miles.
 *
 * `31,918` se lee como «treinta y uno coma…» en una pantalla donde el resto de saldos van
 * sin agrupar, y la coma confunde con el decimal. Los saldos se escriben con sus cifras.
 */
const formatearCantidad = (valor: number): string =>
  new Intl.NumberFormat("es-PE", { maximumFractionDigits: 2, useGrouping: false }).format(valor);

/**
 * Buscador de un producto en todas las hojas de la UNGET.
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
}) => {
  const [term, setTerm] = useState("");
  /** El producto que se está consultando. Sin él no hay resultados que mostrar. */
  const [elegido, setElegido] = useState<StockProduct | null>(null);
  /** Lo buscado con Intro sin elegir producto: puede traer varios productos a la vez. */
  const [consultaLibre, setConsultaLibre] = useState("");
  const [resaltada, setResaltada] = useState(0);
  const [expandida, setExpandida] = useState<string | null>(null);
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

  // Al cerrarse se olvida lo buscado: la próxima vez se empieza limpio.
  useEffect(() => {
    if (!isOpen) {
      setTerm("");
      setElegido(null);
      setConsultaLibre("");
      setResaltada(0);
      setExpandida(null);
    }
  }, [isOpen]);

  /**
   * Catálogo de productos de la UNGET. Se arma una vez por cada carga de stock, no por
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
    if (elegido) return searchNetworkStockByProduct(rows, elegido.key);
    if (consultaLibre) return searchNetworkStock(rows, consultaLibre);
    return [];
  }, [consultaLibre, elegido, rows]);

  const totalUnidades = useMemo(
    () => resultados.reduce((suma, fila) => suma + fila.total, 0),
    [resultados],
  );

  const elegir = (producto: StockProduct) => {
    setElegido(producto);
    setTerm(producto.producto || producto.codigoSismed);
    setConsultaLibre("");
    setExpandida(null);
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

  return createPortal(
    <div
      className="fixed inset-0 z-[1250000] flex items-start justify-center bg-slate-950/80 p-4 backdrop-blur-md animate-in fade-in duration-200 sm:p-8"
      onMouseDown={(evento) => {
        if (evento.target === evento.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Buscar producto en ${ungetName}`}
        className="relative flex w-full max-w-5xl max-h-[88vh] flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-900 shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4 duration-200"
      >
        {/* Filo superior: la única nota de color de todo el diálogo. */}
        <div className="h-px w-full bg-gradient-to-r from-transparent via-teal-400 to-transparent" />

        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute right-4 top-4 z-10 rounded-xl p-2 text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-200"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Buscador, al centro */}
        <div className="shrink-0 px-6 pb-6 pt-10 sm:px-10 sm:pt-12">
          <p className="text-center text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">
            Búsqueda avanzada · {ungetName}
          </p>
          <div className="relative mx-auto mt-5 max-w-2xl">
            <Search className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
            <input
              ref={campoRef}
              type="text"
              value={term}
              onChange={(evento) => alEscribir(evento.target.value)}
              onKeyDown={alPulsarTecla}
              placeholder="Nombre del producto o código SISMED…"
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-2xl border border-white/10 bg-white/5 py-4 pl-14 pr-12 text-base font-semibold text-white placeholder-slate-500 outline-none transition-all focus:border-teal-400/60 focus:bg-white/10 focus:ring-4 focus:ring-teal-400/10"
            />
            {escribiendo && (
              <button
                type="button"
                onClick={limpiar}
                aria-label="Limpiar"
                className="absolute right-4 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* El producto que se está consultando, para que no se pierda de vista cuál es. */}
          {elegido && (
            <div className="mx-auto mt-3 flex max-w-2xl flex-wrap items-center justify-center gap-2 text-[11px]">
              <span className="inline-flex items-center gap-2 rounded-full border border-teal-400/30 bg-teal-400/10 px-3 py-1 font-bold text-teal-200">
                <Package className="h-3 w-3" />
                {elegido.producto || elegido.key}
                {elegido.codigoSismed && (
                  <span className="font-mono text-teal-400/70">{elegido.codigoSismed}</span>
                )}
              </span>
              <button
                type="button"
                onClick={limpiar}
                className="font-bold uppercase tracking-wide text-slate-500 transition-colors hover:text-slate-300"
              >
                Buscar otro
              </button>
            </div>
          )}

          {/* Cobertura: nunca hacer creer que se vio todo cuando faltan hojas. */}
          {faltanHojas && (
            <div className="mx-auto mt-4 flex max-w-2xl flex-wrap items-center justify-center gap-2 text-center text-[11px] font-semibold text-amber-300/90">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>
                {sheetsLoaded} de {sheetsTotal} establecimientos consultados
              </span>
              {onCompleteSearch && (
                <button
                  type="button"
                  onClick={onCompleteSearch}
                  disabled={isCompleting}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 font-black uppercase tracking-wide text-amber-200 transition-colors hover:bg-amber-400/20 disabled:opacity-60"
                >
                  {isCompleting && <Loader2 className="h-3 w-3 animate-spin" />}
                  {isCompleting ? "Descargando…" : "Completar búsqueda"}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Resultados */}
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-white/5 px-4 pb-6 sm:px-8">
          {!hayConsulta ? (
            !escribiendo ? (
              <p className="py-16 text-center text-sm text-slate-500">
                Escriba un producto o un código SISMED y elíjalo de la lista.
              </p>
            ) : sugerencias.length === 0 ? (
              <p className="py-16 text-center text-sm text-slate-500">
                Ningún producto de {ungetName} responde a{" "}
                <span className="font-bold text-slate-300">{term}</span>
                {faltanHojas ? ", en los establecimientos consultados." : "."}
              </p>
            ) : (
              /* Sugerencias: se elige el producto y solo entonces se consulta la red. */
              <ul className="mx-auto max-w-3xl py-3">
                {sugerencias.map((producto, indice) => (
                  <li key={producto.key}>
                    <button
                      type="button"
                      onClick={() => elegir(producto)}
                      onMouseEnter={() => setResaltada(indice)}
                      className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors ${
                        indice === resaltada ? "bg-teal-400/10" : "hover:bg-white/5"
                      }`}
                    >
                      <Package
                        className={`h-4 w-4 shrink-0 ${
                          indice === resaltada ? "text-teal-400" : "text-slate-600"
                        }`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-slate-100">
                          {producto.producto || producto.key}
                        </span>
                        <span className="mt-0.5 block font-mono text-[10px] text-slate-500">
                          {producto.codigoSismed}
                          {` · ${producto.establecimientos} establecimiento${producto.establecimientos === 1 ? "" : "s"}`}
                          {` · ${formatearCantidad(producto.total)} en total`}
                        </span>
                      </span>
                      {indice === resaltada && (
                        <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-slate-600" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : resultados.length === 0 ? (
            <p className="py-16 text-center text-sm text-slate-500">
              Sin coincidencias para <span className="font-bold text-slate-300">{term}</span>
              {faltanHojas ? " en los establecimientos consultados." : "."}
            </p>
          ) : (
            <>
              <div className="sticky top-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-1 bg-slate-900/95 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500 backdrop-blur">
                <span className="text-teal-400">{resultados.length} resultados</span>
                <span>{countPharmaciesInResults(resultados)} establecimientos</span>
                <span>{formatearCantidad(totalUnidades)} unidades en total</span>
              </div>

              <table className="w-full border-separate border-spacing-y-1.5 text-left">
                <thead>
                  <tr className="text-[10px] font-black uppercase tracking-wider text-slate-600">
                    <th className="px-3 pb-1">Código</th>
                    <th className="px-3 pb-1">Establecimiento</th>
                    <th className="px-3 pb-1">Producto</th>
                    <th className="px-3 pb-1 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {resultados.map((fila) => {
                    const etiqueta = describePharmacyCode(fila.almcod, facilities);
                    const abierta = expandida === fila.id;
                    return (
                      <React.Fragment key={fila.id}>
                        <tr
                          onClick={() => setExpandida(abierta ? null : fila.id)}
                          className={`cursor-pointer transition-colors ${
                            abierta ? "bg-teal-400/10" : "bg-white/[0.03] hover:bg-white/[0.07]"
                          }`}
                        >
                          <td className="rounded-l-xl px-3 py-3 align-middle">
                            <div className="flex items-center gap-2">
                              <ChevronRight
                                className={`h-3.5 w-3.5 shrink-0 text-slate-600 transition-transform ${abierta ? "rotate-90 text-teal-400" : ""}`}
                              />
                              <span className="font-mono text-xs font-bold text-slate-300">
                                {etiqueta.code}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-3 align-middle">
                            {/* Sin nombre se dice por qué: un guion no distingue «no lo
                                encontré» de «no está dado de alta en Establecimientos». */}
                            {etiqueta.name ? (
                              <span className="text-sm font-bold text-white">{etiqueta.name}</span>
                            ) : (
                              <span className="text-sm font-semibold italic text-slate-500">
                                Sin registrar
                              </span>
                            )}
                            {etiqueta.unregistered && (
                              <span className="ml-2 rounded-md border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-black uppercase text-amber-300">
                                Puesto sin registrar
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-3 align-middle">
                            <div className="text-sm font-semibold leading-tight text-slate-200">
                              {fila.producto}
                            </div>
                            <div className="mt-0.5 font-mono text-[10px] text-slate-500">
                              {fila.codigoSismed}
                              {fila.lotes.length > 1 && ` · ${fila.lotes.length} lotes`}
                            </div>
                          </td>
                          <td className="rounded-r-xl px-3 py-3 text-right align-middle">
                            <span className="text-lg font-black text-teal-300">
                              {formatearCantidad(fila.total)}
                            </span>
                          </td>
                        </tr>

                        {abierta && (
                          <tr>
                            <td colSpan={4} className="px-3 pb-3">
                              <div className="overflow-hidden rounded-xl border border-white/10 bg-slate-950/60">
                                <table className="w-full text-left text-xs">
                                  <thead>
                                    <tr className="text-[10px] font-black uppercase tracking-wider text-slate-600">
                                      <th className="px-4 py-2">Lote</th>
                                      <th className="px-4 py-2">Vence</th>
                                      <th className="px-4 py-2">Tipo sum.</th>
                                      <th className="px-4 py-2">F. financ.</th>
                                      <th className="px-4 py-2">Reg. sanitario</th>
                                      <th className="px-4 py-2 text-right">Saldo</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {fila.lotes.map((lote, indice) => (
                                      <tr
                                        key={`${lote.lote}-${indice}`}
                                        className="border-t border-white/5 text-slate-400"
                                      >
                                        <td className="px-4 py-2 font-mono font-bold text-slate-200">
                                          {lote.lote || "—"}
                                        </td>
                                        <td className="px-4 py-2">{lote.vencimiento || "—"}</td>
                                        <td className="px-4 py-2">{lote.tipoSuministro || "—"}</td>
                                        <td className="px-4 py-2">
                                          {lote.fuenteFinanciamiento || "—"}
                                        </td>
                                        <td className="px-4 py-2 font-mono">
                                          {lote.registroSanitario || "—"}
                                        </td>
                                        <td className="px-4 py-2 text-right font-black text-slate-200">
                                          {formatearCantidad(lote.saldo)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-white/5 px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600 sm:px-10">
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="h-3 w-3" />
            Consolidado por establecimiento
          </span>
          <span className="inline-flex items-center gap-1.5">
            {hayConsulta ? (
              <>
                <Package className="h-3 w-3" />
                Pulse una fila para ver sus lotes
              </>
            ) : (
              <>
                <CornerDownLeft className="h-3 w-3" />
                Flechas para elegir · Intro para consultar
              </>
            )}
          </span>
        </div>
      </section>
    </div>,
    document.body,
  );
};
