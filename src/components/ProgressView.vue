<template>
  <div class="progress card">
    <div class="row">
      <span class="stage">{{ stageLabel }}</span>
      <span class="pct">{{ Math.floor(pct) }}%</span>
    </div>
    <div class="bar" role="progressbar" :aria-valuenow="pct" aria-valuemin="0" aria-valuemax="100">
      <div class="fill" :style="{ width: pct + '%' }"></div>
    </div>
    <p v-if="note" class="note">{{ note }}</p>
    <p class="hint">Everything runs locally on your GPU — keep this tab focused and your machine awake.</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  stage: 'decode' | 'interpolate' | 'encode';
  pct: number;
  note?: string;
}>();

const stageLabel = computed(
  () =>
    ({ decode: 'Decoding source', interpolate: 'Generating frames (RIFE)', encode: 'Encoding result' })[
      props.stage
    ],
);
</script>

<style scoped>
.row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 10px;
  font-size: 14px;
  font-weight: 600;
}

.pct {
  color: var(--accent);
}

.bar {
  height: 8px;
  border-radius: 99px;
  background: var(--border);
  overflow: hidden;
}

.fill {
  height: 100%;
  border-radius: 99px;
  background: linear-gradient(90deg, var(--accent), var(--accent-2));
  transition: width 0.25s ease;
}

.note {
  color: var(--text);
  margin: 12px 0 0;
  font-size: 14px;
}

.hint {
  color: var(--muted);
  margin: 6px 0 0;
  font-size: 13px;
}
</style>