import * as faceapi from "face-api.js";

export default class FaceFrameService {
    static calculateFaceFit(box: faceapi.Box, canvas: HTMLCanvasElement): number {
        const oval = this.getOvalMetrics(canvas);
        if (!oval) return 0;

        // Calculate face center
        const faceCenterX = box.x + box.width / 2;
        const faceCenterY = box.y + box.height / 2;

        // Check distance from center (normalized 0 to 1)
        const distDelta = Math.sqrt(
            Math.pow((faceCenterX - oval.centerX) / oval.radiusX, 2) +
            Math.pow((faceCenterY - oval.centerY) / oval.radiusY, 2)
        );

        // Check if the size is correct (face width should be ~80-90% of oval width)
        const expectedWidth = oval.radiusX * 2;
        const sizeAccuracy = 1 - Math.abs(1 - (box.width / expectedWidth));

        // Combined score: 1.0 is a perfect fit
        const combinedScore = (1 - Math.min(distDelta, 1)) * sizeAccuracy;
        return Math.max(0, combinedScore);
    }

    static drawOvalGuide(canvas: HTMLCanvasElement | null | undefined) {
        const ctx = canvas?.getContext('2d')!;
        if (canvas && ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Draw semi-transparent dark overlay
            ctx.fillStyle = 'rgba(255, 255, 255, 1)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            const ovalMetrics = this.getOvalMetrics(canvas);
            if (ovalMetrics) {
                const { centerX, centerY, radiusX, radiusY } = ovalMetrics;
                ctx.globalCompositeOperation = 'destination-out';
                ctx.beginPath();
                ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI);
                ctx.fill();

                // Reset for face-api drawing
                ctx.globalCompositeOperation = 'source-over';
            }
        }
    }

    static getOvalMetrics(canvas: HTMLCanvasElement) {
        return {
            centerX: canvas.width / 2,
            centerY: (canvas.height / 2) + 25,
            radiusX: canvas.width * 0.20,
            radiusY: (canvas.height * 0.45) - 12.5
        };
    }
}