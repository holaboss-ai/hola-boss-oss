<script setup lang="ts">
defineProps<{
  title: string;
}>();
</script>

<template>
  <li class="hb-doc-step">
    <div class="hb-doc-step__title">{{ title }}</div>
    <div class="hb-doc-step__body">
      <slot />
    </div>
  </li>
</template>
