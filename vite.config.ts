import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        fs: {
            allow: ['.']
        }
    },
    build: {
        // 1. Target ES2015 to ensure modern syntax (like classes and arrow functions)
        // is transpiled down to a level Edge 18 and Safari 13 understand.
        target: 'es2015',

        lib: {
            entry: 'src/main.ts',
            name: 'FaceValidationWC',
            // Build as an IIFE bundle so there are no ES module
            // `export` statements in the final output.
            formats: ['iife'],
            fileName: () => 'face-validation.iife.js',
        },

        // 2. Use Terser instead of Esbuild for minification.
        // Terser is much more reliable for generating code for older browsers
        // like Safari 13, which has specific "Safari 10 loop" bugs.
        minify: 'terser',
        terserOptions: {
            ecma: 2015,
            safari10: true, // Fixes specific bugs in older Safari engines
            compress: {
                drop_console: false, // Keep consoles for your debugging
            }
        },

        rollupOptions: {
            external: [],
            output: {
                // Ensures the IIFE bundle is self-contained
                inlineDynamicImports: true,
            }
        },

        // 3. Prevent CSS from being extracted into a separate .css file
        // so that your 'import styles from "./styles.css?inline"' works perfectly.
        cssCodeSplit: false,
        emptyOutDir: true,
    },
});
