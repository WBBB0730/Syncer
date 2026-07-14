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
import { computed, h, onMounted, onUnmounted, watch } from 'vue'
import { Modal, message } from 'ant-design-vue'
import { DesktopOutlined, MobileOutlined, QuestionOutlined } from '@ant-design/icons-vue'
import type {
  LegacyLocalStorageValues,
  ReceivedFileBatch,
  SaveFilesResult
} from '../../shared/contracts'
import Connection from './views/Connection.vue'
import Send from './views/Send.vue'
import { useAppStore } from './stores/app'
import { notify } from './utils/notify'
import { performAction } from './utils/action'

const store = useAppStore()
const unsubscribers: Array<() => void> = []
const openReceiptIds = new Set<string>()
const fileModals = new Map<string, ReturnType<typeof Modal.confirm>>()
let connectionRequestModal: ReturnType<typeof Modal.confirm> | null = null
let shownConnectionRequestId: string | null = null

const route = computed(() => (store.status === 'connected' ? Send : Connection))

watch(
  () => store.connectionRequest,
  (request) => {
    if (!request) {
      shownConnectionRequestId = null
      connectionRequestModal?.destroy()
      connectionRequestModal = null
      return
    }
    if (shownConnectionRequestId === request.requestId) return

    shownConnectionRequestId = request.requestId
    connectionRequestModal?.destroy()
    const { device, requestId } = request
    notify('连接请求', device.name)
    connectionRequestModal = Modal.confirm({
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
      onCancel: (close) => {
        void performAction(() => store.refuseConnectionRequest(requestId), '拒绝连接请求失败').then(
          (succeeded) => {
            if (succeeded) close()
          }
        )
      },
      onOk: (close) => {
        void performAction(() => store.acceptConnectionRequest(requestId), '接受连接请求失败').then(
          (succeeded) => {
            if (succeeded) close()
          }
        )
      }
    })
  }
)

function renderReceivedFiles(batch: ReceivedFileBatch): ReturnType<typeof h> {
  const files = [
    ...batch.content.map((file) => ({ ...file, historyPending: false })),
    ...batch.historyPending.map((file) => ({ ...file, historyPending: true }))
  ]
  return h(
    'div',
    { style: { maxHeight: '50vh', overflowY: 'auto' } },
    files.map((file) =>
      h(
        'div',
        {
          style: {
            marginBottom: '4px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }
        },
        file.historyPending ? `${file.name}（已保存，接收历史待更新）` : file.name
      )
    )
  )
}

function resetReceiptButtons(modal: ReturnType<typeof Modal.confirm>): void {
  modal.update({
    okButtonProps: { loading: false, disabled: false },
    cancelButtonProps: { loading: false, disabled: false }
  })
}

function showReceivedFiles(initialBatch: ReceivedFileBatch, notifyUser: boolean): void {
  if (openReceiptIds.has(initialBatch.receiptId)) return
  if (initialBatch.content.length === 0 && initialBatch.historyPending.length === 0) return

  const { receiptId } = initialBatch
  let batch = initialBatch
  let busy = false
  openReceiptIds.add(receiptId)
  if (notifyUser) {
    notify(store.target?.name ?? 'Syncer', `向你发送了 ${batch.content.length} 个文件`)
  }

  const closeReceipt = (close: () => void): void => {
    openReceiptIds.delete(receiptId)
    fileModals.delete(receiptId)
    close()
  }

  const modal = Modal.confirm({
    icon: null,
    title: '收到文件',
    content: renderReceivedFiles(batch),
    cancelText: '忽略',
    okText: '保存',
    centered: true,
    onCancel: (close) => {
      if (busy) return
      busy = true
      modal.update({
        okButtonProps: { disabled: true },
        cancelButtonProps: { loading: true }
      })
      void performAction(() => window.api.discardReceivedFiles(receiptId), '忽略接收文件失败').then(
        (succeeded) => {
          busy = false
          if (succeeded) closeReceipt(close)
          else resetReceiptButtons(modal)
        }
      )
    },
    onOk: (close) => {
      if (busy) return
      busy = true
      modal.update({
        okButtonProps: { loading: true },
        cancelButtonProps: { disabled: true }
      })
      let result: SaveFilesResult | null = null
      void performAction(async () => {
        result = await window.api.saveReceivedFiles(receiptId)
      }, '保存文件失败').then((succeeded) => {
        busy = false
        if (!succeeded) {
          resetReceiptButtons(modal)
          return
        }
        if (result?.complete) {
          closeReceipt(close)
          return
        }

        resetReceiptButtons(modal)
        if (!result) return
        batch = {
          receiptId,
          content: result.remaining,
          historyPending: result.historyPending
        }
        modal.update({ content: renderReceivedFiles(batch) })
        if (result.remaining.length > 0 && result.historyPending.length > 0) {
          message.warning(
            `已保存 ${result.count} 个文件（接收历史待更新），剩余 ${result.remaining.length} 个可重试`
          )
        } else if (result.remaining.length > 0) {
          message.warning(`已保存 ${result.count} 个文件，剩余 ${result.remaining.length} 个可重试`)
        } else if (result.historyPending.length > 0) {
          message.warning('文件已保存，但接收历史尚未更新，可重试')
        }
      })
    }
  })
  fileModals.set(receiptId, modal)
}

function readLegacyLocalStorage(): LegacyLocalStorageValues {
  return {
    name: localStorage.getItem('name'),
    uuid: localStorage.getItem('uuid'),
    whitelist: localStorage.getItem('whiteList'),
    receiveHistory: localStorage.getItem('receiveHistory'),
    filePath: localStorage.getItem('filePath')
  }
}

onMounted(async () => {
  unsubscribers.push(
    window.api.onStateChanged((snapshot) => {
      store.applySnapshot(snapshot)
    })
  )

  unsubscribers.push(
    window.api.onWhitelistSessionAccepted(({ name }) => {
      notify('连接成功', name)
    })
  )

  unsubscribers.push(
    window.api.onConnectionRefused(({ name }) => {
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
        onOk: (close) => {
          void performAction(() => navigator.clipboard.writeText(content), '复制文本失败').then(
            (succeeded) => {
              if (succeeded) close()
            }
          )
        }
      })
    })
  )

  unsubscribers.push(
    window.api.onFileReceived((batch) => {
      showReceivedFiles(batch, true)
    })
  )

  unsubscribers.push(
    window.api.onConnectionLost(() => {
      message.error('连接中断')
    })
  )

  if (
    !(await performAction(() => store.initialize(readLegacyLocalStorage()), '加载应用状态失败'))
  ) {
    return
  }
  let pendingReceipts: ReceivedFileBatch[] = []
  if (
    await performAction(async () => {
      pendingReceipts = await window.api.getPendingReceivedFiles()
    }, '恢复待处理文件失败')
  ) {
    pendingReceipts.forEach((batch) => showReceivedFiles(batch, false))
  }
})

onUnmounted(() => {
  connectionRequestModal?.destroy()
  fileModals.forEach((modal) => modal.destroy())
  fileModals.clear()
  openReceiptIds.clear()
  unsubscribers.forEach((off) => off())
})
</script>

<style lang="scss" src="./styles/globals.scss" />
<style lang="scss">
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
