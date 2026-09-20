/** @type {import('tailwindcss').Config} */
export default {
  // Archivos donde buscar clases. Todo lo que no aparezca aquí se elimina del CSS final,
  // así que un directorio nuevo con componentes hay que añadirlo.
  content: [
    "./index.html",
    "./App.tsx",
    "./index.tsx",
    "./components/**/*.{ts,tsx}",
    "./contexts/**/*.{ts,tsx}",
    "./hooks/**/*.{ts,tsx}",
    "./services/**/*.{ts,tsx}",
  ],

  // `AnalysisTable.tsx` arma su alineación como `text-${align}`. El compilador no puede
  // verla, así que sin esto las cabeceras de esa tabla perderían la alineación.
  safelist: ["text-left", "text-center", "text-right"],

  // Sin personalizar: hasta ahora la aplicación usaba el CDN con la configuración por
  // defecto, y el objetivo de este cambio es que se vea exactamente igual. Los colores y
  // tipografías propios, si se quieren, van en un paso aparte y revisable.
  theme: {
    extend: {},
  },
  plugins: [],
};
