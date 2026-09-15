<template>
  <header>
    <h1>Framegen</h1>
    <p class="subtitle">
      AI frame interpolation in your browser. Drop a video and synthesize
      smoother in-between frames with RIFE on WebGPU — your file never leaves
      this device.
    </p>
  </header>

  <p v-if="!webgpu" class="warn card">
    WebGPU isn't available in this browser. Use the latest desktop
    <strong>Chrome</strong> or <strong>Edge</strong> (Safari/Firefox aren't
    supported yet).
  </p>

  <Dropzone :file="file" @file="onFile" />

  <div v-if="webgpu" class="controls card">
    <div class="field">
      <span class="label">Make it this smooth</span>
      <div class="factors">
        <button
          v-for="f in factors"
          :key="f"
          class="factor"
          :class="{ active: factor === f }"
          :disabled="phase === 'running'"
          :title="`Smoothness ×${f}: ${meta ? `${f * meta.fpsIn} fps instead of ${meta.fpsIn} fps` : '2, 4 or 8 times smoother'}`"
          @click="factor = f"
        >
          {{ meta ? `${f * meta.fpsIn} fps` : `${f}×` }}
        </button>
      </div>
    </div>
    <p v-if="meta" class="how">
      Your video is <strong>{{ meta.width }}×{{ meta.height }}</strong> at
      <strong>{{ meta.fpsIn }} fps</strong> ({{ meta.frames }} frames). The
      smoother the number, the more in-between frames the AI creates — the
      resolution never changes.
    </p>
    <button
      class="go"
      :disabled="!file || phase === 'running'"
      @click="start"
    >
      {{ phase === 'running' ? 'Processing…' : phase === 'done' ? 'Process again' : 'Start interpolation' }}
    </button>
    <button v-if="phase === 'running'" class="cancel" @click="cancel">Cancel</button>
  </div>

  <ProgressView v-if="phase === 'running'" :stage="stage" :pct="pct" :note="note" />

  <div v-if="phase === 'error'" class="error card">
    <strong>Something went wrong</strong>
    <p>{{ error }}</p>
    <p class="hint">Tips: use an H.264 MP4 ≤ 1080p, close other GPU-heavy tabs, and try a 2× factor.</p>
  </div>

  <ResultView v-if="phase === 'done' && result" :result="result" @reset="reset" />

  <footer>
    <p>
      Audio isn't preserved (video-only output) · scene cuts briefly freeze ·
      model weights are non-commercial ·
      <a href="https://github.com/NgoytryLyhuor/framegen" target="_blank" rel="noopener">source</a>
    </p>
  </footer>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import Dropzone from './components/Dropzone.vue';
import ProgressView from './components/ProgressView.vue';
import ResultView from './components/ResultView.vue';
import { FACTORS } from './lib/constants';
import type { OutputResult, ProcessRequest, WorkerResponse } from './lib/types';

type Phase = 'idle' | 'running' | 'done' | 'error';

const factors = FACTORS;
const webgpu = ref(false);
const file = ref<File | null>(null);
const factor = ref<2 | 4 | 8>(2);
const phase = ref<Phase>('idle');
const stage = ref<'decode' | 'interpolate' | 'encode'>('decode');
const pct = ref(0);
const note = ref('');
const error = ref('');
const result = ref<OutputResult | null>(null);
const meta = ref<{ width: number; height: number; fpsIn: number; fpsOut: number; frames: number } | null>(null);

let worker: Worker | null = null;
let objectUrl: string | null = null;

onMounted(() => {
  webgpu.value = typeof navigator !== 'undefined' && 'gpu' in navigator;
});

onUnmounted(() => {
  worker?.terminate();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
});

function onFile(f: File | null): void {
  file.value = f;
  meta.value = null;
  if (phase.value !== 'running') reset();
}

function reset(): void {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
  result.value = null;
  error.value = '';
  phase.value = 'idle';
  pct.value = 0;
  stage.value = 'decode';
  note.value = '';
}

async function start(): Promise<void> {
  if (!file.value) return;

  reset();
  phase.value = 'running';

  worker = new Worker(new URL('./worker/pipeline.worker.ts', import.meta.url), {
    type: 'module',
  });

  worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
    const msg = ev.data;
    switch (msg.type) {
      case 'progress':
        stage.value = msg.stage;
        pct.value = msg.pct;
        note.value = msg.note ?? '';
        break;
      case 'meta': {
        const m = msg;
        meta.value = { width: m.width, height: m.height, fpsIn: m.fpsIn, fpsOut: m.fpsOut, frames: m.frames };
        if (meta.value.fpsIn * factor.value > 240) factor.value = 2;
        if (!pct.value) pct.value = 1;
        break;
      }
      case 'done': {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = URL.createObjectURL(new Blob([msg.buffer], { type: 'video/mp4' }));
        const base = (file.value?.name ?? 'output').replace(/\.[^.]+$/, '');
        result.value = {
          url: objectUrl,
          fileName: `${base}_${msg.fpsOut}fps.mp4`,
          width: msg.width,
          height: msg.height,
          fpsIn: msg.fpsIn,
          fpsOut: msg.fpsOut,
          durationSec: msg.durationSec,
          framesIn: msg.framesIn,
          framesOut: msg.framesOut,
          sizeMb: msg.buffer.byteLength / 1048576,
        };
        phase.value = 'done';
        terminate();
        break;
      }
      case 'error':
        error.value = msg.message;
        phase.value = 'error';
        terminate();
        break;
    }
  };

  const req: ProcessRequest = {
    type: 'process',
    buffer: await file.value.arrayBuffer(),
    factor: factor.value,
    fileName: file.value.name,
  };
  worker.postMessage(req, [req.buffer]);
}

function terminate(): void {
  worker?.terminate();
  worker = null;
}

function cancel(): void {
  terminate();
  reset();
}
</script>

<style scoped>
header {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.warn {
  border-color: rgba(255, 107, 107, 0.4);
  background: rgba(255, 107, 107, 0.06);
  margin: 0;
  font-size: 14px;
}

.controls {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.source {
  font-size: 14px;
  color: var(--text);
  background: rgba(108, 140, 255, 0.08);
  border: 1px solid rgba(108, 140, 255, 0.25);
  border-radius: 10px;
  padding: 10px 12px;
}

.how {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.6;
}

.field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
}

.label {
  font-size: 13px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.factors {
  display: flex;
  gap: 8px;
}

.factor {
  width: 56px;
  padding: 8px 0;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  font-weight: 600;
}

.factor.active {
  color: #fff;
  background: linear-gradient(90deg, var(--accent), var(--accent-2));
  border-color: transparent;
}

.go {
  padding: 13px 16px;
  border-radius: 12px;
  border: none;
  background: linear-gradient(90deg, var(--accent), var(--accent-2));
  color: #fff;
  font-weight: 700;
  font-size: 15px;
}

.go:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.cancel {
  padding: 9px 16px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
}

.error {
  border-color: rgba(255, 107, 107, 0.4);
  background: rgba(255, 107, 107, 0.06);
}

.error p {
  margin: 6px 0 0;
  font-size: 14px;
  overflow-wrap: anywhere;
}

.error .hint {
  color: var(--muted);
  font-size: 13px;
}

footer p {
  color: var(--muted);
  font-size: 12px;
  text-align: center;
  line-height: 1.7;
}
</style>