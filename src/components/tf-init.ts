// tf-init.ts
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-webgl';

let initPromise: Promise<void> | null = null;

export function initTf(): Promise<void> {
    if (!initPromise) {
        initPromise = (async () => {
            await tf.setBackend('webgl');
            await tf.ready();
        })();
    }
    return initPromise;
}
