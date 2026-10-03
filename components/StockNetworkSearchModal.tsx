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
  /**
   * Con qué se abre: un producto ya elegido en las sugerencias del buscador de la lista, o
   * lo escrito allí para buscarlo tal cual. Sin ellos se abre vacío.
   */
  initialProduct?: StockProduct | null;
  initialQuery?: string;
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
  initialProduct = null,
  initialQuery = "",
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

  // Al abrirse desde el buscador de la lista llega ya con lo buscado.
  useEffect(() => {
    if (!isOpen) return;
    if (initialProduct) {
      setElegido(initialProduct);
      setTerm(initialProduct.producto || initialProduct.codigoSismed);
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
      className="fixed inset-0 z-[1250000] flex items-start justify-center bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200 sm:p-8"
      onMouseDown={(evento) => {
        if (evento.target === evento.currentTarget) onClose();
      }}
    >
      {/* Estilo claro del sistema (2026-10-03): cabecera fija con el buscador, resultados con
          su propio desplazamiento y pie fijo. En el celular ocupa toda la pantalla. */}
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Buscar producto en ${ungetName}`}
        className="relative flex h-[100dvh] w-full max-w-5xl flex-col overflow-hidden bg-white shadow-2xl animate-in slide-in-from-bottom-4 duration-200 sm:h-auto sm:max-h-[88vh] sm:rounded-2xl sm:border sm:border-slate-200"
      >
        {/* Cabecera: dónde se busca, el campo y la cobertura. */}
        <div className="shrink-0 border-b border-slate-100 px-4 pb-4 pt-4 sm:px-6 sm:pt-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-[15px] font-black text-slate-900 sm:text-base">Buscar un medicamento</h2>
              <p className="truncate text-xs text-slate-500">En todos los establecimientos de {ungetName}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="-mr-1.5 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              ref={campoRef}
              type="text"
              value={term}
              onChange={(evento) => alEscribir(evento.target.value)}
              onKeyDown={alPulsarTecla}
              placeholder="Nombre del producto o código SISMED…"
              autoComplete="off"
              spellCheck={false}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-10 text-sm font-semibold text-slate-800 outline-none transition-all placeholder:font-medium placeholder:text-slate-400 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10"
            />
            {escribiendo && (
              <button
                type="button"
                onClick={limpiar}
                aria-label="Limpiar"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {(elegido || faltanHojas) && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
              {/* El producto que se está consultando, para que no se pierda de vista cuál es. */}
              {elegido && (
                <>
                  <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 font-bold text-teal-800">
                    <Package className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{elegido.producto || elegido.key}</span>
                    {elegido.codigoSismed && <span className="font-mono text-teal-600">{elegido.codigoSismed}</span>}
                  </span>
                  <button type="button" onClick={limpiar} className="font-bold text-slate-500 hover:text-teal-700">
                    Buscar otro
                  </button>
                </>
              )}
              {/* Cobertura: nunca hacer creer que se vio todo cuando faltan hojas. */}
              {faltanHojas && (
                <span className="inline-flex flex-wrap items-center gap-2 font-semibold text-amber-700 sm:ml-auto">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {sheetsLoaded} de {sheetsTotal} establecimientos consultados
                  {onCompleteSearch && (
                    <button
                      type="button"
                      onClick={onCompleteSearch}
                      disabled={isCompleting}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 font-bold text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-60"
                    >
                      {isCompleting && <Loader2 className="h-3 w-3 animate-spin" />}
                      {isCompleting ? "Descargando…" : "Completar búsqueda"}
                    </button>
                  )}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Resultados */}
        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60">
          {!hayConsulta ? (
            !escribiendo ? (
              <div className="px-6 py-16 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-teal-50 text-teal-600">
                  <Search className="h-6 w-6" />
                </div>
                <p className="text-sm text-slate-500">Escriba un producto o un código SISMED y elíjalo de la lista.</p>
              </div>
            ) : sugerencias.length === 0 ? (
              <p className="px-6 py-16 text-center text-sm text-slate-500">
                Ningún producto de {ungetName} responde a{" "}
                <span className="font-bold text-slate-800">{term}</span>
                {faltanHojas ? ", en los establecimientos consultados." : "."}
              </p>
            ) : (
              /* Sugerencias: se elige el producto y solo entonces se consulta la red. */
              <ul className="space-y-1 p-3 sm:p-4">
                {sugerencias.map((producto, indice) => (
                  <li key={producto.key}>
                    <button
                      type="button"
                      onClick={() => elegir(producto)}
                      onMouseEnter={() => setResaltada(indice)}
                      className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                        indice === resaltada ? "border-teal-200 bg-teal-50" : "border-transparent bg-white hover:border-slate-200"
                      }`}
                    >
                      <Package className={`h-4 w-4 shrink-0 ${indice === resaltada ? "text-teal-600" : "text-slate-400"}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-slate-800">
                          {producto.producto || producto.key}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-slate-500">
                          {producto.codigoSismed && <span className="font-mono">{producto.codigoSismed} · </span>}
                          {producto.establecimientos} establecimiento{producto.establecimientos === 1 ? "" : "s"}
                          {` · ${formatearCantidad(producto.total)} en total`}
                        </span>
                      </span>
                      {indice === resaltada && <CornerDownLeft className="hidden h-3.5 w-3.5 shrink-0 text-teal-600 sm:block" />}
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : resultados.length === 0 ? (
            <p className="px-6 py-16 text-center text-sm text-slate-500">
              Sin coincidencias para <span className="font-bold text-slate-800">{term}</span>
              {faltanHojas ? " en los establecimientos consultados." : "."}
            </p>
          ) : (
            <div className="p-3 sm:p-4">
              {/* Resumen del resultado */}
              <div className="mb-3 grid grid-cols-3 gap-2">
                {[
                  { label: "Establecimientos", short: "Estab.", value: countPharmaciesInResults(resultados) },
                  { label: "Unidades en total", short: "Unidades", value: formatearCantidad(totalUnidades) },
                  { label: "Resultados", short: "Resultados", value: resultados.length },
                ].map((dato) => (
                  <div key={dato.label} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <p className="truncate text-[10px] font-black uppercase tracking-wide text-slate-400"><span className="sm:hidden">{dato.short}</span><span className="hidden sm:inline">{dato.label}</span></p>
                    <p className="text-lg font-black text-slate-900">{dato.value}</p>
                  </div>
                ))}
              </div>

              <ul className="space-y-2">
                {resultados.map((fila) => {
                  const etiqueta = describePharmacyCode(fila.almcod, facilities);
                  const abierta = expandida === fila.id;
                  return (
                    <li key={fila.id} className={`overflow-hidden rounded-xl border bg-white ${abierta ? "border-teal-300" : "border-slate-200"}`}>
                      <button
                        type="button"
                        onClick={() => setExpandida(abierta ? null : fila.id)}
                        aria-expanded={abierta}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
                      >
                        <ChevronRight className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${abierta ? "rotate-90 text-teal-600" : ""}`} />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-x-2">
                            {/* Sin nombre se dice por qué: un guion no distingue «no lo
                                encontré» de «no está dado de alta en Establecimientos». */}
                            {etiqueta.name ? (
                              <span className="text-[14px] font-bold text-slate-900">{etiqueta.name}</span>
                            ) : (
                              <span className="text-[14px] font-semibold italic text-slate-500">Sin registrar</span>
                            )}
                            {etiqueta.unregistered && (
                              <span className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                                Puesto sin registrar
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-slate-500">
                            <span className="font-mono font-bold text-teal-700">{etiqueta.code}</span>
                            {` · ${fila.producto}`}
                            {fila.lotes.length > 1 && ` · ${fila.lotes.length} lotes`}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-lg font-black text-slate-900">{formatearCantidad(fila.total)}</span>
                          <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-400">saldo</span>
                        </span>
                      </button>

                      {abierta && (
                        <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3">
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
                              {fila.lotes.map((lote, indice) => (
                                <tr key={`${lote.lote}-${indice}`} className="border-t border-slate-200/70 text-slate-600">
                                  <td className="py-2 pr-3 font-mono font-bold text-slate-800">{lote.lote || "—"}</td>
                                  <td className="py-2 pr-3">{lote.vencimiento || "—"}</td>
                                  <td className="py-2 pr-3">{lote.tipoSuministro || "—"}</td>
                                  <td className="py-2 pr-3">{lote.fuenteFinanciamiento || "—"}</td>
                                  <td className="py-2 pr-3 font-mono">{lote.registroSanitario || "—"}</td>
                                  <td className="py-2 text-right font-black text-slate-800">{formatearCantidad(lote.saldo)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {/* Celular: un renglón por lote. */}
                          <ul className="space-y-2 sm:hidden">
                            {fila.lotes.map((lote, indice) => (
                              <li key={`${lote.lote}-${indice}`} className="flex items-center justify-between gap-3 text-xs">
                                <span className="min-w-0">
                                  <span className="block font-mono font-bold text-slate-800">Lote {lote.lote || "—"}</span>
                                  <span className="block text-slate-500">Vence {lote.vencimiento || "—"}</span>
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
            </div>
          )}
        </div>

        <div className="hidden shrink-0 items-center justify-between gap-3 border-t border-slate-100 px-6 py-2.5 text-[11px] font-semibold text-slate-400 sm:flex">
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" />
            Consolidado por establecimiento
          </span>
          <span className="inline-flex items-center gap-1.5">
            {hayConsulta ? (
              <>
                <Package className="h-3.5 w-3.5" />
                Pulse un establecimiento para ver sus lotes
              </>
            ) : (
              <>
                <CornerDownLeft className="h-3.5 w-3.5" />
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
