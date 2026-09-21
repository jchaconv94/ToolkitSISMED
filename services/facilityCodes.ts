/**
 * Códigos de establecimiento y de farmacia de SISMED.
 *
 * Un mismo establecimiento aparece escrito de formas distintas según de dónde venga el
 * dato, y hasta ahora cada sitio lo interpretaba a su manera. Aquí está la regla única.
 *
 * ## Cómo se compone un ALMCOD
 *
 * SISMED numera las farmacias de una IPRESS: `F01` es la farmacia principal —que a efectos
 * prácticos **es** la IPRESS— y de `F02` en adelante son puestos comunales, que en esta
 * aplicación se registran como establecimientos propios. Al ALMCOD se le añade además un
 * `01` final por defecto, salvo cuando el Toolkit de escritorio envía con «Consolidar
 * farmacias» marcado, que funde todo en la principal.
 *
 * ```
 *   06528F0101   IPRESS 06528, farmacia principal      -> el establecimiento es 06528
 *   06528F0201   IPRESS 06528, puesto comunal F02      -> el establecimiento es 06528F02
 *   06528F01     lo mismo, enviado consolidado         -> el establecimiento es 06528
 *   06528F02     así se registra un puesto comunal     -> el establecimiento es 06528F02
 *   06528        así se registra una IPRESS
 *   030S0501     ALMCOD de un almacén                  -> el establecimiento es 030S05
 *   030S05       así se registra un almacén
 * ```
 *
 * Las IPRESS llevan cinco dígitos y los almacenes seis caracteres. Esa diferencia es lo que
 * permite distinguirlos, y por eso el orden en que se prueban los patrones importa:
 * `06528F01` encajaría también en el de almacén (seis caracteres y dos dígitos).
 *
 * Lo que no encaja en ninguno queda como `desconocido`, a propósito: es mejor que se note a
 * que se empareje con el establecimiento equivocado.
 */

export type FacilityCodeKind = "ipress" | "puesto-comunal" | "almacen" | "desconocido";

export interface ParsedFacilityCode {
  kind: FacilityCodeKind;
  /** Código de la IPRESS (cinco dígitos). Vacío en almacenes y en lo desconocido. */
  ipressCode: string;
  /** Código completo de la farmacia (`06528F02`). Vacío si el dato no la menciona. */
  pharmacyCode: string;
  /**
   * Establecimiento registrado al que pertenece este código: la IPRESS cuando es su
   * farmacia principal, el puesto comunal de `F02` en adelante, y el almacén en su caso.
   */
  facilityCode: string;
}

const DESCONOCIDO: ParsedFacilityCode = {
  kind: "desconocido",
  ipressCode: "",
  pharmacyCode: "",
  facilityCode: "",
};

/** ALMCOD detallado de una IPRESS: cinco dígitos, farmacia y el `01` que añade SISMED. */
const ALMCOD_IPRESS = /^(\d{5})F(\d{2})\d{2}$/i;
/** Código de farmacia: el del envío consolidado y el que se registra para un puesto comunal. */
const FARMACIA = /^(\d{5})F(\d{2})$/i;
/** IPRESS a secas. */
const IPRESS = /^(\d{5})$/;
/** ALMCOD de un almacén: seis caracteres y el `01` final. */
const ALMCOD_ALMACEN = /^([0-9A-Z]{6})\d{2}$/i;
/** Almacén a secas. */
const ALMACEN = /^([0-9A-Z]{6})$/i;

const deFarmacia = (ipress: string, farmacia: string): ParsedFacilityCode => {
  const pharmacyCode = `${ipress}F${farmacia}`;
  // `F01` es la farmacia principal, que no es un establecimiento aparte: es la propia IPRESS.
  const esPrincipal = farmacia === "01";
  return {
    kind: esPrincipal ? "ipress" : "puesto-comunal",
    ipressCode: ipress,
    pharmacyCode,
    facilityCode: esPrincipal ? ipress : pharmacyCode,
  };
};

