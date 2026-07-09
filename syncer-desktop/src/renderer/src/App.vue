<template>
  <a-config-provider :theme="{ token: { colorPrimary: '#fa8c16' } }">
    <div class="app">
      <div class="page">
        <component :is="route" />
      </div>
    </div>
  </a-config-provider>
</template>

<script setup lang="ts">
import { computed, h, onMounted, onUnmounted } from 'vue'
import { Modal, message } from 'ant-design-vue'
import {
  DesktopOutlined,
  MobileOutlined,
  QuestionOutlined
} from '@ant-design/icons-vue'
import Connection from './views/Connection.vue'
import Send from './views/Send.vue'
import { useAppStore } from './stores/app'
import { notify } from './utils/notify'
import type { DeviceInfo } from '../../preload/index.d'

const store = useAppStore()
const unsubscribers: Array<() => void> = []

const route = computed(() => (store.status === 'connected' ? Send : Connection))

onMounted(async () => {
  await store.refresh()

  unsubscribers.push(
    window.api.onStateChanged((snapshot) => {
      store.applySnapshot(snapshot)
    })
  )

  unsubscribers.push(
    window.api.onAutoAccept(async (device: DeviceInfo) => {
      await store.accept(device)
      notify('连接成功', device.name)
    })
  )

  unsubscribers.push(
    window.api.onConnectRequest((device: DeviceInfo) => {
      notify('连接请求', device.name)
      Modal.confirm({
        centered: true,
        icon: null,
        title: '连接请求',
        content: h('div', { style: { display: 'flex', alignItems: 'center' } }, [
          h(
            device.device === 'desktop'
              ? DesktopOutlined
              : device.device === 'mobile'
                ? MobileOutlined
                : QuestionOutlined,
            { style: { marginRight: '8px', color: '#fa8c16', fontSize: '20px' } }
          ),
          `${device.name} 请求与你建立连接`
        ]),
        cancelText: '拒绝',
        okText: '接受',
        onCancel: () => {
          void store.refuse(device)
        },
        onOk: async () => {
          await store.accept(device)
        }
      })
    })
  )

  unsubscribers.push(
    window.api.onConnectRefused(async ({ name }) => {
      await store.cancel()
      Modal.info({
        centered: true,
        icon: null,
        title: '连接失败',
        content: `${name} 拒绝了你的连接请求`,
        okText: '确定'
      })
    })
  )

  unsubscribers.push(
    window.api.onTextReceived(({ content }) => {
      notify(store.target?.name ?? 'Syncer', '向你发送了一段文本')
      Modal.confirm({
        icon: null,
        title: '收到文本',
        content: h('div', { class: 'modal-content', style: 'white-space: break-spaces;' }, content),
        cancelText: '忽略',
        okText: '复制',
        centered: true,
        onOk: async () => {
          await navigator.clipboard.writeText(content)
        }
      })
    })
  )

  unsubscribers.push(
    window.api.onFileReceived(({ content }) => {
      notify(store.target?.name ?? 'Syncer', `向你发送了 ${content.length} 个文件`)
      Modal.confirm({
        icon: null,
        title: '收到文件',
        content: h(
          'div',
          {},
          content.map((file) =>
            h(
              'div',
              {
                style:
                  'margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;'
              },
              file.name
            )
          )
        ),
        cancelText: '忽略',
        okText: '保存',
        centered: true,
        onOk: async () => {
          const result = await window.api.saveFiles(content)
          if (!result) return Promise.reject('')
        }
      })
    })
  )

  unsubscribers.push(
    window.api.onConnectionLost(() => {
      message.error('连接中断')
    })
  )
})

onUnmounted(() => {
  unsubscribers.forEach((off) => off())
})
</script>

<style lang="scss" src="./styles/globals.scss" />
<style lang="scss">
@import './styles/theme';

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
