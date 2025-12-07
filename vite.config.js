import { defineConfig } from 'vite';

export default defineConfig({
  root: './www', // Le decimos que tus archivos fuente están en www
  build: {
    outDir: '../dist', // Vite construirá la app optimizada en una carpeta dist fuera de www
    minify: false, // Útil para depurar si hay errores
    emptyOutDir: true,
  },
});