/** Interpreta un código de establecimiento o un ALMCOD. */
export const parseFacilityCode = (raw?: string | null): ParsedFacilityCode => {
  const code = String(raw || "").trim().toUpperCase();
  if (!code) return DESCONOCIDO;

  const almcodIpress = code.match(ALMCOD_IPRESS);
  if (almcodIpress) return deFarmacia(almcodIpress[1], almcodIpress[2]);

  const farmacia = code.match(FARMACIA);
  if (farmacia) return deFarmacia(farmacia[1], farmacia[2]);

  const ipress = code.match(IPRESS);
  if (ipress) {
    return { kind: "ipress", ipressCode: ipress[1], pharmacyCode: "", facilityCode: ipress[1] };
  }

  const almcodAlmacen = code.match(ALMCOD_ALMACEN);
  if (almcodAlmacen) {
    return { kind: "almacen", ipressCode: "", pharmacyCode: "", facilityCode: almcodAlmacen[1] };
  }

  const almacen = code.match(ALMACEN);
  if (almacen) {
    return { kind: "almacen", ipressCode: "", pharmacyCode: "", facilityCode: almacen[1] };
  }

  return DESCONOCIDO;
};

/**
 * Establecimiento registrado al que pertenece un código. Es lo que se compara para
 * emparejar una pestaña, o una fila de stock, con la tabla de establecimientos.
 */
export const facilityCodeOf = (raw?: string | null): string => parseFacilityCode(raw).facilityCode;

/**
 * Código que identifica la hoja en la que vive ese stock: el de la IPRESS, porque todas sus
 * farmacias comparten pestaña, y el del almacén cuando lo es.
 *
 * La tarjeta de Consulta Stock usa este: el ALMCOD de la primera fila puede ser el de un
 * puesto comunal, y mostrar `06528F02` donde debe ir `06528` sería confuso.
 */
export const sheetOwnerCodeOf = (raw?: string | null): string => {
  const parsed = parseFacilityCode(raw);
  return parsed.ipressCode || parsed.facilityCode;
};

/**
 * Tipos de establecimiento que se pueden registrar.
 *
 * Vivían escritos a mano en dos desplegables de `AdminOrganizationModule`, así que agregar
 * uno significaba acordarse de los dos sitios. La lista está aquí, junto a la regla de
 * códigos, porque el código de un establecimiento y su tipo dicen lo mismo: los que llevan
 * `F02` en adelante son puestos comunales.
 *
 * `PUESTO_COMUNAL` se agregó el 2026-09-21. Antes esos establecimientos se registraban como
 * `PUESTO` y se marcaban a mano con la categoría `P.C.`, que era un apaño para poder
 * localizarlos después; ver `supabase/SUPABASE_MIGRACION_TIPO_PUESTO_COMUNAL.sql`.
 */
export const FACILITY_TYPES = [
  { value: "HOSPITAL", label: "HOSPITAL" },
  { value: "CENTRO", label: "CENTRO DE SALUD" },
  { value: "PUESTO", label: "PUESTO DE SALUD" },
  { value: "PUESTO_COMUNAL", label: "PUESTO COMUNAL" },
  { value: "ALM", label: "ALMACÉN" },
] as const;

/** Etiqueta de un tipo. Los registros antiguos pueden traer un valor que ya no está. */
export const facilityTypeLabel = (type?: string | null): string => {
  const valor = String(type || "").trim().toUpperCase();
  if (!valor) return "";
  return FACILITY_TYPES.find((t) => t.value === valor)?.label || valor;
};

/**
 * Tipo que le corresponde a un código, cuando el propio código lo dice.
 *
 * Solo se pronuncia sobre lo que es inequívoco: `06528F02` es un puesto comunal y `030S05`
 * un almacén. Un código de IPRESS a secas no distingue entre hospital, centro y puesto de
 * salud, así que devuelve `""` y decide quien registra.
 */
export const suggestedFacilityType = (code?: string | null): string => {
  const { kind } = parseFacilityCode(code);
  if (kind === "puesto-comunal") return "PUESTO_COMUNAL";
  if (kind === "almacen") return "ALM";
  return "";
};
