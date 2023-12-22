<template>
  <div class="target">
    <h1>{{ targetName }}</h1>
    <a-button @click="disconnect">断开连接</a-button>
  </div>
  <a-segmented v-model:value="type" class="select-type" :options="[
    { value: 'text', label: '发送文本' },
    { value: 'file', label: '发送文件' },
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
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { sendTcpData } from '@/service/tcpService'
import { useStore } from 'vuex'
import { PlusOutlined } from '@ant-design/icons-vue'
import { fileToBase64, randomFileName } from '@/utils/file'

const store = useStore()

const targetName = computed(() => store.state.target?.name)
function disconnect() {
  sendTcpData({
    type: 'disconnect'
  })
  store.dispatch('disconnect')
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
    list.push({ name: randomFileName(file.name), data })
  }
  await sendTcpData({
    type: 'file',
    content: list,
  })
  sendingFile.value = false
  files.length = 0
}

</script>

<style scoped lang="scss" src="@/styles/Send.scss" />
