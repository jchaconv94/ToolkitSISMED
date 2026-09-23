import React, { useMemo, useState } from "react";
import { AlertTriangle, Building2, Check, Download, FileSpreadsheet, Layers, Pill, Search, X } from "lucide-react";
import type { SheetExportMode } from "./SheetExportMenu";
import { suggestProducts, type StockProduct } from "../services/stockNetworkSearch";

export type StockExportEstablishment = {
  id: string;
  code: string;
  name: string;
  tipo: "CS" | "PS" | "ALM" | "HOSP" | "OTRO";
  /** Solo en la exportación regional, para distinguir establecimientos de varias UNGET. */
  ungetName?: string;
  /** Punto de color y texto del estado de actualización, los mismos de las tarjetas. */
  estadoColor: string;
  estadoLabel: string;
  actualizado: boolean;
  puestosComunales: number;
};

export type StockExportRequest = {
  ids: string[];
  modo: SheetExportMode;
  soloVencimientos: boolean;
  /** Claves de los productos elegidos; vacío = todos. */
  productos: string[];
};

type Filtro = "todos" | "CS" | "PS" | "ALM" | "HOSP" | "actualizados" | "puestos";

const FILTROS: { key: Filtro; label: string; test: (e: StockExportEstablishment) => boolean }[] = [
  { key: "todos", label: "Todos", test: () => true },
  { key: "CS", label: "C.S.", test: (e) => e.tipo === "CS" },
  { key: "PS", label: "P.S.", test: (e) => e.tipo === "PS" },
  { key: "ALM", label: "Almacén", test: (e) => e.tipo === "ALM" },
  { key: "HOSP", label: "Hospital", test: (e) => e.tipo === "HOSP" },
  { key: "actualizados", label: "Actualizados", test: (e) => e.actualizado },
  { key: "puestos", label: "Con puestos comunales", test: (e) => e.puestosComunales > 0 },
];

const normalizar = (texto: string) =>
  texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const detallePuestos = (n: number) =>
  `Farmacia + ${n} puesto${n === 1 ? "" : "s"} comunal${n === 1 ? "" : "es"}`;

