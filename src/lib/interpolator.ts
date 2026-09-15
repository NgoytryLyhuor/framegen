import { createRT, type RT } from 'framegen';

export interface WeightsManifest {
  [name: string]: { offset: number; shape: number[] };
}

export interface InterpolatorOpts {
  width: number;
  height: number;
  weightsBin: ArrayBuffer;
  weightsManifest: WeightsManifest;
}

export class Interpolator {
  private static supportsWebGPU(): boolean {
    return typeof navigator !== 'undefined' && 'gpu' in navigator;
  }

  private constructor(private readonly rt: RT) {}

  static async create(opts: InterpolatorOpts): Promise<Interpolator> {
    if (!Interpolator.supportsWebGPU()) {
      throw new Error(
        'WebGPU is not available in this browser. Use desktop Chrome or Edge and enable WebGPU.',
      );
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('No WebGPU adapter found. WebGPU may be disabled.');
    }

    const requiredFeatures = adapter.features.has('shader-f16')
      ? (['shader-f16'] as GPUFeatureName[])
      : [];

    const device = await adapter.requestDevice({ requiredFeatures });

    const rt = await createRT(device, {
      w: opts.width,
      h: opts.height,
      weightsBin: opts.weightsBin,
      weightsManifest: opts.weightsManifest,
    });

    return new Interpolator(rt);
  }

  /**
   * Interpolate the (factor-1) mids strictly between two RGBA8 frames.
   * Frames must be padded so w and h are multiples of 16.
   */
  async mids(a: Uint8Array, b: Uint8Array, factor: 2 | 4 | 8): Promise<Uint8Array[]> {
    const ts: number[] = [];
    const pitch = 1 / factor;
    for (let k = 1; k < factor; k++) ts.push(k * pitch);
    if (ts.length === 0) return [];

    const out = await this.rt.runMulti(new Uint8Array(a), new Uint8Array(b), ts);
    return out as Uint8Array[];
  }

  destroy(): void {
    this.rt.destroy();
  }
}