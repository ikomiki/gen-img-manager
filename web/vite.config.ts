import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5181,
    // スマホの実機から dev server を直接見られるようにする。
    host: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5180",
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
