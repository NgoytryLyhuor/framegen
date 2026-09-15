declare module 'mp4box' {
  export interface MP4Sample {
    number: number;
    track_id: number;
    description: unknown;
    data: Uint8Array;
    size: number;
    duration: number;
    cts: number;
    dts: number;
    is_sync: boolean;
  }

  export interface MP4VideoTrackInfo {
    id: number;
    duration?: number;
    timescale?: number;
    [key: string]: unknown;
  }

  export interface MP4Info {
    duration?: number;
    timescale?: number;
    videoTracks: MP4VideoTrackInfo[];
    audioTracks: unknown[];
    [key: string]: unknown;
  }

  export interface MP4BoxFile {
    onReady?: (info: MP4Info) => void;
    onError?: (message: string) => void;
    onSamples?: (
      trackId: number,
      user: unknown,
      samples: MP4Sample[],
    ) => void;
    appendBuffer(data: ArrayBuffer & { fileStart?: number }, last?: boolean): void;
    flush(): void;
    start(): void;
    stop(): void;
    setExtractionOptions(trackId: number | string, user?: unknown, opts?: { nbSamples: number }): void;
    getTrackById(id: number | string): unknown;
    releaseUsedSamples(trackId: number | string, sampleNumbers: number[]): void;
  }

  interface MP4BoxModule {
    createFile(): MP4BoxFile;
  }

  const MP4Box: MP4BoxModule;
  export default MP4Box;
}