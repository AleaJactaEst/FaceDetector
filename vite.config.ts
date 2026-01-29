import { defineConfig } from 'vite';

export default defineConfig({
    // This section allows the browser to access the /dist folder
    // while you are running 'npm run dev'
    server: {
        fs: {
            allow: ['.']
        }
    },
    build: {
        lib: {
            entry: 'src/main.ts',
            name: 'FaceValidationWC', // global variable name for IIFE
            formats: ['iife'],
            fileName: () => 'face-validation.iife.js',
        },
        rollupOptions: {
            // DO NOT externalize face-api.js for IIFE to ensure it's plug-and-play
            external: [],
        },
        emptyOutDir: true,
    },
});