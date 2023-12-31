import os from 'os'

/** 获取本机IP地址 */
function getIpAddress() {
  const interFaces = os.networkInterfaces()
  let address
  const addressList = []
  for (const interFace in interFaces) {
    interFaces[interFace].forEach((details) => {
      if (details.family === 'IPv4' && !details.internal) {
        if (interFace.toUpperCase().includes('WLAN'))
          address = details.address
        addressList.push(details.address)
      }
    })
  }
  return address || addressList.join(' / ')
}

export {
  getIpAddress
}
