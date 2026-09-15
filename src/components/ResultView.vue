<template>
  <div class="result">
    <div class="card">
      <video :src="result.url" controls muted playsinline autoplay loop></video>
      <div class="stats">
        <div class="key">
          <span class="label">Frames</span>
          <span class="value">{{ result.framesIn }} → {{ result.framesOut }}</span>
        </div>
        <div class="key">
          <span class="label">Frame rate</span>
          <span class="value">{{ result.fpsIn }} → {{ result.fpsOut }} fps</span>
        </div>
        <div class="key">
          <span class="label">Resolution</span>
          <span class="value">{{ result.width }} × {{ result.height }}</span>
        </div>
        <div class="key">
          <span class="label">Duration</span>
          <span class="value">{{ result.durationSec.toFixed(1) }} s</span>
        </div>
        <div class="key">
          <span class="label">File size</span>
          <span class="value">{{ result.sizeMb.toFixed(1) }} MB</span>
        </div>
      </div>
      <a class="download" :href="result.url" :download="result.fileName">Download {{ result.fileName }}</a>
      <p class="hint">Preview plays on loop; the download has no audio (processing is video-only).</p>
    </div>
    <button class="again" @click="emit('reset')">Interpolate another video</button>
  </div>
</template>

<script setup lang="ts">
import type { OutputResult } from '../lib/types';

defineProps<{ result: OutputResult }>();
const emit = defineEmits<{ (e: 'reset'): void }>();
</script>

<style scoped>
.result {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

video {
  width: 100%;
  border-radius: 10px;
  background: #000;
  max-height: 420px;
}

.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
  margin: 16px 0;
}

.key {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.label {
  font-size: 12px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.value {
  font-size: 15px;
  font-weight: 600;
}

.download {
  display: block;
  text-align: center;
  padding: 12px 16px;
  border-radius: 12px;
  background: linear-gradient(90deg, var(--accent), var(--accent-2));
  color: #fff;
  font-weight: 600;
  text-decoration: none;
  transition: filter 0.15s;
}

.download:hover {
  filter: brightness(1.08);
}

.hint {
  color: var(--muted);
  font-size: 13px;
  margin: 12px 0 0;
  text-align: center;
}

.again {
  padding: 11px 18px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  transition: border-color 0.15s;
}

.again:hover {
  border-color: var(--accent);
}
</style>