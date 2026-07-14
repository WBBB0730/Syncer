import { existsSync, mkdirSync, readFileSync } from 'fs'
import { dirname } from 'path'
import type { z } from 'zod'
import writeFileAtomic from 'write-file-atomic'

export class AtomicJsonStorage<T extends object> {
  constructor(
    private readonly path: string,
    private readonly schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    private readonly migrate?: (value: unknown) => T
  ) {}

  read(): T {
    if (!existsSync(this.path)) return this.schema.parse({})
    const value: unknown = JSON.parse(readFileSync(this.path, 'utf8'))
    const current = this.schema.safeParse(value)
    if (current.success) return current.data
    if (!this.migrate) throw current.error

    const migrated = this.schema.parse(this.migrate(value))
    this.write(migrated)
    return migrated
  }

  write(value: T): void {
    const validated = this.schema.parse(value)
    const directory = dirname(this.path)
    mkdirSync(directory, { recursive: true })
    writeFileAtomic.sync(this.path, JSON.stringify(validated, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    })
  }
}
