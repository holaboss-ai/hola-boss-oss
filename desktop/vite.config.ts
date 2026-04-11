import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  base: "./",
  plugins: [tailwindcss(), react()],
  build: {
    outDir: "out/dist",
    emptyOutDir: true,
    sourcemap: "hidden"
  },
  define: {
    "process.env.SENTRY_DSN": JSON.stringify(process.env.SENTRY_DSN ?? "")
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src")
    }
  },
  server: {
    port: 5173,
    strictPort: true
  }
});
