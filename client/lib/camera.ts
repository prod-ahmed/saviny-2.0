export type CameraFacing = "user" | "environment";

export interface OpenCamera {
  stream: MediaStream;
  label: string;
  mirror: boolean;
  facing: CameraFacing;
}

function ensureCameraAvailable(): void {
  if (!window.isSecureContext) {
    const secureUrl = `https://${window.location.host}`;
    throw new Error(`The camera is blocked on ${window.location.origin}. On your iPhone, open ${secureUrl} instead. If Safari says the connection is not private, tap Show Details, then visit this website.`);
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera access is not available in this browser. Choose a photo instead.");
  }
}

function cameraError(err: unknown, facing?: CameraFacing): Error {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    return new Error("Camera permission is blocked. Allow camera access for this site in your browser settings, then try again.");
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return new Error("The camera is being used by another app. Close that app and try again.");
  }
  if (facing && (name === "OverconstrainedError" || name === "NotFoundError" || name === "DevicesNotFoundError")) {
    return new Error(facing === "environment" ? "No back camera was found on this device." : "No front camera was found on this device.");
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") {
    return new Error("No camera was found on this device.");
  }
  return new Error(err instanceof Error ? `Could not open the camera: ${err.message}` : "Could not open the camera. Check your browser permissions.");
}

function describe(stream: MediaStream, requested: CameraFacing): OpenCamera {
  const track = stream.getVideoTracks()[0];
  const reported = track?.getSettings().facingMode;
  const facing: CameraFacing = reported === "user" || reported === "environment" ? reported : requested;
  return {
    stream,
    facing,
    mirror: facing === "user",
    label: facing === "environment" ? "Back camera" : "Front camera",
  };
}

/** Opens the front (`user`) or back (`environment`) camera. The other lens is left closed. */
export async function openCamera(facing: CameraFacing): Promise<OpenCamera> {
  ensureCameraAvailable();
  const attempts: MediaTrackConstraints[] = [
    { facingMode: { exact: facing } },
    { facingMode: facing },
  ];
  let lastError: unknown;
  for (const video of attempts) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
      return describe(stream, facing);
    } catch (err) {
      lastError = err;
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") throw cameraError(err);
    }
  }
  throw cameraError(lastError, facing);
}

/** Opens the back camera when the phone has one, otherwise the only camera available. */
export async function openPreferredCamera(): Promise<OpenCamera> {
  try {
    return await openCamera("environment");
  } catch (err) {
    if (err instanceof Error && /permission|blocked|not available|https/i.test(err.message)) throw err;
    try {
      return await openCamera("user");
    } catch (frontError) {
      ensureCameraAvailable();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
        return describe(stream, "user");
      } catch {
        throw frontError instanceof Error ? frontError : err;
      }
    }
  }
}

export function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}
