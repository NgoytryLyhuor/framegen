export type InterpFactor = 2 | 4 | 8;

export interface ProcessRequest {
  type: 'process';
  buffer: ArrayBuffer;
  factor: InterpFactor;
  fileName: string;
}

export type WorkerProgress = {
  type: 'progress';
  stage: 'decode' | 'interpolate' | 'encode';
  pct: number;
  note?: string;
};

export type WorkerLog = { type: 'log'; msg: string };

export interface MetaResponse {
  type: 'meta';
  width: number;
  height: number;
  fpsIn: number;
  fpsOut: number;
  frames: number;
}

export interface DoneResponse {
  type: 'done';
  buffer: ArrayBuffer;
  width: number;
  height: number;
  fpsIn: number;
  fpsOut: number;
  durationSec: number;
  framesIn: number;
  framesOut: number;
}

export type WorkerError = { type: 'error'; message: string };

export type WorkerResponse =
  | WorkerProgress
  | WorkerLog
  | MetaResponse
  | DoneResponse
  | WorkerError;

export interface OutputResult {
  url: string;
  fileName: string;
  width: number;
  height: number;
  fpsIn: number;
  fpsOut: number;
  durationSec: number;
  framesIn: number;
  framesOut: number;
  sizeMb: number;
}