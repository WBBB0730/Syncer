<template>
  <div class="target">
    <h1>{{ store.target?.name }}</h1>
    <a-button @click="disconnect">断开连接</a-button>
    <ReceiveHistory />
  </div>

  <div class="whitelist">
    <a-checkbox :checked="isInWhitelist" @change="setIsInWhitelist(!isInWhitelist)">
      自动接受此设备的连接请求
    </a-checkbox>
  </div>

  <a-segmented
    v-model:value="type"
    class="select-type"
    :options="[
      { value: 'text', label: '发送文本' },
      { value: 'file', label: '发送文件' },
      { value: 'command', label: '发送指令' }
    ]"
  />

  <div v-show="type === 'text'" class="send-text">
    <a-textarea
      v-model:value="text"
      class="input-text"
      allow-clear
      placeholder="请输入要发送的文本"
      :auto-size="{ minRows: 3, maxRows: 10 }"
    />
    <a-button type="primary" :loading="sendingText" @click="sendText">发送</a-button>
  </div>

  <div v-show="type === 'file'" class="send-file">
    <a-upload-dragger
      class="input-file"
      :file-list="files"
      multiple
      :before-upload="handleSelectFile"
      @remove="handleRemoveFile"
    >
      <PlusOutlined class="icon" />
      <div>拖拽或选择要发送的文件</div>
    </a-upload-dragger>
    <a-button class="send-file-button" type="primary" :loading="sendingFile" @click="sendFile">
      发送
    </a-button>
  </div>

  <div v-show="type === 'command' && store.target?.device === 'mobile'" class="send-ring">
    <a-button type="primary" @click="sendRing">查找设备</a-button>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { PlusOutlined } from '@ant-design/icons-vue'
import { message, Modal } from 'ant-design-vue'
import type { UploadFile, UploadProps } from 'ant-design-vue'
import ReceiveHistory from '../components/ReceiveHistory.vue'
import { useAppStore } from '../stores/app'
import { performAction } from '../utils/action'

const store = useAppStore()
let findDeviceModal: ReturnType<typeof Modal.info> | null = null

const isInWhitelist = ref(false)

async function getIsInWhitelist(): Promise<void> {
  if (!store.target) return
  const target = store.target
  await performAction(async () => {
    isInWhitelist.value = await window.api.isDeviceWhitelisted(target.uuid)
  }, '读取白名单失败')
}

async function setIsInWhitelist(next: boolean): Promise<void> {
  if (!store.target) return
  const target = store.target
  if (
    await performAction(() => window.api.setDeviceWhitelisted(target.uuid, next), '更新白名单失败')
  ) {
    isInWhitelist.value = next
  }
}

async function disconnect(): Promise<void> {
  await performAction(() => store.endSession(), '断开连接失败')
}

const type = ref('text')

const text = ref('')
const sendingText = ref(false)
async function sendText(): Promise<void> {
  if (!text.value) return
  sendingText.value = true
  try {
    if (await performAction(() => window.api.sendText(text.value), '发送文本失败')) {
      text.value = ''
      message.success('发送成功')
    }
  } finally {
    sendingText.value = false
  }
}

const files = ref<UploadFile[]>([])
const sendingFile = ref(false)
type UploadSourceFile = Parameters<NonNullable<UploadProps['beforeUpload']>>[0]

function handleSelectFile(file: UploadSourceFile): boolean {
  files.value.push({
    uid: file.uid,
    name: file.name,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
    lastModifiedDate: file.lastModifiedDate,
    originFileObj: file
  })
  return false
}
function handleRemoveFile(file: UploadFile): void {
  const index = files.value.findIndex((item) => item.uid === file.uid)
  if (index >= 0) files.value.splice(index, 1)
}
async function sendFile(): Promise<void> {
  if (!files.value.length) return
  sendingFile.value = true
  try {
    const selectedFiles = files.value.flatMap((file) =>
      file.originFileObj ? [file.originFileObj] : []
    )
    if (!selectedFiles.length) return
    if (await performAction(() => window.api.sendFiles(selectedFiles), '发送文件失败')) {
      files.value.length = 0
      message.success('发送成功')
    }
  } finally {
    sendingFile.value = false
  }
}

async function sendRing(): Promise<void> {
  if (!(await performAction(() => window.api.setFindDeviceActive(true), '启动查找设备失败'))) {
    return
  }
  findDeviceModal?.destroy()
  findDeviceModal = Modal.info({
    centered: true,
    icon: null,
    title: '正在查找',
    content: '设备正在响铃...',
    okText: '停止',
    onOk: (close) => {
      void performAction(() => window.api.setFindDeviceActive(false), '停止查找设备失败').then(
        (succeeded) => {
          if (succeeded) {
            findDeviceModal = null
            close()
          }
        }
      )
    }
  })
}

onMounted(() => {
  void getIsInWhitelist()
})

onUnmounted(() => {
  findDeviceModal?.destroy()
  findDeviceModal = null
})
</script>

<style scoped lang="scss" src="../styles/Send.scss" />
