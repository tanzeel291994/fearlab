// Shared camera + MediaPipe model loading. Everything runs locally in the browser.
import { FaceLandmarker, PoseLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const POSE_MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

let fileset;

async function create(Task, modelAssetPath, options) {
  fileset ??= await FilesetResolver.forVisionTasks(WASM);
  const withDelegate = delegate => ({ ...options, runningMode: 'VIDEO', baseOptions: { modelAssetPath, delegate } });
  try {
    return await Task.createFromOptions(fileset, withDelegate('GPU'));
  } catch {
    return await Task.createFromOptions(fileset, withDelegate('CPU'));
  }
}

export const loadFaceLandmarker = (numFaces = 1) =>
  create(FaceLandmarker, FACE_MODEL, { numFaces, outputFaceBlendshapes: true });

export const loadPoseLandmarker = (numPoses = 1) =>
  create(PoseLandmarker, POSE_MODEL, { numPoses });

export async function startCamera(video, canvas) {
  video.srcObject = await navigator.mediaDevices.getUserMedia({
    video: { width: 1280, height: 720, facingMode: 'user' },
    audio: false,
  });
  await video.play();
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
}

// Calls onFrame(timestampMs) once per new video frame.
export function eachFrame(video, onFrame) {
  let last = -1;
  const tick = () => {
    requestAnimationFrame(tick);
    if (video.currentTime === last) return;
    last = video.currentTime;
    onFrame(performance.now());
  };
  requestAnimationFrame(tick);
}

// Selfie view: draws the video flipped so moving right moves right on screen.
export function drawMirrored(ctx, video) {
  const { width, height } = ctx.canvas;
  ctx.save();
  ctx.translate(width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, width, height);
  ctx.restore();
}
