// import Storage from 'electron-store'
// export default new Storage()

function setStorage(key, data) {
  localStorage.setItem(key, JSON.stringify(data))
}

function getStorage(key) {
  const data = localStorage.getItem(key)
  return data ? JSON.parse(data) : null
}

const STORAGE_KEYS = {
  NAME: 'name',
  UUID: 'uuid',
  WHITE_LIST: 'whiteList',
  RECEIVE_HISTORY: 'receiveHistory',
  FILE_PATH: 'filePath',
}

export {
  setStorage,
  getStorage,
  STORAGE_KEYS,
}
