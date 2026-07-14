import { randomUUID } from 'crypto'
import type { TcpApplicationMessage } from '@syncer/protocol'

type RingMessage = Extract<TcpApplicationMessage, { type: 'ring' }>
type SendRingMessage = (message: RingMessage) => Promise<void>

export class FindDeviceCoordinator {
  private requestId: string | null = null
  private transition = Promise.resolve()

  constructor(private readonly createRequestId: () => string = randomUUID) {}

  setActive(active: boolean, send: SendRingMessage): Promise<void> {
    const operation = this.transition.then(() => this.apply(active, send))
    this.transition = operation.catch(() => undefined)
    return operation
  }

  handle(message: RingMessage): boolean {
    if (message.content || message.requestId !== this.requestId) return false
    this.requestId = null
    return true
  }

  get currentRequestId(): string | null {
    return this.requestId
  }

  private async apply(active: boolean, send: SendRingMessage): Promise<void> {
    if (active) {
      if (this.requestId) return
      const requestId = this.createRequestId()
      this.requestId = requestId
      try {
        await send({ type: 'ring', content: true, requestId })
      } catch (error) {
        if (this.requestId === requestId) this.requestId = null
        throw error
      }
      return
    }

    const requestId = this.requestId
    if (!requestId) return
    await send({ type: 'ring', content: false, requestId })
    if (this.requestId === requestId) this.requestId = null
  }
}
