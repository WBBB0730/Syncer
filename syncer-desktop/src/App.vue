<template>
  <a-config-provider :theme="{ token: { colorPrimary: '#fa8c16' } }">
    <div class="app">
      <div class="page">
        <component :is="route" />
      </div>
    </div>
  </a-config-provider>
</template>

<script setup>
import { computed } from 'vue'
import Connection from '@/views/Connection.vue'
import Send from '@/views/Send.vue'
import { useStore } from 'vuex'

const store = useStore()

const route = computed(() => {
    return store.state.status === 'connected' ? Send : Connection
})


</script>

<style lang="scss" src="@/styles/globals.scss" />
<style lang="scss">
@import "@/styles/theme";

.app {
  display: flex;
  width: 100vw;
  height: 100vh;
  //color: $main-text-color;
  font-size: 14px;
  user-select: none;
}

.page {
  flex-grow: 1;
  padding: 32px;
  height: 100vh;
  overflow: auto;
}

</style>
