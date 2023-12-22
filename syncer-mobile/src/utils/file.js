export function randomFileName(fileName) {
  const p = fileName.lastIndexOf('.')
  return fileName.slice(0, p) + '_' + Date.now() + fileName.slice(p)
}
