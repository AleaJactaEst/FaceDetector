import { defineConfig } from 'vite';
import legacy from '@vitejs/plugin-legacy';

export default defineConfig({
    // This section allows the browser to access the /dist folder
    // while you are running 'npm run dev'
    plugins: [
        legacy({
            // Targeted specifically for your requirements
            targets: ['chrome >= 61', 'edge >= 18', 'firefox >= 60', 'safari >= 13'],
            // Essential polyfills for face-api.js and modern async logic
            polyfills: [
                'es.promise',
                'es.promise.finally',
                'es.array.from',
                'es.object.assign',
                'es.array.includes',
                'es.string.includes',
                'es.symbol',
                'web.dom-collections.for-each'
            ],
            modernPolyfills: true
        }),
    ],
    server: {
        fs: {
            allow: ['.']
        }
    },
    build: {
        target: 'es2015', // Critical: ensure code is transpiled to ES6 for Edge 18

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