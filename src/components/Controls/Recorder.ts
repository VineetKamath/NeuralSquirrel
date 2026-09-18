import { canvasRegistry } from "@/components/World/canvasRegistry";

let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];

/** Record the WebGL feed to a WebM file. Returns false if unsupported. */
export function startRecording(): boolean {
  const canvas = canvasRegistry.canvas;
  if (!canvas || typeof MediaRecorder === "undefined" || !canvas.captureStream) return false;
  const stream = canvas.captureStream(60);
  const types = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t));
  try {
    recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 12_000_000 } : undefined);
  } catch {
    return false;
  }
  chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  recorder.start(500);
  return true;
}

export function stopRecording(filename: string) {
  if (!recorder) return;
  const r = recorder;
  recorder = null;
  r.onstop = () => {
    const blob = new Blob(chunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  r.stop();
}
