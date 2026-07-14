<template>
  <div class="my-device-name">
    <template v-if="!editingName">
      <h1>{{ store.name }}</h1>
      <a-button type="text" @click="editName">
        <template #icon>
          <EditOutlined class="icon" />
        </template>
      </a-button>
      <ReceiveHistory />
    </template>

    <template v-else>
      <a-input
        ref="inputNameRef"
        v-model:value="inputName"
        class="input-name"
        :maxlength="255"
        @press-enter="saveName"
      />
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
    <a-button :loading="searching" @click="search()">查找</a-button>
    <a-button :disabled="searching" @click="inputtingIpAddress = true">手动查找</a-button>
  </div>

  <a-modal
    v-model:open="inputtingIpAddress"
    centered
    :width="400"
    title="手动查找"
    cancel-text="取消"
    ok-text="查找"
    @ok="manualSearch"
  >
    <a-input
      v-model:value="inputIpAddress"
      placeholder="请输入目标设备的IP地址"
      @press-enter="manualSearch"
    />
  </a-modal>

  <div class="available-devices">
    <a-card v-for="device in store.availableDevices" :key="device.uuid" hoverable>
      <div class="available-device">
        <div class="left">
          <DesktopOutlined v-if="device.device === 'desktop'" />
          <MobileOutlined v-else-if="device.device === 'mobile'" />
          <QuestionOutlined v-else />
        </div>
        <div class="middle">
          <div class="device-name">{{ device.name }}</div>
          <div class="device-address">
            {{ device.endpoints.map(({ address }) => address).join(' / ') }}
          </div>
        </div>
        <a-button class="right" type="primary" ghost shape="round" @click="requestSession(device)">
          连接
        </a-button>
      </div>
    </a-card>
    <div class="tip">请确保设备已连接至同一个 Wi-Fi 网络</div>
  </div>

  <!-- 正在连接 -->
  <a-modal :open="store.connecting" centered :width="400" title="正在连接" :closable="false">
    <template #footer>
      <a-button type="primary" ghost @click="cancelConnectionRequest">取消</a-button>
    </template>
    等待 {{ store.target ? store.target.name : '' }} 接受连接请求
    <a-spin class="text-loading" size="small" />
  </a-modal>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import {
  CheckOutlined,
  CloseOutlined,
  DesktopOutlined,
  EditOutlined,
  MobileOutlined,
  QuestionOutlined
} from '@ant-design/icons-vue'
import ReceiveHistory from '../components/ReceiveHistory.vue'
import { useAppStore } from '../stores/app'
import type { AvailableDevice } from '../../../shared/contracts'
import { performAction } from '../utils/action'

const store = useAppStore()

const editingName = ref(false)
const inputName = ref('')
const inputNameRef = ref<{ focus: () => void } | null>(null)
const ipAddress = ref('')
const searching = ref(false)
const inputtingIpAddress = ref(false)
const inputIpAddress = ref('')

function editName(): void {
  editingName.value = true
  inputName.value = store.name
  nextTick(() => {
    inputNameRef.value?.focus()
  })
}

function cancelEditName(): void {
  editingName.value = false
}

async function saveName(): Promise<void> {
  if (!inputName.value) return
  if (await performAction(() => store.setDeviceName(inputName.value), '保存设备名称失败')) {
    editingName.value = false
  }
}

async function search(manualIp?: string): Promise<void> {
  searching.value = true
  try {
    await performAction(async () => {
      ipAddress.value = await window.api.getIpAddress()
      await store.discoverDevices(manualIp)
    }, '查找设备失败')
  } finally {
    searching.value = false
  }
}

function manualSearch(): void {
  inputtingIpAddress.value = false
  void search(inputIpAddress.value)
}

async function requestSession(device: AvailableDevice): Promise<void> {
  await performAction(() => store.requestSession(device), '连接设备失败')
}

async function cancelConnectionRequest(): Promise<void> {
  await performAction(() => store.cancelConnectionRequest(), '取消连接失败')
}

onMounted(async () => {
  await store.whenReady()
  await search()
})
</script>

<style scoped lang="scss" src="../styles/Connection.scss" />
