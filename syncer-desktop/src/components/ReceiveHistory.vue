<template>
  <a-button class="receive-history__show-button" type="text" @click="show">
    <template #icon>
      <FileTextOutlined />
    </template>
  </a-button>

  <a-modal v-model:open="visible" title="接收历史" class="receive-history" centered :footer="false">
    <div class="receive-history__head">
      <a-checkbox v-if="selecting" :checked="allSelected" @change="selectAll">全选</a-checkbox>
      <div v-else>共 {{ receiveHistory.length }} 条记录</div>
      <div class="receive-history__operation">
        <a-button @click="changeSelecting">{{ selecting ? '取消' : '选择' }}</a-button>
        <a-button v-if="selecting" type="primary" danger :disabled="!selectedList.length"
                  @click="deleteSelectedItems">删除</a-button>
      </div>
    </div>
    <div class="receive-history__list">
      <div v-for="(item, index) in list" :key="index" class="receive-history__item"
           @click="handleClickItem(item)">
        <a-checkbox v-if="selecting" v-model:checked="item.selected" @click.stop></a-checkbox>
        <div class="receive-history__item-middle">
          <div class="receive-history__item-name">{{ item.name }}</div>
          <div class="receive-history__item-details">
            <a-tag>{{ formatTime(item.time) }}</a-tag>
            {{ item.path }}
          </div>
        </div>
        <RightOutlined />
      </div>
      <a-button v-if="hasMore" class="receive-history__show-more" type="link" @click="showMore">加载更多</a-button>
      <a-divider v-else>
        <span class="receive-history__no-more">没有更多了</span>
      </a-divider>
    </div>
  </a-modal>
</template>

<script setup>
import { FileTextOutlined, RightOutlined } from '@ant-design/icons-vue'
import { computed, reactive, ref } from 'vue'
import { getStorage, setStorage } from '@/utils/storage'
import dayjs from 'dayjs'
import { shell } from 'electron'
import fs from 'fs'
import { message } from 'ant-design-vue'

const visible = ref(false)
const receiveHistory = reactive([])
const pageIndex = ref(1)
const list = computed(() => receiveHistory.slice(0, pageIndex.value * 20))

/** 打开接受历史窗口 */
function show() {
  visible.value = true
  pageIndex.value = 1
  const temp = getStorage('receiveHistory') || []
  receiveHistory.length = 0
  receiveHistory.push(...temp.map(item => ({ ...item, selected: false })))
}

const hasMore = computed(() => receiveHistory.length > pageIndex.value * 20)

/** 加载更多 */
function showMore() {
  pageIndex.value++
}

const selecting = ref(false)
const selectedList = computed(() => list.value.filter(item => item.selected))
const allSelected = computed(() => list.value.length && selectedList.value.length === list.value.length)

/** 选择、取消选择 */
function changeSelecting() {
  if (!selecting.value) {
    selecting.value = true
    list.value.forEach((item) => {
      item.selected = false
    })
  } else {
    selecting.value = false
  }
}

/** 全选、取消全选 */
function selectAll() {
  const selected = !allSelected.value
  list.value.forEach((item) => {
    item.selected = selected
  })
}

/** 删除选中的记录 */
function deleteSelectedItems() {
  const temp = receiveHistory.filter(item => !item.selected)
  receiveHistory.length = 0
  receiveHistory.push(...temp)
  setStorage('receiveHistory', receiveHistory)
  selecting.value = false
}

/** 时间戳格式化 */
function formatTime(time) {
  return dayjs(time).format('YYYY-MM-DD HH:mm')
}

/** 处理记录点击事件 */
function handleClickItem(item) {
  if (selecting.value) {
    item.selected = !item.selected
    return
  }
  // 打开文件路径
  const path = item.path + '\\' + item.name
  if (!fs.existsSync(path)) {
    message.error('文件不存在')
    return
  }
  shell.showItemInFolder(path)
}
</script>

<style lang="scss" scoped>
@import "@/styles/theme.scss";

.receive-history__show-button {
  color: $secondary-text-color;
}

.receive-history__head {
  display: flex;
  align-items: center;
  padding: 12px 0;
}

.receive-history__operation {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
}

.receive-history__list {
  display: flex;
  flex-direction: column;
  height: 60vh;
  overflow-y: auto;
  &::-webkit-scrollbar {
    display: none;
  }
}

.receive-history__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 8px 0;
  cursor: pointer;
}

.receive-history__item-middle {
  display: flex;
  flex-direction: column;
  flex-grow: 1;
  width: 0;
}

.receive-history__item-name {
  margin-bottom: 4px;
  font-weight: bold;
}

.receive-history__item-details {
  color: $tip-text-color;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.receive-history__show-more {
  margin: 0 auto;
  color: $brand-color;

  &:hover {
    color: $hover-color;
  }
}

.receive-history__no-more {
  color: $tip-text-color;
  font-size: 12px;
}

</style>
