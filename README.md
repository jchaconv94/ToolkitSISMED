# ToolKit SISMED Web

Aplicación web interna de la **DIRESA San Martín (Perú)** para logística de salud. Cubre el dominio de **Farmacia / SISMED**: análisis de requerimiento, consulta de stock, redistribución, claves de envío, backups SISMED y administración.

El módulo de Inmunizaciones se retiró el 2026-10-03: se está reconstruyendo como un sistema aparte.

React 19 + Vite 6 + TypeScript, con Supabase como backend.

## Puesta en marcha

```bash
npm install
```

Copia `.env.example` a `.env` y completa las dos variables del proyecto de Supabase:

```
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=TU_CLAVE_ANON
```

```bash
npm run dev
```

La aplicación queda en `http://127.0.0.1:3000/ToolkitSISMED/` — la ruta base importa, está fijada en `vite.config.ts`.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run lint` | `tsc --noEmit`. No hay ESLint: esta es la única verificación estática |
| `npm test` | `vitest run` |
| `npm run build` | `tsc && vite build` |

## Estructura

| Carpeta | Contenido |
|---|---|
| `components/` | Un archivo por módulo. `components/ui/` es el kit compartido |
| `services/` | Acceso a datos, reglas de dominio y generación de PDF/Excel |
| `docs/` | Toda la documentación: auditorías, planes y notas técnicas |
| `supabase/` | Scripts `.sql` que se ejecutan a mano en el panel de Supabase |

## Si vas a trabajar en el código

**Lee [AGENTS.md](AGENTS.md) primero.** Explica la arquitectura, el modelo de seguridad, las reglas de las conexiones de stock, qué componentes y utilidades ya existen para reutilizar, y las trampas que este proyecto ya pagó una vez.

## Despliegue

El sitio se publica a la rama `gh-pages` con el `dist` compilado:

```bash
npm run build
```

```bash
npx gh-pages -d dist -r https://github.com/jchaconv94/ToolkitSISMED.git
```
