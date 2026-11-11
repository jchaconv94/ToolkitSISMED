# IME en la web: Informe de Movimiento Económico de farmacia

Documento de trabajo. Empezó el 2026-11-11, pedido del usuario: «implementar el IME en la web, para registrar las ventas de farmacia mediante el T6». Reemplaza las hojas **IME** e **IME-CONSULTAR** del libro **INFOSISMED v4.1** (ver `docs/ICI_SISMED.md` §1). **Léelo antes de tocar el IME.**

Los datos del libro (informes guardados, T6, guías) no se copian al repositorio: son de los establecimientos.

---

## 1. Qué hace hoy el libro INFOSISMED

Analizado el 2026-10-18 sobre el libro que pasó el usuario (el archivo ya no está en el entorno del agente: para construir el formulario y la impresión hay que pedirlo de nuevo).

- **Qué es:** «Informe de Movimiento Económico» de la farmacia del establecimiento («Centros y puestos de salud»); la impresión es el **Anexo N° 06**.
- **Dos pantallas:** IME (registro) e IME-CONSULTAR (consulta, impresión y PDF: A4 vertical, tres firmas: jefe del establecimiento, responsable de farmacia y V°B° de economía).
- **Secciones del formulario:** cabecera (código, mes, año) · boletas (serie, del, al) · venta · recetas emitidas y dispensadas por componente · saldo del 90 % (compra de medicamentos) y del 10 % (gastos) · reembolsos SIS e intervención sanitaria · fondos que entrega la DISA · **depósitos T6** (fecha, N° de T6, importe; hasta 25) · abastecimiento (guías) · bienes y servicios del 10 % · regularización de depósitos (hasta 6 meses) y deuda (venta no depositada).
- **Casos:** «No venta» (pone boletas y recetas en 0 y pide el T6 a regularizar), «No depósito» (la venta del mes pasa a deuda), el hospital (06502) sin recetas dispensadas de SIS e intervención.
- **Cálculos:** «Venta» = suma de los T6; saldo 90 % = anterior + 90 % de la venta; saldo 10 % = anterior + 10 % de la venta; reembolso SIS pendiente = anterior + consumo valorado − abastecimiento.
- **Base:** hojas ocultas `DATOS_IME` (28 columnas), `DATOS_T6`, `DATOS_ABASTECIMIENTO`, `DATOS BIENES Y SERVICIOS`, `PORCONCEPTO DE SIS-INTERVENSION`; clave texto código + mes + año (`06512MAYO2026`). Guardaba 1 635 informes de 35 establecimientos de la Red Bellavista (mayo 2022 a mayo 2026), 2 289 T6 y 3 749 guías.

### Lo que no se debe repetir

- Los saldos del 90 % y del 10 % **solo subían**: nunca se restaban las compras ni los gastos.
- «Eliminar» borraba lo último registrado de **cualquier** establecimiento, no el que se veía, y dejaba T6 y guías huérfanos. No había «editar».
- El año salía de la fecha de hoy y el mes anterior de `TEXT(...,"MMMM")` (idioma de Windows).
- Los saldos se guardaban como valores: corregir un mes no corregía los siguientes. Sin mes anterior, el saldo pasaba a 0 sin aviso.
- `Val()` cortaba los decimales con coma («12,50» → 12).
- Contraseñas escritas en el código y protección que no protegía nada; valores fijos (red «BELLAVISTA», 06502, 25 filas).

---

## 2. Decisiones del usuario (2026-11-11)

| Tema | Decisión |
|---|---|
| Quién registra | **El responsable de farmacia** registra el IME de su establecimiento. |
| Quién revisa | **Solo el responsable de su UNGET.** La DIRESA **no** lo ve. |
| Venta | Se registran los **depósitos T6** y la web los **compara con la venta valorizada del mes del SISMED** (TFORMDET, VENTA × PRECIO): si se depositó menos, sale la deuda. |
| Saldos 90 % / 10 % | **Bajan** con lo comprado (abastecimiento) y lo gastado (bienes y servicios): saldo = anterior + porcentaje de la venta − compras o gastos del mes. |
| Historial del libro | **Todavía no.** El usuario dirá desde qué mes se importa: aún le falta llenar octubre 2026 en el libro, que fue el último mes. |

---

## 3. Pendiente para empezar

1. **El formato:** el libro INFOSISMED v4.1 (hojas IME e IME-CONSULTAR / Anexo N° 06) o un IME de un mes ya llenado, para que el formulario y la impresión sean los mismos.
2. **De dónde sale la venta del SISMED** del mes en la web: que el responsable suba su TFORMDET del mes (como en Disponibilidad) o que el Toolkit de escritorio la envíe sola.
3. **Desde qué mes** se importa el historial del libro (decisión del usuario, más adelante). Hasta entonces, el primer IME de cada establecimiento necesita su saldo inicial.
4. Al construirlo: tablas nuevas en Supabase con su política de sesión (AGENTS.md §5: una tabla nueva sin política queda abierta a internet), acción por rol en `services/moduleActions.ts` y los cinco lugares de un módulo nuevo (AGENTS.md §4).
