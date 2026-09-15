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

const CHUNK = 4 * 1024 * 1024;

/**
 * Demux an MP4 incrementally (mp4box fails on very large or fragmented files
 * when the whole buffer is appended at once). Feeds 4 MB slices while yielding
 * to the event loop, sets sample extraction once `moov` is seen, and resolves
 * with video metadata + every video sample.
 */
export function demuxVideo(
  buffer: ArrayBuffer,
  isCancelled: () => boolean,
): Promise<DemuxedVideo> {
  return new Promise((resolve, reject) => {
    const file = MP4Box.createFile();
    let boxInfo: { videoTracks?: { id: number; timescale?: number }[] } | null = null;
    let parseError: string | null = null;
    const samples: MP4Sample[] = [];

    file.onError = (msg: string) => {
      parseError = msg || 'MP4 parse error';
    };

    file.onReady = (info) => {
      boxInfo = info;
    };

    file.onSamples = (id, _user, batch) => {
      for (const s of batch) samples.push(s);
      file.releaseUsedSamples(id, batch.map((s) => s.number));
    };

    const data = new Uint8Array(buffer);
    let offset = 0;
    let started = false;

    const fail = (msg: string) => {
      try {
        file.stop();
      } catch {
        /* noop */
      }
      reject(new Error(msg));
    };

    const finish = (): void => {
      try {
        file.flush();
      } catch {
        /* handled by finish checks */
      }
      const vt = boxInfo?.videoTracks?.[0];
      const track = vt ? (file.getTrackById(vt.id) as any) : null;
      const entry = track?.mdia?.minf?.stbl?.stsd?.entries?.[0] ?? null;

      if (!vt || !entry) {
        fail(parseError ?? 'No decodable video track found in this MP4 file.');
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
    };

    const step = (): void => {
      if (isCancelled()) {
        fail('Processing cancelled.');
        return;
      }

      if (offset >= data.length) {
        finish();
        return;
      }

      const end = Math.min(offset + CHUNK, data.length);
      const slice = data.slice(offset, end);
      try {
        file.appendBuffer(slice);
      } catch {
        fail(parseError ?? 'Could not parse this MP4 file.');
        return;
      }

      if (boxInfo && !started && boxInfo.videoTracks?.length) {
        const vt = boxInfo.videoTracks[0];
        try {
          file.setExtractionOptions(vt.id, null, { nbSamples: 1000 });
          file.start();
          started = true;
        } catch {
          /* wait for next chunk */
        }
      }

      try {
        file.flush();
      } catch {
        fail(parseError ?? 'Could not parse this MP4 file.');
        return;
      }
      offset = end;

      if (offset >= data.length) {
        // Give onSamples a tick before finishing.
        setTimeout(finish, 0);
      } else {
        setTimeout(step, 0);
      }
    };

    setTimeout(step, 0);
  });
}