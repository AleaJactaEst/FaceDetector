import faceValidationStyles from './face-validation.css?inline';

export const FACE_VALIDATION_TEMPLATE = `
      <style>
        ${faceValidationStyles}
      </style>

      <div class="wrapper">
        <video autoplay muted playsinline aria-label=""></video>
        <canvas></canvas>
        
        <div id="cancel-button-wrapper">
          <button id="cancel-button" type="button" aria-label="Cancel liveness check">
            <span id="cancel-button-icon">&#x2715;</span>
          </button>
        </div>

        <div id="recording-sign">
            <div id="red-square"></div>
            <div id="rec-text">Rec</div>
        </div>

        <div id="info-box">
          <div id="instruction-text"></div>
          <div id="fit-percentage">
            <div id="fit-percentage-fill"></div>
          </div>
        </div>
        
        <div id="camera-permission-overlay">
          <div id="camera-permission-spinner"></div>
          <div id="camera-permission-text"></div>
        </div>

        <div id="verifying-overlay">
          <div id="verifying-spinner"></div>
          <div id="verifying-text"></div>
        </div>
        
        <div id="result-overlay">
          <div id="result-modal">
            <div id="result-icon"></div>
            <div id="result-title"></div>
            <div id="result-message"></div>
            <button id="result-try-again-button" type="button"></button>
          </div>
        </div>
        
        <div id="error-wrapper"></div>

      </div>
      
    `;