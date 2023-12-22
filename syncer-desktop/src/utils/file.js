export function randomFileName(fileName) {
  const p = fileName.lastIndexOf('.')
  return fileName.slice(0, p) + '_' + Date.now() + fileName.slice(p)
}

export function fileToBase64(file) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = () => {
      resolve(reader.result)
    }
  })
}
