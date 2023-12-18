<template>
  <div class="connection-title">
    <h1>连接成功！</h1>
    <a-button @click="disconnect">断开连接</a-button>
  </div>
  <a-segmented v-model:value="type" :options="[
    { value: 'text', label: '发送文本' },
    { value: 'image', label: '发送图片' },
    { value: 'file', label: '发送文件' },
  ]" />
  <div v-show="type === 'text'">
    <a-textarea v-model:value="text" allow-clear :auto-size="{ minRows: 3 }" />
    <a-button type="primary" @click="sendText">发送</a-button>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { sendTcpData } from '@/service/tcpService'
import { useStore } from 'vuex'

const store = useStore()

function disconnect() {
  sendTcpData({
    type: 'disconnect'
  })
  store.dispatch('disconnect')
}

const type = ref('text')

const text = ref('')
function sendText() {
  if (!text.value)
    return
  sendTcpData({
    type: 'text',
    content: text.value,
  })
}

</script>

<style scoped lang="scss">
.connection-title {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}
</style>
