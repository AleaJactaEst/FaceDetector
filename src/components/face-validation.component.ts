import * as faceapi from 'face-api.js';
import { FACE_VALIDATION_TEMPLATE } from './face-validation.template.ts';
import { FaceDetection } from 'face-api.js';
import type { Phase } from '../interfaces/interfaces.ts';
import { FAR_THRESHOLD_MULTIPLIER, NO_FACE_DETECTED_BACKLASH, FRAMES_TO_CAPTURE, FRAMES_FAR_DISTANCE, FRAMES_CLOSE_DISTANCE, INITIAL_DISTANCE_THRESHOLD, CLOSE_DISTANCE_PROGRESS_THRESHOLD } from '../constants/constants.ts';
import FaceFrameService from '../services/face-frame.service.ts';
import { verifyCapturedFrames } from '../api.ts';
import faceValidationStyles from './face-validation.css?inline';

if (typeof window.CustomEvent !== "function") {
    function CustomEvent(event: string, params: any) {
        params = params || { bubbles: false, cancelable: false, detail: null };
        var evt = document.createEvent('CustomEvent');
        evt.initCustomEvent(event, params.bubbles, params.cancelable, params.detail);
        return evt;
    }
    (window as any).CustomEvent = CustomEvent;
}

if (!window.AbortController) {
    (window as any).AbortController = class AbortController {
        signal = { aborted: false, addEventListener: () => {} };
        abort() { this.signal.aborted = true; }
    };
}

