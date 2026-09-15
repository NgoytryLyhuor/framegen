import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { Interpolator } from '../lib/interpolator';
import { demuxVideo } from '../lib/demux';
import {
  WEIGHTS_BIN,
  WEIGHTS_MANIFEST,
  SCENE_CUT_THRESHOLD,
  ENCODE_BITRATE,
  ENCODE_CODEC,
  MAX_ALLOWED_FRAMES,
  MAX_WIDTH,
  MAX_HEIGHT,
} from '../lib/constants';
import type {
  ProcessRequest,
  ProbeRequest,
  WorkerResponse,
  InterpFactor,
} from '../lib/types';

const workerGlobal = globalThis as unknown as {
  postMessage: (msg: unknown, transfer: Transferable[]) => void;
  onmessage: (ev: MessageEvent<ProcessRequest>) => void;
};

const post = (msg: WorkerResponse, transfer?: Transferable[]) => {
  workerGlobal.postMessage(msg, transfer ?? []);
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let running = false;
let cancelled = false;

function checkCancelled(): void {
  if (cancelled) throw new Error('Processing cancelled.');
}

// ---------------------------------------------------------------------------
// AVCC helpers
// ---------------------------------------------------------------------------

function pad2(n: number): string {
  return n.toString(16).padStart(2, '0');
}

interface AvcInfo {
  codec: string;
  description: Uint8Array;
  lenBytes: number;
}

function buildAvcInfo(entry: { avcC?: unknown }): AvcInfo {
  const avcC = entry.avcC as
    | {
        AVCProfileIndication?: number;
        profile_compatibility?: number;
        AVCLevelIndication?: number;
        lengthSizeMinusOne?: number;
        sps?: Uint8Array[];
        pps?: Uint8Array[];
      }
    | undefined;

  if (!avcC) {
    throw new Error('Not an H.264 (AVC) video — this codec is not supported yet.');
  }

  const codec =
    'avc1.' +
    [
      avcC.AVCProfileIndication ?? 0,
      avcC.profile_compatibility ?? 0,
      avcC.AVCLevelIndication ?? 0,
    ]
      .map(pad2)
      .join('');

  // Rebuild the AVCDecoderConfigurationRecord and force 4-byte length prefixes,
  // which is what Chrome's decoder requires.
  const bytes: number[] = [];
  bytes.push(0x01, avcC.AVCProfileIndication ?? 0, avcC.profile_compatibility ?? 0, avcC.AVCLevelIndication ?? 0, 0xff);
  const sps = avcC.sps ?? [];
  const pps = avcC.pps ?? [];
  bytes.push(0xe0 | (sps.length & 0x1f));
  for (const s of sps) {
    bytes.push((s.length >> 8) & 0xff, s.length & 0xff);
    for (let i = 0; i < s.length; i++) bytes.push(s[i]);
  }
  bytes.push(pps.length);
  for (const p of pps) {
    bytes.push((p.length >> 8) & 0xff, p.length & 0xff);
    for (let i = 0; i < p.length; i++) bytes.push(p[i]);
  }

  return {
    codec,
    description: new Uint8Array(bytes),
    lenBytes: ((avcC.lengthSizeMinusOne ?? 3) & 0x03) + 1,
  };
}

function to4ByteLengthPrefixed(au: Uint8Array, lenBytes: number): Uint8Array {
  if (lenBytes === 4) return au;
  const chunks: number[] = [];
  let pos = 0;
  while (pos < au.length) {
    let n = 0;
    for (let i = 0; i < lenBytes; i++) n = (n << 8) | au[pos + i];
    pos += lenBytes;
    chunks.push((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
    for (let i = 0; i < n; i++) chunks.push(au[pos + i]);
    pos += n;
  }
  return new Uint8Array(chunks);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function run(req: ProcessRequest): Promise<void> {
  const factor: InterpFactor = req.factor === 8 ? 8 : req.factor === 4 ? 4 : 2;
  const data = new Uint8Array(req.buffer);

  // -------------------------------- DEMUX ----------------------------------
  post({ type: 'progress', stage: 'decode', pct: 1, note: 'Reading video…' });
  const demuxed = await demuxVideo(new Uint8Array(req.buffer), () => cancelled);

  const { width: origW, height: origH } = demuxed;

  if (origW > MAX_WIDTH || origH > MAX_HEIGHT) {
    throw new Error(
      `Video is ${origW}×${origH}, above the ${MAX_WIDTH}×${MAX_HEIGHT} safety limit. Use a smaller clip.`,
    );
  }

  const expected = demuxed.samples.length;
  if (!expected || expected === 0) {
    throw new Error('No decodable frames found in this video.');
  }
  if (expected > MAX_ALLOWED_FRAMES) {
    throw new Error(
      `Video has ${expected} frames (limit ${MAX_ALLOWED_FRAMES}). Use a shorter clip.`,
    );
  }

  if (demuxed.entryType === 'hvc1' || demuxed.entryType === 'hev1') {
    throw new Error(
      'This video uses HEVC / H.265, which can’t be interpolated here yet. Convert it to H.264 (e.g. with HandBrake), then try again.',
    );
  }

  const { codec, description, lenBytes } = buildAvcInfo(demuxed.entry);

  // ------------------------------- TIMING ----------------------------------
  const sourceFps = Math.min(60, Math.max(1, demuxed.fps));
  const outFps = sourceFps * factor;
  const frameDurUs = Math.round((1 / outFps) * 1e6);

  post({
    type: 'meta',
    width: origW,
    height: origH,
    fpsIn: sourceFps,
    fpsOut: outFps,
    frames: expected,
  });

  post({
    type: 'progress',
    stage: 'decode',
    pct: 2,
    note: `${origW}×${origH} @ ${sourceFps}fps → ${outFps}fps`,
  });

  // ------------------------------ PADDING ----------------------------------
  const w16 = Math.ceil(origW / 16) * 16;
  const h16 = Math.ceil(origH / 16) * 16;

  const padCanvas = new OffscreenCanvas(w16, h16);
  const padCtx = padCanvas.getContext('2d', { willReadFrequently: true });
  if (!padCtx) throw new Error('Canvas context unavailable.');

  const encCanvasCtx = new OffscreenCanvas(origW, origH).getContext('2d');
  if (!encCanvasCtx) throw new Error('Canvas context unavailable.');
  const encCanvas = encCanvasCtx.canvas;

  // ------------------------------ WEIGHTS ----------------------------------
  post({ type: 'progress', stage: 'decode', pct: 4, note: 'Loading RIFE weights…' });
  const [binResp, manResp] = await Promise.all([fetch(WEIGHTS_BIN), fetch(WEIGHTS_MANIFEST)]);
  if (!binResp.ok || !manResp.ok) {
    throw new Error('Failed to load model weights from the server.');
  }
  const [weightsBin, weightsManifest] = await Promise.all([binResp.arrayBuffer(), manResp.json()]);

  post({ type: 'progress', stage: 'decode', pct: 8, note: 'Initializing WebGPU…' });
  const interp = await Interpolator.create({
    width: w16,
    height: h16,
    weightsBin,
    weightsManifest,
  });

  // ----------------------------- ENCODER -----------------------------------
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: origW, height: origH },
    firstTimestampBehavior: 'offset',
  });

  let encodeError: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      encodeError = e;
    },
  });
  try {
    encoder.configure({
      codec: ENCODE_CODEC,
      width: origW,
      height: origH,
      bitrate: ENCODE_BITRATE,
      framerate: outFps,
      hardwareAcceleration: 'prefer-hardware',
    });
  } catch {
    encoder.configure({
      codec: ENCODE_CODEC,
      width: origW,
      height: origH,
      bitrate: ENCODE_BITRATE,
      framerate: outFps,
    });
  }

  // ----------------------------- HELPERS -----------------------------------
  const cropToImageData = (padded: Uint8Array): ImageData => {
    const out = new Uint8ClampedArray(origW * origH * 4);
    const row = origW * 4;
    for (let y = 0; y < origH; y++) {
      out.set(padded.subarray(y * w16 * 4, y * w16 * 4 + row), y * row);
    }
    return new ImageData(out, origW, origH);
  };

  const isSceneCut = (a: Uint8Array, b: Uint8Array): boolean => {
    let sum = 0;
    let n = 0;
    const step = 32;
    for (let i = 0; i < a.length; i += step) {
      const la = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
      const lb = 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2];
      sum += Math.abs(la - lb);
      n += 1;
    }
    return sum / n > SCENE_CUT_THRESHOLD;
  };

  let emitIdx = 0;
  let handled = 0;

  const frameToPadded = async (frame: VideoFrame): Promise<{ padded: Uint8Array; img: ImageData }> => {
    padCtx.clearRect(0, 0, w16, h16);
    padCtx.drawImage(frame, 0, 0, frame.displayWidth, frame.displayHeight, 0, 0, origW, origH);
    try {
      frame.close();
    } catch {
      /* already closed */
    }
    const d = padCtx.getImageData(0, 0, w16, h16);
    const padded = new Uint8Array(d.data.buffer.slice(0));
    return { padded, img: cropToImageData(padded) };
  };

  const emit = async (img: ImageData, keyFrame: boolean, isLast: boolean): Promise<void> => {
    checkCancelled();
    encCanvasCtx.putImageData(img, 0, 0);
    const vf = new VideoFrame(encCanvas, { timestamp: emitIdx * frameDurUs, duration: frameDurUs });
    encoder.encode(vf, { keyFrame });
    vf.close();
    emitIdx += 1;

    // Bound encoder queue memory.
    if (emitIdx % 80 === 0 && !isLast) {
      await encoder.flush();
    }

    const pct = Math.min(97, 10 + Math.round((handled / expected) * 80));
    post({ type: 'progress', stage: 'interpolate', pct });
  };

  // ----------------------------- DECODER -----------------------------------
  let chain: Promise<void> = Promise.resolve();
  let decodeError: unknown = null;

  const decoder = new VideoDecoder({
    output: (frame) => {
      chain = chain.then(async () => {
        if (cancelled) {
          try {
            frame.close();
          } catch {
            /* already closed */
          }
          return;
        }
        await handleFrame(frame);
      });
    },
    error: (e) => {
      decodeError = e;
    },
  });
  decoder.configure({ codec, codedWidth: origW, codedHeight: origH, description });

  let prevPadded: Uint8Array | null = null;

  async function handleFrame(frame: VideoFrame): Promise<void> {
    const { padded, img } = await frameToPadded(frame);
    handled += 1;

    if (!prevPadded) {
      prevPadded = new Uint8Array(padded);
      await emit(img, true, false);
    } else {
      const cut = isSceneCut(prevPadded, padded);
      const midPadded = cut
        ? Array.from({ length: factor - 1 }, () => prevPadded!)
        : await interp.mids(prevPadded, padded, factor);

      for (const mid of midPadded) {
        await emit(cropToImageData(mid), false, false);
        checkCancelled();
      }
      prevPadded = new Uint8Array(padded);
      await emit(img, false, handled === expected);
    }

    checkCancelled();
  }

  // ------------------------------- FEED ------------------------------------
  post({ type: 'progress', stage: 'decode', pct: 5, note: 'Decoding…' });

  let decodeCount = 0;
  for (const s of demuxed.samples) {
    checkCancelled();
    while (decoder.decodeQueueSize > 10) await sleep(2);
    const au = to4ByteLengthPrefixed(s.data, lenBytes);
    decoder.decode(
      new EncodedVideoChunk({
        type: s.is_sync ? 'key' : 'delta',
        timestamp: Math.round((s.cts / demuxed.timescale) * 1e6),
        data: au,
      }),
    );
    decodeCount += 1;
    if (decodeCount % 150 === 0) {
      post({
        type: 'progress',
        stage: 'decode',
        pct: Math.min(40, 5 + (decodeCount / expected) * 35),
      });
    }
  }

  if (decodeError) throw new Error(`VideoDecoder failed: ${String(decodeError)}`);

  await decoder.flush();
  if (decodeError) throw new Error(`VideoDecoder failed: ${String(decodeError)}`);

  post({ type: 'progress', stage: 'encode', pct: 98, note: 'Finalizing…' });
  await chain;
  if (encodeError) throw new Error(`VideoEncoder failed: ${String(encodeError)}`);
  await encoder.flush();
  if (encodeError) throw new Error(`VideoEncoder failed: ${String(encodeError)}`);

  muxer.finalize();
  const { buffer } = muxer.target;

  post(
    {
      type: 'done',
      buffer,
      width: origW,
      height: origH,
      fpsIn: sourceFps,
      fpsOut: outFps,
      durationSec: Math.round(demuxed.durationSec * 10) / 10,
      framesIn: handled,
      framesOut: emitIdx,
    },
    [buffer],
  );
}

async function runProbe(req: ProbeRequest): Promise<void> {
  const demuxed = await demuxVideo(new Uint8Array(req.buffer), () => cancelled);
  const sourceFps = Math.min(60, Math.max(1, demuxed.fps));

  if (demuxed.entryType === 'hvc1' || demuxed.entryType === 'hev1') {
    throw new Error(
      'This video uses HEVC / H.265, which can’t be interpolated here yet. Convert it to H.264 (e.g. with HandBrake), then try again.',
    );
  }

  post({
    type: 'meta',
    width: demuxed.width,
    height: demuxed.height,
    fpsIn: sourceFps,
    fpsOut: sourceFps * 2,
    frames: demuxed.samples.length,
  });
}

// ---------------------------------------------------------------------------
// Worker entry
// ---------------------------------------------------------------------------

type WorkerRequest = ProcessRequest | ProbeRequest;

workerGlobal.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  if (running) return;
  running = true;
  cancelled = false;

  const task = ev.data.type === 'probe' ? runProbe(ev.data) : run(ev.data);

  task
    .catch((e: unknown) => {
      cancelled = false;
      post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    })
    .finally(() => {
      running = false;
    });
};

export {};