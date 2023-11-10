// import Storage from 'electron-store'
// export default new Storage()

function setStorage(key, data) {
  localStorage.setItem(key, JSON.stringify(data))
}

function getStorage(key) {
  const data = localStorage.getItem(key)
  return data ? JSON.parse(data) : null
}

export {
  setStorage,
  getStorage,
}
