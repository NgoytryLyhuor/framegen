import MP4Box, { type MP4Sample } from 'mp4box';

export interface DemuxedVideo {
  id: number;
  width: number;
  height: number;
  timescale: number;
  fps: number;
  durationSec: number;
  entryType: string;
  entry: { width?: number; height?: number; type?: string; avcC?: unknown };
  samples: MP4Sample[];
  parseError: string | null;
}

/**
 * Demux an MP4 into metadata + every video sample.
 *
 * mp4box 0.5.x requires the appended buffer to be an `ArrayBuffer` carrying a
 * `fileStart` property (0 for the start of the file) and that sample extraction
 * is enabled from inside `onReady`. Feeding the whole file in one buffer is
 * both memory-safe (mp4box references the bytes, it never copies them) and
 * fast — the main cost is just walking the box headers.
 */
export function demuxVideo(
  buffer: ArrayBuffer,
  isCancelled: () => boolean,
): Promise<DemuxedVideo> {
  const file = MP4Box.createFile();

  let boxInfo: { videoTracks?: { id: number; timescale?: number }[] } | null = null;
  let parseError: string | null = null;
  const samples: MP4Sample[] = [];

  file.onError = (msg: string) => {
    parseError = msg || 'MP4 parse error';
  };

  file.onReady = (info) => {
    boxInfo = info;
    const vt = info.videoTracks?.[0];
    if (vt) {
      try {
        file.setExtractionOptions(vt.id, null, { nbSamples: 1000 });
        file.start();
      } catch {
        /* extraction starts on the next parse pass */
      }
    }
  };

  file.onSamples = (id, _user, batch) => {
    for (const s of batch) samples.push(s);
    try {
      file.releaseUsedSamples(id, batch.map((s) => s.number));
    } catch {
      /* already released */
    }
  };

  return new Promise((resolve, reject) => {
    if (isCancelled()) {
      reject(new Error('Processing cancelled.'));
      return;
    }

    try {
      (buffer as unknown as { fileStart: number }).fileStart = 0;
      file.appendBuffer(buffer);
      file.flush();
    } catch (e) {
      reject(
        new Error(parseError ?? (e instanceof Error ? e.message : 'Could not parse this MP4 file.')),
      );
      return;
    }

    if (isCancelled()) {
      reject(new Error('Processing cancelled.'));
      return;
    }

    const vt = boxInfo?.videoTracks?.[0];
    const track = vt ? (file.getTrackById(vt.id) as any) : null;
    const entry = track?.mdia?.minf?.stbl?.stsd?.entries?.[0] ?? null;

    if (!vt || !entry) {
      reject(
        new Error(parseError ?? 'No decodable video track found in this MP4 file.'),
      );
      return;
    }

    const timescale = track?.mdia?.mdhd?.timescale ?? vt.timescale ?? 1000;

    const cts = samples.map((s) => s.cts).sort((a, b) => a - b);
    const deltas: number[] = [];
    for (let i = 1; i < cts.length; i++) {
      const d = (cts[i] - cts[i - 1]) / timescale;
      if (d > 0 && d < 1) deltas.push(Math.round(d * 1000) / 1000);
    }
    deltas.sort((a, b) => a - b);
    const fps = deltas.length
      ? Math.max(1, Math.round(1 / deltas[Math.floor(deltas.length / 2)]))
      : 30;
    const durationSec = (cts.length ? cts[cts.length - 1] : 0) / timescale;

    resolve({
      id: vt.id,
      width: Math.max(16, Math.round(entry.width ?? 1280)),
      height: Math.max(16, Math.round(entry.height ?? 720)),
      timescale,
      fps,
      durationSec,
      entryType: typeof entry.type === 'string' ? entry.type : 'avc1',
      entry,
      samples,
      parseError,
    });
  });
}