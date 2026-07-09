export function fileToBase64(file: File | Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = () => {
      resolve(String(reader.result))
    }
  })
}
