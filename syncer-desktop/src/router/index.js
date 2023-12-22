import { createRouter, createWebHashHistory } from 'vue-router'
import Connections from '@/views/Connection.vue'

const routes = [
  {
    path: '/',
    name: 'connections',
    component: Connections
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
