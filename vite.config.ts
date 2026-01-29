import { defineConfig } from 'vite';

export default defineConfig({
    build: {
        lib: {
            entry: 'src/main.ts',
            name: 'FaceValidationWC', // global variable name
            formats: ['iife'],
            fileName: () => 'face-validation.iife.js',
        },
        rollupOptions: {
            // DO NOT externalize face-api.js for IIFE
            external: [],
        },
        emptyOutDir: true,
    },
});
