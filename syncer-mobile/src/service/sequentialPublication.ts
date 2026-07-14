export async function publishRemainingFiles<T>(
  remainingFiles: () => readonly T[],
  publish: (file: T, complete: boolean) => Promise<void>,
): Promise<void> {
  while (remainingFiles().length > 0) {
    const remaining = remainingFiles();
    const file = remaining[0];
    if (!file) throw new Error('Publication queue lost its next file');
    await publish(file, remaining.length === 1);
    if (remainingFiles()[0] === file) {
      throw new Error('Published file ownership was not released from the queue');
    }
  }
}
