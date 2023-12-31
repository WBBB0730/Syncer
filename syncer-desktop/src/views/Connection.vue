<template>
  <div class="my-device-name">
    <template v-if="!editingName">
      <h1>{{ name }}</h1>
      <a-button type="text" @click="editName">
        <template #icon>
          <EditOutlined class="icon" />
        </template>
      </a-button>
      <ReceiveHistory />
    </template>

    <template v-else>
      <a-input ref="inputNameRef" v-model:value="inputName" class="input-name" @pressEnter="saveName" />
      <a-button type="text" @click="cancelEditName">
        <template #icon>
          <CloseOutlined class="icon" />
        </template>
      </a-button>
      <a-button type="text" @click="saveName">
        <template #icon>
          <CheckOutlined class="icon" />
        </template>
      </a-button>
    </template>
  </div>
  <div class="my-device-ip">{{ ipAddress }}</div>

  <div class="available-title">
    <div>可用设备</div>
    <a-button :loading="searching" @click="search">查找</a-button>
    <a-button :disabled="searching" @click="inputtingIpAddress = true">手动查找</a-button>
  </div>

  <a-modal v-model:open="inputtingIpAddress" centered :width="400" title="手动查找"
           cancel-text="取消" ok-text="查找" @ok="search">
    <a-input v-model:value="inputIpAddress" placeholder="请输入目标设备的IP地址" @pressEnter="search" />
  </a-modal>

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
import { computed, nextTick, ref } from 'vue'
import {
  DesktopOutlined,
  MobileOutlined,
  QuestionOutlined,
  EditOutlined,
  CheckOutlined,
  CloseOutlined
} from '@ant-design/icons-vue'
import sleep from '@/utils/sleep'
import { getIpAddress } from '@/utils/ip'
import ReceiveHistory from "@/components/ReceiveHistory.vue";

const store = useStore()

const name = computed(() => store.state.name)
const editingName = ref(false)
const inputName = ref('')
const inputNameRef = ref(null)

function editName() {
  editingName.value = true
  inputName.value = name.value
  nextTick(() => {
    inputNameRef.value.focus()
  })
}

function cancelEditName() {
  editingName.value = false
}

function saveName() {
  if (!inputName.value)
    return
  store.commit('setName', inputName.value)
  editingName.value = false
}

const ipAddress = ref(getIpAddress())

const searching = ref(false)
const inputtingIpAddress = ref(false)
const inputIpAddress = ref('')

/** 查找同一局域网内的设备 */
async function search() {
  const ipAddress = /^(\d{1,3}\.){3}\d{1,3}$/.test(inputIpAddress.value) && inputIpAddress.value
  inputtingIpAddress.value = false
  store.commit('clearAvailableDeviceMap')

  searching.value = true
  for (let i = 0; i < 5; i++) {
    sendUdpData({ type: 'search' }, 5742, '255.255.255.255')
    if (ipAddress)
      sendUdpData({ type: 'search' }, 5742, ipAddress)
    await sleep(500)
  }
  searching.value = false
}

const availableDeviceList = computed(() => {
  const availableDeviceList = []
  const availableDeviceMap = store.state.availableDeviceMap
  for (const uuid of availableDeviceMap.keys())
    availableDeviceList.push({ ...availableDeviceMap.get(uuid) })
  return availableDeviceList
})

const connecting = computed(() => store.state.status === 'connecting')
const target = computed(() => store.state.target)

/** 发起连接请求 */
async function connect(device) {
  await store.dispatch('connect', device)
}

search()

</script>

<style lang="scss" scoped src="@/styles/Connection.scss" />
