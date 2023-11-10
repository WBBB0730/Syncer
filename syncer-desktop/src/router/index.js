import { createRouter, createWebHashHistory } from 'vue-router'
import Connections from '@/views/Connections.vue'
import Settings from '@/views/Settings.vue'

const routes = [
  {
    path: '/',
    name: 'connections',
    component: Connections  },
  {
    path: '/settings',
    name: 'settings',
    component: Settings
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