class FaceValidationComponent extends HTMLElement {
    private capturedFrames: string[];
    private farDistanceFrames: string[];
    private closeDistanceFrames: string[];
    private phase: Phase;
    private noFaceDetectedInRow;
    private firstRatio;
    private _isRunning;
    // @ts-ignore
    private _token;
    private _modelUrl;
    private _displayText: Record<string, string>;
    private _isFinal;
    private _onAnalysisComplete: string | null;
    private _onError: string | null;
    private _onUserCancel: string | null;

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });

        this.capturedFrames = [];
        this.farDistanceFrames = [];
        this.closeDistanceFrames = [];
        this.phase = 'WAITING';
        this.noFaceDetectedInRow = 0;
        this.firstRatio = 0;
        this._isRunning = false;
            // @ts-ignore
        this._token = '';
        this._modelUrl = '';
        this._displayText = {};
        this._isFinal = false;
        this._onAnalysisComplete = null;
        this._onError = null;
        this._onUserCancel = null;
    }

    async connectedCallback() {
        const shadow = this.shadowRoot!;

        // Check for modern CSS support (Chrome/Firefox)
        const supportsAdopted =
            'adoptedStyleSheets' in Document.prototype &&
            'replaceSync' in CSSStyleSheet.prototype;

        if (supportsAdopted) {
            const sheet = new CSSStyleSheet();
            sheet.replaceSync(faceValidationStyles);
            shadow.adoptedStyleSheets = [sheet];
            shadow.innerHTML = FACE_VALIDATION_TEMPLATE;
        } else {
            // Fallback for Safari 13 / Edge 18
            // We inject the <style> tag directly into the innerHTML
            shadow.innerHTML = `
            <style>${faceValidationStyles}</style>
            ${FACE_VALIDATION_TEMPLATE}
        `;
        }

        // Update accessibility label
        this.updateAccessibilityLabel();

        if (this._modelUrl) await this.init();

        const cancelBtn = this.shadowRoot?.querySelector<HTMLButtonElement>('#cancel-button');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => this.handleUserCancel());
        }

        const tryAgainBtn = this.shadowRoot?.querySelector<HTMLButtonElement>('#result-try-again-button');
        if (tryAgainBtn) {
            tryAgainBtn.addEventListener('click', () => this.handleTryAgain());
        }

        // Check orientation on load and resize
        this.checkOrientation();
        window.addEventListener('resize', () => this.checkOrientation());
        window.addEventListener('orientationchange', () => this.checkOrientation());
    }

    disconnectedCallback() {
        window.removeEventListener('resize', this.checkOrientation);
        window.removeEventListener('orientationchange', this.checkOrientation);
        this.stopExistingStream();
    }

    /**
     * Call a function specified in an attribute (e.g., on-analysis-complete="myFunction")
     * The function is looked up in the global window scope
     */
    private callAttributeFunction(functionName: string | null, ...args: any[]) {
        if (!functionName) return;

        try {
            // Look up function in window scope
            const func = (window as any)[functionName];
            if (typeof func === 'function') {
                func(...args);
            } else {
                console.warn(`Function "${functionName}" not found or is not a function`);
            }
        } catch (error) {
            console.error(`Error calling function "${functionName}":`, error);
        }
    }

    static get observedAttributes() {
        // Align with AWS FaceLivenessDetector-style API: sessionId + displayText
        // - session-id: alias for token
        // - token: can still be used directly
        // - model-url: where face-api model is hosted
        // - display-text: JSON with all translated labels from parent
        // - on-analysis-complete: function name to call when analysis completes
        // - on-error: function name to call when error occurs
        // - on-user-cancel: function name to call when user cancels
        return ['token', 'session-id', 'model-url', 'display-text', 'on-analysis-complete', 'on-error', 'on-user-cancel'];
    }

    async attributeChangedCallback (name: string, _: string, newValue: string) {
        if (name === 'token') {
            this._token = newValue;
            // eslint-disable-next-line no-console
        }

        if (name === 'session-id') {
            // Mirror AWS FaceLivenessDetector: sessionId becomes our token
            this._token = newValue;
        }

        if (name === 'model-url') {
            this._modelUrl = newValue;
            // eslint-disable-next-line no-console
            if (this.shadowRoot?.innerHTML) await this.init();
        }

        if (name === 'display-text') {
            // All UI text must be provided by the parent (for translations).
            // We intentionally do NOT define any internal defaults here.
            this._displayText = JSON.parse(newValue);
            // Update accessibility label when display text changes
            this.updateAccessibilityLabel();
        }

        if (name === 'on-analysis-complete') {
            this._onAnalysisComplete = newValue || null;
        }

        if (name === 'on-error') {
            this._onError = newValue || null;
        }

        if (name === 'on-user-cancel') {
            this._onUserCancel = newValue || null;
        }
    }

    async init() {
        // checks if https is used
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            let errorKey;

            const isSecure = window.isSecureContext ||
                window.location.protocol === 'https:' ||
                window.location.hostname === 'localhost';

            if (!isSecure) {
                console.error("Face-WC: Camera access requires a Secure Context (HTTPS).");
                errorKey = 'insecureContextText'; // Add this to translations: "Camera requires HTTPS"
            } else {
                console.error("Face-WC: mediaDevices API not supported in this browser.");
                errorKey = 'browserNotSupportedText';
            }

            this.setError(errorKey);
            return;
        }

        if (this._isRunning) return;

        const isModelAvailable = await this.loadModels();
        if (!isModelAvailable) return;

        const cameraStarted = await this.startCamera();
        if (!cameraStarted) return;

        this._isRunning = true;
        this.detectFaces();
    }

    public startVerifying() {
        this._isRunning = false;
        this.setVerifying(true);
        this.updateStatus('hintVerifyingText');
    }

    public stopVerifying() {
        this.setVerifying(false);
        if (!this._isRunning) {
            this._isRunning = true;
            this.detectFaces();
        }
        this.updateStatus('hintCanNotIdentifyText');
    }

    async loadModels() {
        try {
            await faceapi.nets.tinyFaceDetector.loadFromUri(this._modelUrl);
            this.setError();
            return true;
        } catch (err) {
            console.error("Model loading failed:", err);
            this.setError("serverHeaderText");
            return false;
        }
    }

    async startCamera() {
        this.stopExistingStream();

        const video = this.shadowRoot?.querySelector('video');
        if (!video) return;

        // Show camera permission overlay
        this.setCameraPermissionOverlay(true);

        try {
            video.srcObject = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: "user",
                    width: { ideal: 640, min: 320 },
                    height: { ideal: 480, min: 240 },
                    frameRate: { ideal: 15, max: 30 }
                }
            });

            return await new Promise((resolve) => {
                video.onloadedmetadata = async () => {
                    try {
                        await video.play();
                        this.setCameraPermissionOverlay(false);
                        this.setError();
                        resolve(true);
                    } catch (playError) {
                        console.error("Autoplay blocked:", playError);
                        // This happens on iOS if Low Power Mode is on or
                        // if the browser requires a touch to start video.
                        this.setCameraPermissionOverlay(false);
                        this.showManualPlayButton(video, resolve);
                    }
                };
            });
        } catch (err: any) {
            console.log(err)
            this.setCameraPermissionOverlay(false);

            // Specific error handling for better UX
            if (err.name === 'NotAllowedError') {
                this.setError('cameraPermissionDeniedText', true); // Add this key to your translations
            } else {
                console.error("Camera access error:", err);
                this.setError('cameraNotFoundHeadingText', true);
            }
            return false;
        }
    }

    private stopExistingStream() {
        const video = this.shadowRoot?.querySelector('video');
        if (video && video.srcObject instanceof MediaStream) {
            video.srcObject.getTracks().forEach(track => {
                track.stop();
                console.log(`Stopped track: ${track.label}`);
            });
            video.srcObject = null;
        }
    }

    async detectFaces() {
        const video = this.shadowRoot?.querySelector('video') as HTMLVideoElement;
        const options = new faceapi.TinyFaceDetectorOptions();

        const loop = async () => {
            if (!this._isRunning) return;

            this.adjustCanvasDimension();
            // Draw oval guide in MOVE_FORWARD phase for visual guidance (not used for validation)
            if (this.phase === 'MOVE_FORWARD') {
                this.drawOvalGuide();
            } else {
                // Clear canvas when not in MOVE_FORWARD phase
                const canvas = this.shadowRoot?.querySelector('canvas');
                if (canvas) {
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                    }
                }
            }

            try {
                // Detect all faces to check for multiple faces
                const detections = await faceapi.detectAllFaces(video, options);

                if (detections.length === 0) {
                    this.handleNoDetection();
                } else if (detections.length > 1) {
                    // Multiple faces detected
                    this.updateStatus('hintTooManyFacesText');
                    this.noFaceDetectedInRow = 0;
                } else {
                    // Single face detected
                    this.noFaceDetectedInRow = 0;
                    this.handleLivenessWorkflow(detections[0], video);
                }
            } catch (e) {
                console.error("Detection error:", e);
            }

            setTimeout(() => requestAnimationFrame(loop), 100);
        };

        requestAnimationFrame(loop);
    }

    handleLivenessWorkflow(detection: FaceDetection, video: HTMLVideoElement) {
        const canvas = this.shadowRoot?.querySelector('canvas');
        if (canvas) {
            const faceArea = detection.box.width * detection.box.height;
            const videoArea = video.videoWidth * video.videoHeight;
            const ratio = faceArea / videoArea;

            switch (this.phase) {
                case 'WAITING':
                    // Initial detection: determine if user is close or far enough
                    if (!this.firstRatio) {
                        this.firstRatio = ratio;
                    }

                    // If user is close (ratio is high), ask them to move back
                    if (ratio > this.firstRatio * INITIAL_DISTANCE_THRESHOLD) {
                        this.setPhase('MOVE_BACK');
                    } else {
                        // User is already far enough, capture far frames and move to forward phase
                        if (this.farDistanceFrames.length < FRAMES_FAR_DISTANCE) {
                            this.captureFrame('far');
                        } else {
                            this.setPhase('MOVE_FORWARD');
                        }
                    }
                    break;

                case 'MOVE_BACK':
                    // User is too close, ask them to move back
                    this.updateStatus('hintTooCloseText');

                    // Update progress bar
                    this.setDistanceProgression(ratio);

                    // Check if user has moved far enough (ratio decreased to threshold)
                    const isFarEnough = ratio <= this.firstRatio * FAR_THRESHOLD_MULTIPLIER && ratio < CLOSE_DISTANCE_PROGRESS_THRESHOLD;

                    if (isFarEnough) {
                        // Capture far frames
                        if (this.farDistanceFrames.length < FRAMES_FAR_DISTANCE) {
                            this.captureFrame('far');
                        } else {
                            // Once we have 5 far frames, move to forward phase
                            this.setPhase('MOVE_FORWARD');
                        }
                    }

                    break;

                case 'MOVE_FORWARD':
                    // User should move closer to camera
                    this.updateStatus('hintMoveFaceFrontOfCameraText');

                    // Update progress based on distance (closer = higher progress)
                    // Progress increases as ratio increases (face gets bigger = closer)
                    const rawCloseProgress = ((ratio * 100) / CLOSE_DISTANCE_PROGRESS_THRESHOLD) * 100;
                    const closeProgress = Math.min(Math.max(rawCloseProgress, 0), 100);
                    this.setCloseDistanceProgression(closeProgress);

                    // Capture close frames only when user is close enough
                    const isCloseEnough = (ratio * 100) >= CLOSE_DISTANCE_PROGRESS_THRESHOLD;

                    if (isCloseEnough) {
                        this.captureFrame('close');
                    }

                    // Finish when we have 5 far + 5 close frames
                    // (we only ever add close frames when close enough, so no need to re-check here)
                    if (this.farDistanceFrames.length >= FRAMES_FAR_DISTANCE &&
                        this.closeDistanceFrames.length >= FRAMES_CLOSE_DISTANCE) {
                        this.finishVerification();
                    }

                    break;
            }
        }
    }

    updateStatus(msgKey: string) {
        const el = this.shadowRoot?.querySelector<HTMLElement>('#instruction-text');
        if (!el) return;

        const text = this._displayText[msgKey];
        if (text && text.trim().length > 0) {
            el.textContent = text;
            el.style.display = 'inline-flex';
        } else {
            el.style.display = 'none';
        }
    }

    async finishVerification() {
        // Combine frames: 5 from far distance + 5 from close distance
        const farFrames = this.farDistanceFrames.slice(0, FRAMES_FAR_DISTANCE);
        const closeFrames = this.closeDistanceFrames.slice(0, FRAMES_CLOSE_DISTANCE);
        const framesToSend = [...farFrames, ...closeFrames];

        // Safety: fall back to legacy behavior if something went wrong with phase buckets
        if (framesToSend.length < FRAMES_TO_CAPTURE) {
            const allFrames = [...this.capturedFrames];
            const legacyFrames =
                allFrames.length > FRAMES_TO_CAPTURE ? allFrames.slice(0, FRAMES_TO_CAPTURE) : allFrames;
            if (legacyFrames.length === FRAMES_TO_CAPTURE) {
                // eslint-disable-next-line no-console
                console.warn('Falling back to legacy framesToSend due to missing phase frames');
                framesToSend.splice(0, framesToSend.length, ...legacyFrames);
            }
        }

        // Ensure we have at least some frames to send
        if (framesToSend.length === 0) {
            console.warn('No frames captured, cannot verify');
            return;
        }

        // Start "verifying" state: hide camera, show loader
        this.startVerifying();

        try {
            // TODO: externalize initial /verify call (token creation) to host app and
            // accept verification_token / main_server_url as inputs, similar to AWS FaceLivenessDetector.
            const result = await verifyCapturedFrames(framesToSend);

            // Stop detection loop
            this._isRunning = false;

            // High-level event equivalent to FaceLivenessDetector's onAnalysisComplete
            this.dispatchEvent(new CustomEvent('analysis-complete', {
                detail: result,
                bubbles: true,
                composed: true,
            }));

            // Call function if specified in attribute
            this.callAttributeFunction(this._onAnalysisComplete, result);

            // Show result screen
            this.showResult(result);

            // Once analysis is complete, mark component as "final" so cancel button can be ignored/hidden if desired
            this._isFinal = true;
        } catch (error: any) {
            // Stop detection loop
            this._isRunning = false;

            // High-level event equivalent to FaceLivenessDetector's onError
            const errorDetail = {
                message: error?.message ?? 'Unknown error',
                raw: error,
            };
            this.dispatchEvent(new CustomEvent('error', {
                detail: errorDetail,
                bubbles: true,
                composed: true,
            }));

            // Call function if specified in attribute
            this.callAttributeFunction(this._onError, errorDetail);

            // Show error result screen
            this.showResult({
                isReal: false,
                estimatedAge: null,
                validationError: error?.message ?? 'Unknown error',
                raw: error,
            });
        }
    }

    private handleUserCancel() {
        if (this._isFinal) {
            return;
        }

        // Stop detection loop and reset internal state
        this._isRunning = false;
        this.capturedFrames = [];
        this.farDistanceFrames = [];
        this.closeDistanceFrames = [];
        this.firstRatio = 0;
        this.noFaceDetectedInRow = 0;
        this.setVerifying(false);
        this.setPhase('WAITING');

        // Dispatch high-level event equivalent to FaceLivenessDetector's onUserCancel
        this.dispatchEvent(new CustomEvent('user-cancel', {
            bubbles: true,
            composed: true,
        }));

        // Call function if specified in attribute
        this.callAttributeFunction(this._onUserCancel);
    }

    private showResult(result: { isReal: boolean; estimatedAge: number | null; validationError?: string; raw?: unknown }) {
        const shadow = this.shadowRoot;
        if (!shadow) return;

        // Hide camera and other UI elements
        const video = shadow.querySelector<HTMLVideoElement>('video');
        const canvas = shadow.querySelector<HTMLCanvasElement>('canvas');
        const infoBox = shadow.querySelector<HTMLElement>('#info-box');
        const verifyingOverlay = shadow.querySelector<HTMLElement>('#verifying-overlay');
        const cancelButtonWrapper = shadow.querySelector<HTMLElement>('#cancel-button-wrapper');
        const resultOverlay = shadow.querySelector<HTMLElement>('#result-overlay');

        if (video) video.style.display = 'none';
        if (canvas) canvas.style.display = 'none';
        if (infoBox) infoBox.style.display = 'none';
        if (verifyingOverlay) verifyingOverlay.style.display = 'none';
        if (cancelButtonWrapper) cancelButtonWrapper.style.display = 'none';

        if (!resultOverlay) return;

        const resultIcon = shadow.querySelector<HTMLElement>('#result-icon');
        const resultTitle = shadow.querySelector<HTMLElement>('#result-title');
        const resultMessage = shadow.querySelector<HTMLElement>('#result-message');
        const tryAgainButton = shadow.querySelector<HTMLButtonElement>('#result-try-again-button');

        const isSuccess = result.isReal && !result.validationError;
        const tryAgainText = this._displayText['tryAgainText'] || 'Try Again';

        if (resultIcon) {
            resultIcon.className = isSuccess ? 'success' : 'failure';
            resultIcon.textContent = isSuccess ? '✓' : '✗';
        }

        if (resultTitle) {
            if (result.validationError) {
                resultTitle.textContent = this._displayText['timeoutHeaderText'] || 'Verification Failed';
            } else if (isSuccess) {
                resultTitle.textContent = this._displayText['hintCheckCompleteText'] || 'Verification Complete';
            } else {
                resultTitle.textContent = this._displayText['errorLabelText'] || 'Verification Failed';
            }
        }

        if (resultMessage) {
            if (result.validationError) {
                resultMessage.textContent = result.validationError;
            } else if (isSuccess) {
                const ageText = result.estimatedAge
                    ? ` Estimated age: ~${Math.round(result.estimatedAge)}.`
                    : '';
                resultMessage.textContent = `Liveness verified successfully.${ageText}`;
            } else {
                const ageText = result.estimatedAge
                    ? ` Estimated age: ~${Math.round(result.estimatedAge)}.`
                    : '';
                resultMessage.textContent = `Verification failed (possible spoofing detected).${ageText}`;
            }
        }

        if (tryAgainButton) {
            tryAgainButton.textContent = tryAgainText;
        }

        resultOverlay.style.display = 'flex';
    }

    private handleTryAgain() {
        // Hide result overlay
        const resultOverlay = this.shadowRoot?.querySelector<HTMLElement>('#result-overlay');
        if (resultOverlay) resultOverlay.style.display = 'none';

        // Show cancel button again
        const cancelButtonWrapper = this.shadowRoot?.querySelector<HTMLElement>('#cancel-button-wrapper');
        if (cancelButtonWrapper) cancelButtonWrapper.style.display = 'block';

        // Reset all state
        this._isFinal = false;
        this._isRunning = false;
        this.capturedFrames = [];
        this.farDistanceFrames = [];
        this.closeDistanceFrames = [];
        this.firstRatio = 0;
        this.noFaceDetectedInRow = 0;
        this.phase = 'WAITING';

        // Restart the flow
        this.setVerifying(false);
        this.setPhase('WAITING');
        this.init();
    }

    private captureFrame(type: 'far' | 'close' = 'close') {
        const video = this.shadowRoot?.querySelector('video');
        if (video) {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = video.videoWidth;
            tempCanvas.height = video.videoHeight;
            const tempCtx = tempCanvas.getContext('2d');

            if (tempCtx) {
                tempCtx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);

                const imageData = tempCanvas.toDataURL('image/jpeg', 0.9);

                if (type === 'far') {
                    this.farDistanceFrames.push(imageData);
                } else {
                    this.closeDistanceFrames.push(imageData);
                }
                // Keep backward compatibility
                this.capturedFrames.push(imageData);
            }
        }
    }

    private adjustCanvasDimension() {
        const video = this.shadowRoot?.querySelector('video');
        const canvas = this.shadowRoot?.querySelector('canvas');

        if (canvas && video && video.videoWidth > 0) {
            if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
            }
        }
    }

    private drawOvalGuide() {
        const canvas = this.shadowRoot?.querySelector('canvas');
        FaceFrameService.drawOvalGuide(canvas);
    }

    private showManualPlayButton(video: HTMLVideoElement, resolve: (v: boolean) => void) {
        const errorWrapper = this.shadowRoot?.querySelector('#error-wrapper') as HTMLElement;
        if (!errorWrapper) return;

        this._isRunning = false;
        errorWrapper.style.display = 'flex';

        // Use a translation for "Click to start camera"
        const startText = this._displayText['startCameraText'] || 'Tap to Start Camera';

        errorWrapper.innerHTML = `
        <div class="error-content">
            <button id="manual-start-button" type="button">${startText}</button>
        </div>
    `;

        errorWrapper.querySelector('#manual-start-button')?.addEventListener('click', async () => {
            try {
                await video.play();
                errorWrapper.style.display = 'none';
                this.setError(); // Clear UI
                this._isRunning = true;
                this.detectFaces(); // Restart loop
                resolve(true);
            } catch (e) {
                console.error("Manual play failed", e);
            }
        }, { once: true });
    }

    private setPhase(phase: Phase) {
        this.phase = phase;

        const recordingSign = this.shadowRoot?.querySelector('#recording-sign') as HTMLDivElement;
        if (recordingSign) recordingSign.style.display = 'none';

        const fitPercentage = this.shadowRoot?.querySelector('#fit-percentage') as HTMLDivElement;
        const fitPercentageFill = this.shadowRoot?.querySelector('#fit-percentage-fill') as HTMLElement;

        if (fitPercentage) fitPercentage.style.display = 'none';
        if (fitPercentageFill) fitPercentageFill.style.width = '0%';


        switch (this.phase) {
            case 'MOVE_BACK':
                // Reset far distance frames when starting MOVE_BACK phase
                this.farDistanceFrames = [];
                break;
            case 'MOVE_FORWARD':
                recordingSign.style.display = 'flex';
                if (fitPercentage) fitPercentage.style.display = 'block';
                // Reset close distance frames when starting MOVE_FORWARD phase
                this.closeDistanceFrames = [];
                this.capturedFrames = [];
                break;
            default:
                break;

        }
    }

    /**
     * Close distance progression indicates how close the user has moved to the camera.
     * Progress increases as ratio increases (face gets bigger = closer).
     */
    private setCloseDistanceProgression(progress: number) {
        const progressFill = this.shadowRoot?.querySelector('#fit-percentage-fill') as HTMLElement;
        if (!progressFill) return;

        const finalPercentage = Math.min(Math.max(progress, 0), 100);
        progressFill.style.width = `${finalPercentage}%`;
    }

    /**
     * Distance progression indicates how far the user has moved away from the camera.
     * It is based on the face-to-video area ratio measured in the MOVE_BACK phase.
     * - At the initial ratio (very close), the bar is near 0.
     * - When the ratio reaches firstRatio * FAR_THRESHOLD_MULTIPLIER, the bar is near 100.
     */
    private setDistanceProgression(currentRatio: number) {
        const progressFill = this.shadowRoot?.querySelector('#fit-percentage-fill') as HTMLElement;
        if (!progressFill || !this.firstRatio) return;

        const targetRatio = this.firstRatio * FAR_THRESHOLD_MULTIPLIER;
        const range = Math.max(this.firstRatio - targetRatio, 0.0001);

        const rawResult = ((this.firstRatio - currentRatio) / range) * 100;
        const finalPercentage = Math.min(Math.max(rawResult, 0), 100);

        progressFill.style.width = `${finalPercentage}%`;
    }

    private handleNoDetection() {
        this.noFaceDetectedInRow++;
        if (this.noFaceDetectedInRow > NO_FACE_DETECTED_BACKLASH) {
            this.capturedFrames = [];
            this.farDistanceFrames = [];
            this.closeDistanceFrames = [];
            if (this.phase !== 'WAITING') {
                this.setPhase('WAITING');
                this.updateStatus('hintCanNotIdentifyText');
            }
            this.firstRatio = 0;
        }
    }

    private setError(errorMsgKey?: string, showRetry: boolean = false) {
        const shadow = this.shadowRoot;
        if (!shadow) return;

        const video = shadow.querySelector('video');
        const canvas = shadow.querySelector('canvas');
        const infoBox = shadow.querySelector('#info-box') as HTMLElement;
        const errorWrapper = shadow.querySelector('#error-wrapper') as HTMLElement;

        if (errorMsgKey) {
            this._isRunning = false; // Stop the loop
            if (video) video.style.display = 'none';
            if (canvas) canvas.style.display = 'none';
            if (infoBox) infoBox.style.display = 'none';

            if (errorWrapper) {
                errorWrapper.style.display = 'flex';
                const headingText = this._displayText[errorMsgKey] || errorMsgKey;
                const messageText = this._displayText[errorMsgKey.replace('HeadingText', 'MessageText')] || '';
                const retryButton = showRetry && this._displayText['retryCameraPermissionsText']
                    ? `<button id="retry-camera-button" type="button">${this._displayText['retryCameraPermissionsText']}</button>`
                    : '';

                errorWrapper.innerHTML = `
                    <div class="error-content">
                        <p><strong>${headingText}</strong></p>
                        ${messageText ? `<p>${messageText}</p>` : ''}
                        ${retryButton}
                    </div>
                `;

                // Add retry button handler if present
                if (showRetry) {
                    const retryBtn = errorWrapper.querySelector('#retry-camera-button') as HTMLButtonElement;
                    if (retryBtn) {
                        retryBtn.addEventListener('click', () => {
                            this.init();
                        });
                    }
                }
            }
            return;
        }

        if (errorWrapper) errorWrapper.style.display = 'none';
        if (video) video.style.display = 'block';
        if (canvas) canvas.style.display = 'block';
        if (infoBox) infoBox.style.display = 'flex';
    }

    private setCameraPermissionOverlay(show: boolean) {
        const shadow = this.shadowRoot;
        if (!shadow) return;

        const overlay = shadow.querySelector<HTMLElement>('#camera-permission-overlay');
        const text = shadow.querySelector<HTMLElement>('#camera-permission-text');

        if (overlay) {
            overlay.style.display = show ? 'flex' : 'none';
        }

        if (text && show) {
            text.textContent = this._displayText['waitingCameraPermissionText'] || 'Waiting for camera permission...';
        }
    }

    private updateAccessibilityLabel() {
        const video = this.shadowRoot?.querySelector<HTMLVideoElement>('video');
        if (video && this._displayText['a11yVideoLabelText']) {
            video.setAttribute('aria-label', this._displayText['a11yVideoLabelText']);
        }
    }

    private isMobileOrTablet(): boolean {
        // Check if device is mobile or tablet (not desktop)
        const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera;
        const isMobileDevice = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent.toLowerCase());
        const hasTouchScreen = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        const isSmallScreen = window.innerWidth <= 1024; // Tablets are typically <= 1024px

        return isMobileDevice || (hasTouchScreen && isSmallScreen);
    }

    private checkOrientation() {
        // Only check orientation on mobile/tablet devices, not desktop
        if (!this.isMobileOrTablet()) {
            return;
        }

        const isLandscape = window.innerWidth > window.innerHeight;
        if (isLandscape && this._isRunning) {
            // Show landscape warning only on mobile/tablet
            this.setError('landscapeHeaderText');
            this.updateStatus('landscapeMessageText');
        } else if (!isLandscape && this._isRunning) {
            // Clear error if back to portrait
            this.setError();
        }
    }

    private setVerifying(isVerifying: boolean) {
        const shadow = this.shadowRoot;
        if (!shadow) return;

        const video = shadow.querySelector<HTMLVideoElement>('video');
        const canvas = shadow.querySelector<HTMLCanvasElement>('canvas');
        const infoBox = shadow.querySelector<HTMLElement>('#info-box');
        const verifyingOverlay = shadow.querySelector<HTMLElement>('#verifying-overlay');
        const verifyingText = shadow.querySelector<HTMLElement>('#verifying-text');

        if (isVerifying) {
            if (video) video.style.display = 'none';
            if (canvas) canvas.style.display = 'none';
            if (infoBox) infoBox.style.display = 'none';
            if (verifyingOverlay) verifyingOverlay.style.display = 'flex';
            if (verifyingText) {
                verifyingText.textContent = this._displayText['hintVerifyingText'] || 'Verifying...';
            }
        } else {
            if (verifyingOverlay) verifyingOverlay.style.display = 'none';
            if (video) video.style.display = 'block';
            if (canvas) canvas.style.display = 'block';
            if (infoBox) infoBox.style.display = 'flex';
        }
    }

}

if (!customElements.get('face-validation')) {
    customElements.define('face-validation', FaceValidationComponent);
}