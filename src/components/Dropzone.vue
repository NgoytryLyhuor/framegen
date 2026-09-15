<template>
  <div class="dropzone" :class="{ dragging, over }" @dragover.prevent="onDragover" @dragleave="onDragleave" @drop.prevent="onDrop" @click="onClick">
    <input ref="input" type="file" accept="video/mp4,video/quicktime,.mp4,.mov" hidden @change="onPick" />
    <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
      <path d="M3 12h4l2-5 3 10 2.5-6 1.5 1H21" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
    <p class="primary">{{ file ? file.name : dragHint }}</p>
    <p class="hint">
      {{ file ? `${(file.size / 1048576).toFixed(1)} MB` : 'or click to browse' }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{ file: File | null }>();
const emit = defineEmits<{ (e: 'file', f: File | null): void }>();

const input = ref<HTMLInputElement | null>(null);
const dragging = ref(false);
const over = ref(false);

const dragHint = 'Drop an MP4 video here';

function pick(f: File | null): void {
  if (f && f.type && !f.type.startsWith('video/')) {
    emit('file', null);
    return;
  }
  emit('file', f);
}

function onPick(e: Event): void {
  const t = e.target as HTMLInputElement;
  pick(t.files?.[0] ?? null);
  if (input.value) input.value.value = '';
}

function onDragover(e: DragEvent): void {
  dragging.value = true;
  over.value = true;
  void e;
}

function onDragleave(): void {
  over.value = false;
}

function onDrop(e: DragEvent): void {
  over.value = false;
  dragging.value = false;
  pick(e.dataTransfer?.files?.[0] ?? null);
}

function onClick(): void {
  input.value?.click();
}
</script>

<style scoped>
.dropzone {
  border: 1.5px dashed var(--border);
  border-radius: 16px;
  padding: 36px 20px;
  text-align: center;
  cursor: pointer;
  color: var(--muted);
  transition: border-color 0.2s, background 0.2s, transform 0.1s;
}

.dropzone:hover,
.dropzone.dragging,
.dropzone.over {
  border-color: var(--accent);
  background: rgba(108, 140, 255, 0.06);
}

.dropzone:active {
  transform: scale(0.995);
}

.dropzone svg {
  color: var(--accent);
  margin-bottom: 8px;
}

.primary {
  margin: 0;
  color: var(--text);
  font-weight: 600;
  font-size: 15px;
  word-break: break-all;
}

.hint {
  margin: 4px 0 0;
  font-size: 13px;
}
</style>