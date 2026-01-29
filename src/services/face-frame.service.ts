export default class FaceFrameService {

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