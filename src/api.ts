const CHALLENGE_TYPE = 'near_far';
const NEAR_FAR_MIN_RATIO = 1.15;
const DEFAULT_DETECTOR_NAME = 'yolov11m';

type VerificationApiConfig = {
  ageThreshold?: number;
  detectorName?: string;
};

// type VerificationSummary = {
//   isReal: boolean;
//   estimatedAge: number | null;
//   validationError?: string;
//   raw: unknown;
// };

function normalizeFrames(capturedFrames: string[]) {
  return capturedFrames.map((frame) => {
    let base64Data = frame;
    if (frame.startsWith('data:')) {
      base64Data = frame.split(',')[1];
    }
    return { image_b64: base64Data };
  });
}

async function sendVerificationToMainServer(
  mainServerUrl: string,
  verificationToken: string,
  capturedFrames: string[],
  config?: VerificationApiConfig,
) {
  const images = normalizeFrames(capturedFrames);

  const response = await fetch(`${mainServerUrl}/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      verification_token: verificationToken,
      images,
      age_threshold: config?.ageThreshold ?? 18,
      detector_name: DEFAULT_DETECTOR_NAME,
      challenge_type: CHALLENGE_TYPE,
      near_far_min_ratio: NEAR_FAR_MIN_RATIO,
    }),
  });

  if (!response.ok) {
    throw new Error(`Verification request failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (data.status !== 200) {
    const errorMsg = Array.isArray(data.errors) ? data.errors.join(', ') : 'Verification request failed';
    throw new Error(errorMsg);
  }

  return response;
}

// async function pollForResult(apiUrlBase: string, verificationToken: string) {
//   const maxAttempts = 180; // up to ~3 minutes, mirroring the demo
//   const intervalMs = 1000;
//
//   // eslint-disable-next-line no-plusplus
//   for (let attempt = 1; attempt <= maxAttempts; attempt++) {
//     const response = await fetch(`${apiUrlBase}/verification-result`, {
//       method: 'POST',
//       headers: {
//         'Content-Type': 'application/json',
//       },
//       body: JSON.stringify({ verification_token: verificationToken }),
//     });
//
//     const status = response.status;
//     const result = await response.json();
//
//     if (status === 202) {
//       if (attempt === maxAttempts) {
//         throw new Error('Verification timeout after 3 minutes - please try again');
//       }
//       // wait and try again
//       await new Promise((resolve) => setTimeout(resolve, intervalMs));
//       // eslint-disable-next-line no-continue
//       continue;
//     }
//
//     if (status !== 200) {
//       const errorMsg = Array.isArray(result.errors) ? result.errors.join(', ') : 'Verification failed';
//       throw new Error(errorMsg);
//     }
//
//     if (result.data && result.data.status === 'done') {
//       return result.data;
//     }
//
//     throw new Error('Unexpected response from server');
//   }
//
//   throw new Error('Verification timeout - max attempts exceeded');
// }
//
// function analyzeResults(resultData: any): VerificationSummary {
//   if (!resultData || resultData.status !== 'done' || !resultData.result) {
//     throw new Error('Invalid response from server');
//   }
//
//   // API returns nested result: result.result.result or similar
//   const actualResult = resultData.result.result ?? resultData.result;
//
//   // Validation failure takes precedence
//   if (actualResult.liveness_detection?.validation_failed === true) {
//     const validationError: string =
//       actualResult.liveness_detection.validation_error ||
//       (Array.isArray(actualResult.liveness_detection.validation_errors)
//         ? actualResult.liveness_detection.validation_errors.join(', ')
//         : 'Validation failed');
//
//     return {
//       isReal: false,
//       estimatedAge: null,
//       validationError,
//       raw: resultData,
//     };
//   }
//
//   let isReal = false;
//   let averageAge: number | null = null;
//
//   if (actualResult.liveness_detection) {
//     const assessment = actualResult.liveness_detection.overall_assessment;
//     isReal = Boolean(assessment?.all_faces_real);
//     averageAge = typeof assessment?.overall_age === 'number' ? assessment.overall_age : null;
//   } else if (actualResult.anti_spoofing) {
//     isReal = Boolean(actualResult.anti_spoofing.summary?.all_faces_real);
//     averageAge = typeof actualResult.estimated_age === 'number' ? actualResult.estimated_age : null;
//   }
//
//   return {
//     isReal,
//     estimatedAge: averageAge,
//     raw: resultData,
//   };
// }

export async function verifyCapturedFrames(
  capturedFrames: string[],
  apiUrl: string,
  verificationToken: string,
  config?: VerificationApiConfig,
): Promise<Response> {

  // 2) Send frames to main server
  return await sendVerificationToMainServer(apiUrl, verificationToken, capturedFrames, config);

  // // 3) Poll application server for final result
  // const resultData = await pollForResult(apiUrl, verificationToken);
  //
  // // 4) Normalize into a compact summary while still returning raw payload
  // return analyzeResults(resultData);
}

