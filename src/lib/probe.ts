import MP4Box from 'mp4box';

export interface ProbeResult {
  width: number;
  height: number;
  fps: number;
  frames: number;
}

/**
 * Fast all-in-memory metadata probe: demuxes the file to learn resolution,
 * source frame rate and frame count (used only to label the UI, never to process).
 */
export function probeVideo(buffer: ArrayBuffer): ProbeResult | null {
  try {
    const file = MP4Box.createFile();
    let failed = false;

    let entry: { width?: number; height?: number } | null = null;
    let timescale = 1000;
    const cts: number[] = [];

    file.onError = () => {
      failed = true;
    };

    file.onReady = (info) => {
      const vt = info.videoTracks?.[0];
      if (!vt) return;
      const track = file.getTrackById(vt.id) as
        | { mdia: { mdhd?: { timescale?: number }; minf: { stbl: { stsd: { entries: unknown[] } } } } }
        | null
        | undefined;
      timescale = track?.mdia?.mdhd?.timescale ?? vt.timescale ?? 1000;
      entry =
        (track?.mdia?.minf?.stbl?.stsd?.entries?.[0] as { width?: number; height?: number } | undefined) ??
        null;
      file.setExtractionOptions(vt.id, null, { nbSamples: 100000 });
      file.start();
    };

    file.onSamples = (_id, _user, samples) => {
      for (const s of samples) cts.push(s.cts);
    };

    file.appendBuffer(new Uint8Array(buffer));
    file.flush();

    const resEntry = entry as { width?: number; height?: number } | null;
    if (failed || !resEntry || cts.length < 2) return null;

    const sorted = [...cts].sort((a, b) => a - b);
    const deltas: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const d = (sorted[i] - sorted[i - 1]) / timescale;
      if (d > 0 && d < 1) deltas.push(Math.round(d * 1000) / 1000);
    }
    if (!deltas.length) return null;
    deltas.sort((a, b) => a - b);
    const fps = Math.round(1 / deltas[Math.floor(deltas.length / 2)]);

    return {
      width: Math.round(resEntry.width ?? 1280),
      height: Math.round(resEntry.height ?? 720),
      fps,
      frames: cts.length,
    };
  } catch {
    return null;
  }
}