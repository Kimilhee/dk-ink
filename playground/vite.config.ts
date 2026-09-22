import { defineConfig } from "vite-plus";

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? "/",
});
