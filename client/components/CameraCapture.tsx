import { useEffect, useRef, useState } from "react";
import { openCamera, openPreferredCamera, stopStream, type CameraFacing } from "../lib/camera";

/** Live camera preview. Uses the webcam when the device has no back camera. */
export function CameraCapture({
  busy = false,
  captureLabel,
  onCapture,
  onClose,
}: {
  busy?: boolean;
  captureLabel: string;
  onCapture: (file: File) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [label, setLabel] = useState("Opening your camera…");
  const [facing, setFacing] = useState<CameraFacing>("environment");
  const [mirror, setMirror] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState("");
  const facingRef = useRef<CameraFacing>("environment");

  useEffect(() => {
    panelRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    let cancelled = false;
    void openPreferredCamera()
      .then((opened) => {
        if (cancelled) {
          stopStream(opened.stream);
          return;
        }
        streamRef.current = opened.stream;
        facingRef.current = opened.facing;
        setFacing(opened.facing);
        setMirror(opened.mirror);
        setLabel(opened.label);
        setStream(opened.stream);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLabel("");
        setError(err instanceof Error ? err.message : "Could not open the camera.");
      });
    return () => {
      cancelled = true;
      stopStream(streamRef.current);
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    video.muted = true;
    void video.play().catch(() => {
      setError("The camera is open but the preview could not start. Check your browser’s camera permission and try again.");
    });
  }, [stream]);

  const applyCamera = (opened: { stream: MediaStream; label: string; mirror: boolean; facing: CameraFacing }) => {
    streamRef.current = opened.stream;
    facingRef.current = opened.facing;
    setFacing(opened.facing);
    setMirror(opened.mirror);
    setLabel(opened.label);
    setStream(opened.stream);
  };

  const chooseCamera = async (next: CameraFacing) => {
    if (switching || next === facingRef.current) return;
    setSwitching(true);
    setError("");
    const previous = facingRef.current;
    stopStream(streamRef.current);
    streamRef.current = null;
    try {
      applyCamera(await openCamera(next));
    } catch (err) {
      try {
        applyCamera(await openCamera(previous));
      } catch {
        setStream(null);
      }
      setError(err instanceof Error ? err.message : "Could not switch cameras.");
    } finally {
      setSwitching(false);
    }
  };

  const capture = async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      setError("The camera is not ready yet. Please wait a moment and try again.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      setError("Could not capture the photo. Please try again or choose an image.");
      return;
    }
    if (mirror) {
      context.translate(canvas.width, 0);
      context.scale(-1, 1);
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) {
      setError("Could not capture the photo. Please try again.");
      return;
    }
    setError("");
    onCapture(new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" }));
  };

  return (
    <section ref={panelRef} className="receipt-camera" aria-label="Camera">
      <div className="receipt-camera-head">
        <div>
          <strong>{label || "Camera"}</strong>
          <p>{facing === "environment" ? "Using the back camera." : "Using the front camera."}</p>
        </div>
        <button type="button" className="secondary" onClick={onClose}>Close camera</button>
      </div>
      <div className="receipt-camera-switch" role="group" aria-label="Choose a camera">
        <button type="button" aria-pressed={facing === "environment"} disabled={!stream || switching} onClick={() => void chooseCamera("environment")}>Back</button>
        <button type="button" aria-pressed={facing === "user"} disabled={!stream || switching} onClick={() => void chooseCamera("user")}>Front</button>
      </div>
      <div className="receipt-camera-view">
        {stream
          ? <video ref={videoRef} autoPlay muted playsInline style={mirror ? { transform: "scaleX(-1)" } : undefined} />
          : <p className={error ? "is-error" : ""}>{error || "Opening your camera…"}</p>}
      </div>
      {error && stream && <p className="receipt-camera-error" role="alert">{error}</p>}
      <button type="button" className="primary" disabled={busy || !stream} onClick={() => void capture()}>
        {busy ? "Please wait…" : captureLabel}
      </button>
    </section>
  );
}