const Interruptor: React.FC<{
  activo: boolean;
  onChange: (valor: boolean) => void;
  icono: React.ReactNode;
  titulo: string;
  detalle: string;
}> = ({ activo, onChange, icono, titulo, detalle }) => (
  <button
    type="button"
    role="switch"
    aria-checked={activo}
    onClick={() => onChange(!activo)}
    className="w-full flex items-center justify-between gap-3 p-3 rounded-2xl border border-slate-200 bg-white text-left cursor-pointer hover:border-slate-300"
  >
    <span className="flex items-center gap-2.5 min-w-0">
      {icono}
      <span className="min-w-0">
        <span className="block text-[12.5px] font-bold text-slate-800">{titulo}</span>
        <span className="block text-[11px] text-slate-500">{detalle}</span>
      </span>
    </span>
    <span className={`w-9 h-5 rounded-full relative shrink-0 transition-colors ${activo ? "bg-teal-600" : "bg-slate-200"}`}>
      <span
        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${activo ? "left-[18px]" : "left-0.5"}`}
      />
    </span>
  </button>
);

/**
 * Exportación del stock de varios establecimientos a un solo Excel.
 *
 * A la izquierda se eligen los establecimientos uno por uno (los botones de arriba solo
 * filtran la lista; «Todos» y «Ninguno» marcan o desmarcan lo que se ve). A la derecha,
 * el formato y el contenido.
 */
export const StockExportModal: React.FC<{
  titulo: string;
  establecimientos: StockExportEstablishment[];
  /** Catálogo de productos del ámbito, para el buscador de productos. */
  productos: StockProduct[];
  seleccionInicial: string[];
  soloVencimientosInicial?: boolean;
  onClose: () => void;
  onExport: (pedido: StockExportRequest) => void;
}> = ({ titulo, establecimientos, productos, seleccionInicial, soloVencimientosInicial = false, onClose, onExport }) => {
  const [elegidos, setElegidos] = useState<Set<string>>(() => new Set(seleccionInicial));
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [busqueda, setBusqueda] = useState("");
  const [modo, setModo] = useState<SheetExportMode>("consolidado");
  const [soloVencimientos, setSoloVencimientos] = useState(soloVencimientosInicial);
  const [productosElegidos, setProductosElegidos] = useState<StockProduct[]>([]);
  const [busquedaProducto, setBusquedaProducto] = useState("");
  const sugerencias = useMemo(
    () =>
      suggestProducts(productos, busquedaProducto, 12).filter(
        (p) => !productosElegidos.some((e) => e.key === p.key),
      ),
    [productos, busquedaProducto, productosElegidos],
  );
  const elegirProducto = (producto: StockProduct) => {
    setProductosElegidos((prev) => [...prev, producto]);
    setBusquedaProducto("");
  };

  const filtrosDisponibles = useMemo(
    () => FILTROS.filter((f) => f.key === "todos" || establecimientos.some(f.test)),
    [establecimientos],
  );

  const visibles = useMemo(() => {
    const prueba = FILTROS.find((f) => f.key === filtro)?.test ?? (() => true);
    const termino = normalizar(busqueda.trim());
    return establecimientos.filter(
      (e) =>
        prueba(e) &&
        (!termino ||
          normalizar(e.name).includes(termino) ||
          normalizar(e.code).includes(termino) ||
          normalizar(e.ungetName || "").includes(termino)),
    );
  }, [establecimientos, filtro, busqueda]);

  const elegidosEnLista = establecimientos.filter((e) => elegidos.has(e.id));
  const conPuestosElegidos = elegidosEnLista.filter((e) => e.puestosComunales > 0).length;

  const alternar = (id: string) =>
    setElegidos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const marcarVisibles = (marcar: boolean) =>
    setElegidos((prev) => {
      const next = new Set(prev);
      for (const e of visibles) {
        if (marcar) next.add(e.id);
        else next.delete(e.id);
      }
      return next;
    });

  return (
    <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/45 backdrop-blur-xs animate-in fade-in duration-200 p-4">
      <div className="absolute inset-0" onClick={onClose} />

      <div className="relative w-full max-w-5xl max-h-[92vh] bg-slate-50 rounded-3xl shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col border border-slate-200 overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 bg-teal-50 rounded-xl flex items-center justify-center text-teal-600 border border-teal-100 shrink-0">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h3 className="font-black text-slate-900 text-[15px] tracking-tight">Exportar stock a Excel</h3>
              <p className="text-xs text-slate-500 font-medium truncate">{titulo}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="p-2 hover:bg-slate-100 rounded-xl transition-all text-slate-400 hover:text-slate-900 border border-slate-100 bg-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto md:overflow-hidden grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_340px]">
          {/* Establecimientos */}
          <div className="p-5 sm:p-6 md:border-r border-slate-200 flex flex-col md:min-h-0">
            <div className="flex items-center justify-between mb-2.5">
              <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-wider">Establecimientos</h4>
              <span className="text-[11px] font-bold text-slate-500">
                {elegidosEnLista.length} de {establecimientos.length} elegidos
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {filtrosDisponibles.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFiltro(f.key)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors cursor-pointer ${
                    filtro === f.key
                      ? "bg-teal-600 text-white border-teal-600"
                      : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="border border-slate-200 rounded-2xl bg-white overflow-hidden flex flex-col md:min-h-0 md:flex-1">
              <div className="p-2 border-b border-slate-100 flex items-center gap-2 shrink-0">
                <div className="flex-1 min-w-0 flex items-center gap-2 h-9 px-3 rounded-xl bg-slate-50 border border-slate-200 focus-within:border-teal-500">
                  <Search className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                  <input
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    placeholder="Buscar nombre o código"
                    className="flex-1 min-w-0 bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => marcarVisibles(true)}
                  className="text-[11px] font-bold text-teal-700 hover:underline px-1 shrink-0 cursor-pointer"
                >
                  Todos
                </button>
                <span className="text-slate-300 select-none">|</span>
                <button
                  type="button"
                  onClick={() => marcarVisibles(false)}
                  className="text-[11px] font-bold text-slate-500 hover:underline px-1 shrink-0 cursor-pointer"
                >
                  Ninguno
                </button>
              </div>

              <div className="overflow-y-auto divide-y divide-slate-100 max-h-[45vh] md:max-h-none md:flex-1 scrollbar-thin">
                {visibles.length === 0 ? (
                  <p className="px-4 py-8 text-center text-xs text-slate-400">Ningún establecimiento coincide.</p>
                ) : (
                  visibles.map((e) => {
                    const elegido = elegidos.has(e.id);
                    return (
                      <label
                        key={e.id}
                        className={`flex items-center gap-3 px-3.5 py-2.5 cursor-pointer select-none hover:bg-slate-50 transition-colors ${
                          elegido ? "" : "opacity-60"
                        }`}
                      >
                        <input type="checkbox" checked={elegido} onChange={() => alternar(e.id)} className="sr-only" />
                        <span
                          className={`w-4 h-4 rounded-md border flex items-center justify-center shrink-0 ${
                            elegido ? "bg-teal-600 border-teal-600 text-white" : "border-slate-300 bg-white"
                          }`}
                        >
                          {elegido && <Check className="h-3 w-3 stroke-[3]" />}
                        </span>
                        <span className="font-mono text-[11px] font-bold text-teal-700 bg-teal-50 border border-teal-100 rounded-md px-1.5 py-0.5 w-16 text-center shrink-0">
                          {e.code || "—"}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-[13px] font-bold text-slate-800 truncate">{e.name}</span>
                          {(e.puestosComunales > 0 || e.ungetName) && (
                            <span className="block text-[10.5px] font-semibold truncate">
                              {e.puestosComunales > 0 && (
                                <span className="text-violet-600">{detallePuestos(e.puestosComunales)}</span>
                              )}
                              {e.puestosComunales > 0 && e.ungetName && <span className="text-slate-300"> · </span>}
                              {e.ungetName && <span className="text-slate-400">{e.ungetName}</span>}
                            </span>
                          )}
                        </span>
                        <span className="hidden sm:flex items-center gap-1.5 text-[11px] text-slate-500 font-semibold w-28 shrink-0">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${e.estadoColor}`} />
                          <span className="truncate">{e.estadoLabel}</span>
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Opciones */}
          <div className="p-5 sm:p-6 space-y-6 md:overflow-y-auto">
            <div>
              <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-wider mb-2.5">Formato</h4>
              <div className="space-y-2.5">
                {(
                  [
                    { key: "consolidado", titulo: "Consolidado", detalle: "Sumar el stock de todas las farmacias", Icono: Layers },
                    { key: "detallado", titulo: "Por farmacia", detalle: "Stock de cada farmacia", Icono: Building2 },
                  ] as const
                ).map(({ key, titulo: t, detalle, Icono }) => {
                  const activo = modo === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setModo(key)}
                      className={`w-full flex items-center gap-3 p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                        activo ? "border-teal-500 bg-teal-50/40 ring-2 ring-teal-100" : "border-slate-200 bg-white hover:border-slate-300"
                      }`}
                    >
                      <span
                        className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                          activo ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        <Icono className="w-4 h-4" />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[12px] font-black uppercase tracking-wide text-slate-800">{t}</span>
                        <span className="block text-[11px] text-slate-500">{detalle}</span>
                      </span>
                      <span
                        className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                          activo ? "border-teal-600" : "border-slate-300"
                        }`}
                      >
                        {activo && <span className="w-2 h-2 rounded-full bg-teal-600" />}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
                {conPuestosElegidos > 0 ? (
                  <>
                    Hay <b>{conPuestosElegidos} establecimiento{conPuestosElegidos === 1 ? "" : "s"} con puestos comunales</b> entre
                    los elegidos.
                  </>
                ) : (
                  "Ninguno de los elegidos tiene puestos comunales."
                )}{" "}
                En consolidado, todos salen con su código de 5 dígitos.
              </p>
            </div>

            <div>
              <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-wider mb-2.5">Contenido</h4>
              <div className="space-y-2.5">
                <Interruptor
                  activo={soloVencimientos}
                  onChange={setSoloVencimientos}
                  icono={<AlertTriangle className={`h-4 w-4 shrink-0 ${soloVencimientos ? "text-red-500" : "text-amber-500"}`} />}
                  titulo="Solo productos vencidos o por vencer"
                  detalle="Si está apagado, se exporta todo el stock"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2.5">
                <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-wider">Productos</h4>
                {productosElegidos.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setProductosElegidos([])}
                    className="text-[11px] font-bold text-slate-500 hover:underline cursor-pointer"
                  >
                    Quitar todos
                  </button>
                )}
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                <div className="p-2">
                  <div className="flex items-center gap-2 h-9 px-3 rounded-xl bg-slate-50 border border-slate-200 focus-within:border-teal-500">
                    <Search className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <input
                      value={busquedaProducto}
                      onChange={(e) => setBusquedaProducto(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && sugerencias[0]) {
                          e.preventDefault();
                          elegirProducto(sugerencias[0]);
                        }
                      }}
                      placeholder="Buscar medicamento o código"
                      className="flex-1 min-w-0 bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400"
                    />
                  </div>
                </div>

                {busquedaProducto.trim() && (
                  <div className="border-t border-slate-100 max-h-48 overflow-y-auto divide-y divide-slate-100 scrollbar-thin">
                    {sugerencias.length === 0 ? (
                      <p className="px-3 py-3 text-[11px] text-slate-400">Ningún producto coincide.</p>
                    ) : (
                      sugerencias.map((p) => (
                        <button
                          key={p.key}
                          type="button"
                          onClick={() => elegirProducto(p)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-teal-50/50 cursor-pointer"
                        >
                          <span className="font-mono text-[10px] font-bold text-teal-700 bg-teal-50 border border-teal-100 rounded px-1 py-0.5 shrink-0">
                            {p.codigoSismed || "—"}
                          </span>
                          <span className="text-[11.5px] font-semibold text-slate-700 line-clamp-2">{p.producto}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}

                {productosElegidos.length > 0 && (
                  <div className="border-t border-slate-100 p-2 flex flex-wrap gap-1.5">
                    {productosElegidos.map((p) => (
                      <span
                        key={p.key}
                        className="inline-flex items-center gap-1 max-w-full pl-2 pr-1 py-1 rounded-lg bg-teal-50 border border-teal-100 text-[11px] font-semibold text-teal-900"
                      >
                        <Pill className="h-3 w-3 shrink-0 text-teal-600" />
                        <span className="truncate" title={p.producto}>{p.producto}</span>
                        <button
                          type="button"
                          aria-label={`Quitar ${p.producto}`}
                          onClick={() => setProductosElegidos((prev) => prev.filter((e) => e.key !== p.key))}
                          className="p-0.5 rounded hover:bg-teal-100 text-teal-700 shrink-0 cursor-pointer"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <p className="text-[11px] text-slate-500 mt-2">
                {productosElegidos.length === 0
                  ? "Sin elegir ninguno, se exportan todos los productos."
                  : `Solo se exportan ${productosElegidos.length === 1 ? "este producto" : `estos ${productosElegidos.length} productos`}.`}
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 bg-white flex items-center justify-between gap-4 shrink-0">
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Se exportarán</p>
            <p className="text-sm font-black text-slate-800">
              {elegidosEnLista.length} de {establecimientos.length}
              <span className="hidden sm:inline"> establecimientos</span>
            </p>
          </div>
          <button
            type="button"
            disabled={elegidosEnLista.length === 0}
            onClick={() =>
              onExport({
                ids: elegidosEnLista.map((e) => e.id),
                modo,
                soloVencimientos,
                productos: productosElegidos.map((p) => p.key),
              })
            }
            className="flex items-center gap-2 px-5 py-3 rounded-xl font-black text-xs uppercase tracking-wider whitespace-nowrap shrink-0 transition-all cursor-pointer bg-teal-600 hover:bg-teal-700 text-white disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
          >
            <Download className="h-4 w-4" />
            Exportar Excel
          </button>
        </div>
      </div>
    </div>
  );
};
