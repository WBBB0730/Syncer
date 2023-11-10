import { makeAutoObservable } from 'mobx'

class ModalParams {
  visible = false
  device = null

  constructor() {
    makeAutoObservable(this)
  }

  show(device = null) {
    this.visible = true
    this.device = device
  }

  hide() {
    this.visible = false
  }
}

export default ModalParams
