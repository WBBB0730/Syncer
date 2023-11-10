<template>
  <div class="my-device-name">
    <h1>{{ name }}</h1>
    <a-button type="text">
      <template #icon>
        <EditOutlined class="edit" />
      </template>
    </a-button>
  </div>

  <div class="available-title">
    <div>可用设备</div>
    <a-button :loading="searching" @click="search">查找</a-button>
  </div>
  <div class="available-devices">
    <a-card v-for="device in availableDeviceList" :key="device.uuid" hoverable>
      <div class="available-device">
        <div class="left">
          <DesktopOutlined v-if="device.device === 'desktop'" />
          <MobileOutlined v-else-if="device.device === 'mobile'" />
          <QuestionOutlined v-else />
        </div>
        <div class="middle">
          <div class="device-name">{{ device.name }}</div>
          <div class="device-address">{{ device.address }}</div>
        </div>
        <a-button class="right" type="primary" ghost shape="round" @click="connect(device)">连接</a-button>
      </div>
    </a-card>
    <div class="tip">请确保设备已连接至同一个 Wi-Fi 网络</div>
  </div>

  <!-- 正在连接 -->
  <a-modal :open="connecting" centered :width="400" title="正在连接" :closable="false">
    <template #footer>
      <a-button type="primary" ghost @click="store.dispatch('cancel')">取消</a-button>
    </template>
    等待 {{ target ? target.name : '' }} 接受连接请求<a-spin class="text-loading" size="small" />
  </a-modal>
</template>

<script setup>
import { sendUdpData } from '@/service/udpService'
import { useStore } from 'vuex'
import { computed, ref } from 'vue'
import { DesktopOutlined, MobileOutlined, QuestionOutlined, EditOutlined } from '@ant-design/icons-vue'
import sleep from '@/utils/sleep'

const store = useStore()
const name = computed(() => store.state.name)

const availableDeviceList = computed(() => {
  const availableDeviceList = []
  const availableDeviceMap = store.state.availableDeviceMap
  for (const uuid of availableDeviceMap.keys())
    availableDeviceList.push({ ...availableDeviceMap.get(uuid) })
  return availableDeviceList
})

const searching = ref(false)


/** 查找同一局域网内的设备 */
async function search() {
  store.commit('clearAvailableDeviceMap')

  searching.value = true
  for (let i = 0; i < 5; i++) {
    // sendUdpData({ type: 'find' }, 5742, '239.57.42.42')
    sendUdpData({ type: 'search' }, 5742, '255.255.255.255')
    await sleep(500)
  }
  searching.value = false
}

const connecting = computed(() => store.state.status === 'connecting')
const target = computed(() => store.state.target)

/** 发起连接请求 */
async function connect(device) {
  await store.dispatch('connect', device)
}

search()

</script>

<style lang="scss" scoped src="@/styles/Connections.scss" />
