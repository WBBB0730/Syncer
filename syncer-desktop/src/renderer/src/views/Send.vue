<template>
  <div class="target">
    <h1>{{ store.target?.name }}</h1>
    <a-button @click="disconnect">断开连接</a-button>
    <ReceiveHistory />
  </div>

  <div class="white-list">
    <a-checkbox :checked="isInWhiteList" @change="setIsInWhiteList(!isInWhiteList)">
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
import { onMounted, reactive, ref } from 'vue'
import { PlusOutlined } from '@ant-design/icons-vue'
import { message, Modal } from 'ant-design-vue'
import type { UploadFile } from 'ant-design-vue'
import ReceiveHistory from '../components/ReceiveHistory.vue'
import { fileToBase64 } from '../utils/file'
import { useAppStore } from '../stores/app'

const store = useAppStore()

const isInWhiteList = ref(false)
getIsInWhiteList()

async function getIsInWhiteList(): Promise<void> {
  if (!store.target) return
  const whiteList = await window.api.getWhiteList()
  isInWhiteList.value = whiteList[store.target.uuid] === true
}

async function setIsInWhiteList(next: boolean): Promise<void> {
  if (!store.target) return
  const whiteList = await window.api.getWhiteList()
  if (next) whiteList[store.target.uuid] = true
  else delete whiteList[store.target.uuid]
  await window.api.setWhiteList(whiteList)
  await getIsInWhiteList()
}

async function disconnect(): Promise<void> {
  await window.api.sendTcp({ type: 'disconnect' })
  await store.disconnect()
}

const type = ref('text')

const text = ref('')
const sendingText = ref(false)
async function sendText(): Promise<void> {
  if (!text.value) return
  sendingText.value = true
  await window.api.sendTcp({
    type: 'text',
    content: text.value
  })
  sendingText.value = false
  text.value = ''
  message.success('发送成功')
}

const files = reactive<UploadFile[]>([])
const sendingFile = ref(false)
function handleSelectFile(file: UploadFile): boolean {
  files.push(file)
  console.log(file)
  return false
}
function handleRemoveFile(file: UploadFile): void {
  files.splice(files.indexOf(file), 1)
}
async function sendFile(): Promise<void> {
  if (!files.length) return
  sendingFile.value = true
  const list: { name: string; data: string }[] = []
  for (const file of files) {
    const origin = file.originFileObj as File | undefined
    if (!origin) continue
    const data = (await fileToBase64(origin)).split(',')[1]
    list.push({ name: file.name, data })
  }
  await window.api.sendTcp({
    type: 'file',
    content: list
  })
  sendingFile.value = false
  files.length = 0
  message.success('发送成功')
}

async function sendRing(): Promise<void> {
  Modal.info({
    centered: true,
    icon: null,
    title: '正在查找',
    content: '设备正在响铃...',
    okText: '停止',
    onOk: async () => {
      await window.api.sendTcp({
        type: 'ring',
        content: false
      })
    }
  })
  await window.api.sendTcp({
    type: 'ring',
    content: true
  })
}

onMounted(() => {
  void getIsInWhiteList()
})
</script>

<style scoped lang="scss" src="../styles/Send.scss" />
