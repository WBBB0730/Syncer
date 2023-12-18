<template>
  <a-config-provider :theme="{ token: { colorPrimary: '#fa8c16' } }">
    <div class="app">
      <a-menu class="nav" :selected-keys="[routeName]" :items="[
        { key: 'connections', icon: () => h(WifiOutlined), label: '连接' },
        // { key: 'settings', icon: () => h(SettingOutlined), label: '设置' },
      ]" @click="handleSwitchTab" />
      <div class="page">
        <keep-alive>
          <component :is="route" />
        </keep-alive>
      </div>
      <!--<router-view class="page" />-->
    </div>
  </a-config-provider>
</template>

<script setup>
import { computed, h } from 'vue'
import { SettingOutlined, WifiOutlined } from '@ant-design/icons-vue'
import Connections from '@/views/Connections.vue'
import Connection from '@/views/Connection.vue'
import Settings from '@/views/Settings.vue'
import { useStore } from 'vuex'

const store = useStore()

const routeName = computed(() => store.state.route)
const route = computed(() => {
  switch (routeName.value) {
    case 'connections':
      return store.state.status === 'connected' ? Connection : Connections
    case 'settings':
      return Settings
    default:
      return Connections
  }
})

function handleSwitchTab({ key }) {
  store.commit('setRoute', key)
}


</script>

<style lang="scss">
@import "@/styles/themes";

.app {
  display: flex;
  width: 100vw;
  height: 100vh;
  //color: $main-text-color;
  font-size: 14px;
  user-select: none;
}

.nav {
  width: 184px;
  padding: 8px;
}

.page {
  flex-grow: 1;
  padding: 32px;
  height: 100vh;
  overflow: auto;
}

</style>
