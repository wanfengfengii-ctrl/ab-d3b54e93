import { defineConfig } from 'vite';

// 静态资源使用相对路径，便于在任意子路径/容器内托管。
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  test: {
    include: ['src/**/*.test.js'],
  },
});
