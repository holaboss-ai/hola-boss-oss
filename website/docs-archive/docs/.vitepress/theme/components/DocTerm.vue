<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

defineProps<{
  term: string;
  href: string;
  hint: string;
}>();

const isOpen = ref(false);
const root = ref<HTMLElement | null>(null);

function closeIfOutside(event: MouseEvent) {
  if (!root.value) {
    return;
  }

  const target = event.target;
  if (target instanceof Node && !root.value.contains(target)) {
    isOpen.value = false;
  }
}

onMounted(() => {
  document.addEventListener("click", closeIfOutside);
});

onBeforeUnmount(() => {
  document.removeEventListener("click", closeIfOutside);
});
</script>

<template>
  <span
    ref="root"
    class="hb-doc-term"
    @mouseenter="isOpen = true"
    @mouseleave="isOpen = false"
  >
    <button
      type="button"
      class="hb-doc-term__trigger"
      :aria-expanded="isOpen"
      :aria-label="`Review definition for ${term}`"
      @click.stop="isOpen = !isOpen"
    >
      <slot>{{ term }}</slot>
    </button>

    <span v-if="isOpen" class="hb-doc-term__popover" role="tooltip">
      <span class="hb-doc-term__label">{{ term }}</span>
      <span class="hb-doc-term__hint">{{ hint }}</span>
      <a :href="href" class="hb-doc-term__link">Jump to definition</a>
    </span>
  </span>
</template>

<style scoped>
.hb-doc-term {
  position: relative;
  display: inline-flex;
  vertical-align: baseline;
}

.hb-doc-term__trigger {
  border: 0;
  border-bottom: 1px dotted var(--vp-c-brand-1);
  background: transparent;
  color: var(--vp-c-brand-1);
  cursor: pointer;
  font: inherit;
  line-height: inherit;
  padding: 0;
}

.hb-doc-term__trigger:hover,
.hb-doc-term__trigger:focus-visible {
  color: var(--vp-c-brand-2);
  outline: none;
}

.hb-doc-term__popover {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 20;
  display: flex;
  width: min(280px, calc(100vw - 48px));
  flex-direction: column;
  gap: 8px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-elv);
  box-shadow: 0 16px 40px rgb(0 0 0 / 16%);
  padding: 12px;
}

.hb-doc-term__label {
  color: var(--vp-c-text-1);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.4;
}

.hb-doc-term__hint {
  color: var(--vp-c-text-2);
  font-size: 12px;
  line-height: 1.5;
}

.hb-doc-term__link {
  color: var(--vp-c-brand-1);
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
}

.hb-doc-term__link:hover {
  text-decoration: underline;
}
</style>
