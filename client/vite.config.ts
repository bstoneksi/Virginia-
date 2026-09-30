import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

// Client lives in ./client, shared types in ../shared. Built output goes to client/dist,
// which the Hono server serves as static files in production.
export default defineConfig({
  root: here,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(here, "src"),
      "@shared": path.resolve(here, "../shared"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/mcp": "http://localhost:3000",
    },
  },
  build: {
    outDir: path.resolve(here, "dist"),
    emptyOutDir: true,
  },
});
