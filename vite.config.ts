
import { copyFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fillServiceWorker, precacheEntries } from './services/precacheManifest';

/**
 * Copia `index.html` como `404.html` al compilar.
 *
 * GitHub Pages es un servidor de archivos estaticos: no sabe nada de las rutas de la
 * aplicacion, asi que responde 404 a direcciones como `/administracion/usuarios`. Al
 * dejar una copia en `404.html`, ese 404 sirve igualmente la aplicacion, que lee la
 * direccion y abre el modulo correcto. Es la solucion habitual para publicar una SPA
 * en un hosting estatico.
 */
const spaFallback = (outDir: string): Plugin => ({
  name: 'spa-fallback-404',
  apply: 'build',
  closeBundle() {
    const index = resolve(outDir, 'index.html');
    if (existsSync(index)) copyFileSync(index, resolve(outDir, '404.html'));
  }
});

/**
 * Modo sin internet (2026-10-08): escribe en `dist/sw.js` la lista de todos los archivos del
 * build y una versión única, para que el service worker los guarde al instalarse y la app abra
 * sin internet. La versión empieza con la fecha (el service worker borra las copias viejas por
 * orden) y sigue con un resumen del contenido: si nada cambió, el navegador no reinstala.
 */
const offlinePrecache = (outDir: string): Plugin => ({
  name: 'offline-precache',
  apply: 'build',
  closeBundle() {
    const root = resolve(outDir);
    const swPath = join(root, 'sw.js');
    if (!existsSync(swPath)) throw new Error('Falta dist/sw.js: la app no funcionaría sin internet.');
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        return statSync(full).isDirectory() ? walk(full) : [relative(root, full)];
      });
    const entries = precacheEntries(walk(root));
    const hash = createHash('sha256');
    for (const entry of entries) hash.update(entry).update(readFileSync(join(root, entry)));
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    const version = `${stamp}-${hash.digest('hex').slice(0, 10)}`;
    writeFileSync(swPath, fillServiceWorker(readFileSync(swPath, 'utf8'), version, entries));
  }
});

const devBaseRedirect = (basePath: string): Plugin => ({
  name: 'dev-base-redirect',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url === '/' || req.url === '') {
        res.writeHead(302, { Location: basePath });
        res.end();
        return;
      }
      next();
    });
  }
});

export default defineConfig({
  plugins: [react(), spaFallback('dist'), offlinePrecache('dist'), devBaseRedirect('/ToolkitSISMED/')],
  // IMPORTANTE: Esto debe coincidir con el nombre de tu repositorio en GitHub
  base: '/ToolkitSISMED/', 
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Eliminamos 'minify: terser' para usar el predeterminado (esbuild) y evitar errores si no tienes terser instalado
  },
  server: {
    port: 3000,
  }
});
