export const FRAMES_TO_CAPTURE = 10;
export const FRAMES_FAR_DISTANCE = 5;
export const FRAMES_CLOSE_DISTANCE = 5;

// Distance validation thresholds
export const FAR_THRESHOLD_MULTIPLIER = 0.93; // Ratio threshold for "far enough" (93% of initial ratio)
export const INITIAL_DISTANCE_THRESHOLD = 0.95; // If initial ratio is above this, user is "close" and needs to move back
// Close phase: easier for humans, but still ensures they move closer
export const CLOSE_DISTANCE_RATIO_MULTIPLIER = 1.15; // Close ratio must be at least 1.15x the far/initial ratio
export const CLOSE_DISTANCE_PROGRESS_THRESHOLD = 35; // Close progress (0–100) must reach at least 60%
export const NO_FACE_DETECTED_BACKLASH = 10;
