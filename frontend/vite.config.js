import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    assetsDir: "",
    emptyOutDir: true,
  },
  base: "/assets/",
});
