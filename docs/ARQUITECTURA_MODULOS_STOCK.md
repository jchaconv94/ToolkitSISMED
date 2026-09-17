# Arquitectura de módulos de Stock SISMED

## Regla principal

`Consulta Stock` y `Monitoreo de Stock` son módulos independientes. No son dos vistas de la misma fuente de datos y no deben usarse como fallback entre sí.

## Consulta Stock (`SIG_SEARCH`)

Componente principal: `components/SheetSearchModule.tsx`.

Flujo de inventario:

```text
Toolkit-OGM → Google Sheets → Google Apps Script → Consulta Stock → IndexedDB
```

- La fuente de medicamentos, lotes, saldos, vencimientos y fechas de actualización es Google Sheets.
- Apps Script expone `getMetadata` y lectura selectiva por hojas.
- IndexedDB es solo caché del navegador para acelerar aperturas posteriores.
- No se escribe el inventario de este módulo en `stock_actual` ni en un historial de sincronización de Supabase.
- Supabase puede seguir almacenando configuración de usuarios, permisos, jurisdicción y URLs; eso no lo convierte en fuente del stock de este módulo.

## Monitoreo de Stock (`STOCK_MONITORING`)

Componente principal: `components/IpressStockModule.tsx`.

Flujo de inventario:

```text
Toolkit-OGM / Sync SISMED 2.0 → Supabase `stock_actual` → Monitoreo de Stock
```

- Su fuente de stock es Supabase.
- No debe consultar Google Sheets como fallback de inventario.
- Su historial, dispositivos y lógica de sincronización pertenecen a este flujo 2.0.

## Prohibición de cruce

Antes de modificar cualquiera de estos módulos, verificar la fuente de datos correspondiente. Una mejora en `Consulta Stock` no debe cambiar `IpressStockModule`, y una mejora de Sync SISMED 2.0 no debe hacer que `SheetSearchModule` consulte `stock_actual`.
