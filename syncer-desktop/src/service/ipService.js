import os from 'os'

/** 获取本机IP地址 */
function getIpAddress() {
  const interFaces = os.networkInterfaces()
  let address
  for (const interFace in interFaces) {
    interFaces[interFace].forEach((details) => {
      if (details.family === 'IPv4' && !details.internal)
        address = details.address
    })
  }
  return address
}

export {
  getIpAddress
}
