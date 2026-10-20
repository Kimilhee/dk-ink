import { resolve } from "node:path";
import { defineConfig } from "vite-plus";

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? "/",
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        algorithm: resolve(import.meta.dirname, "algorithm.html"),
      },
    },
  },
});
