import { message } from 'ant-design-vue'

export async function performAction(
  action: () => Promise<unknown>,
  failureMessage: string
): Promise<boolean> {
  try {
    await action()
    return true
  } catch (error) {
    console.error(failureMessage, error)
    message.error(failureMessage)
    return false
  }
}
