<script setup lang="ts">
defineProps<{
  steps: { label: string; detail: string }[];
}>();
</script>

<template>
  <div class="hb-diagram-flow">
    <div class="hb-diagram-flow__grid">
      <div
        v-for="(step, i) in steps"
        :key="i"
        class="hb-diagram-flow__cell"
      >
        <div class="hb-diagram-flow__number">{{ i + 1 }}</div>
        <div class="hb-diagram-flow__content">
          <span class="hb-diagram-flow__label">{{ step.label }}</span>
          <span class="hb-diagram-flow__detail">{{ step.detail }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hb-diagram-flow {
  margin: 24px 0;
  border: 1px solid var(--vp-c-divider);
  border-radius: 16px;
  background: var(--vp-c-bg-soft);
  padding: 24px;
}

.hb-diagram-flow__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.hb-diagram-flow__cell {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg);
  transition: border-color 0.15s;
}

.hb-diagram-flow__cell:hover {
  border-color: var(--vp-c-brand-1);
}

.hb-diagram-flow__number {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.hb-diagram-flow__content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.hb-diagram-flow__label {
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.hb-diagram-flow__detail {
  font-size: 12px;
  color: var(--vp-c-text-3);
}
</style>
