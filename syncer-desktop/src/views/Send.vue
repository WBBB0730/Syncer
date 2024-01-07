<template>
  <div class="target">
    <h1>{{ targetName }}</h1>
    <a-button @click="disconnect">断开连接</a-button>
    <ReceiveHistory />
  </div>

  <div class="white-list">
    <a-checkbox :checked="isInWhiteList" @change="setIsInWhiteList(!isInWhiteList)">自动接受此设备的连接请求</a-checkbox>
  </div>

  <a-segmented v-model:value="type" class="select-type" :options="[
    { value: 'text', label: '发送文本' },
    { value: 'file', label: '发送文件' },
    { value: 'command', label: '发送指令' },
  ]" />

  <div v-show="type === 'text'" class="send-text">
    <a-textarea v-model:value="text" class="input-text" allow-clear placeholder="请输入要发送的文本"
                :auto-size="{ minRows: 3, maxRows: 10 }" />
    <a-button type="primary" :loading="sendingText" @click="sendText">发送</a-button>
  </div>

  <div v-show="type === 'file'" class="send-file">
    <a-upload-dragger class="input-file" :file-list="files" multiple
                      :before-upload="handleSelectFile" @remove="handleRemoveFile">
      <PlusOutlined class="icon" />
      <div>拖拽或选择要发送的文件</div>
    </a-upload-dragger>
    <a-button class="send-file-button" type="primary" :loading="sendingFile" @click="sendFile">发送</a-button>
  </div>

  <div v-show="type === 'command' && store.state.target.device === 'mobile'" class="send-ring">
    <a-button type="primary" @click="sendRing">查找设备</a-button>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { sendTcpData } from '@/service/tcpService'
import { useStore } from 'vuex'
import { PlusOutlined } from '@ant-design/icons-vue'
import { fileToBase64 } from '@/utils/file'
import { message, Modal } from 'ant-design-vue'
import ReceiveHistory from '@/components/ReceiveHistory.vue'
import { getStorage, setStorage } from '@/utils/storage'

const store = useStore()

const targetName = computed(() => store.state.target?.name)
function disconnect() {
  sendTcpData({
    type: 'disconnect'
  })
  store.dispatch('disconnect')
}

const isInWhiteList = ref(false)
getIsInWhiteList()

function getIsInWhiteList() {
  const whiteList = getStorage('whiteList') || {}
  isInWhiteList.value = whiteList[store.state.target.uuid] === true
}

function setIsInWhiteList(isInWhiteList) {
  const whiteList = getStorage('whiteList') || {}
  if (isInWhiteList)
    whiteList[store.state.target.uuid] = true
  else
    delete whiteList[store.state.target.uuid]
  setStorage('whiteList', whiteList)
  getIsInWhiteList()
}

const type = ref('text')

const text = ref('')
const sendingText = ref(false)
async function sendText() {
  if (!text.value)
    return
  sendingText.value = true
  await sendTcpData({
    type: 'text',
    content: text.value,
  })
  sendingText.value = false
  text.value = ''
  message.success('发送成功')
}

const files = reactive([])
const sendingFile = ref(false)
function handleSelectFile(file) {
  files.push(file)
  console.log(file)
  return false
}
function handleRemoveFile(file) {
  files.splice(files.indexOf(file), 1)
}
async function sendFile() {
  if (!files.length)
    return
  sendingFile.value = true
  const list = []
  for (const file of files) {
    const data = (await fileToBase64(file)).split(',')[1]
    list.push({ name: file.name, data })
  }
  await sendTcpData({
    type: 'file',
    content: list,
  })
  sendingFile.value = false
  files.length = 0
  message.success('发送成功')
}

async function sendRing() {
  Modal.info({
    centered: true,
    icon: null,
    title: '正在查找',
    content: '设备正在响铃...',
    okText: '停止',
    onOk: async () => {
      await sendTcpData({
        type: 'ring',
        content: false,
      })
    },
  })
  await sendTcpData({
    type: 'ring',
    content: true,
  })
}

</script>

<style scoped lang="scss" src="@/styles/Send.scss" />
