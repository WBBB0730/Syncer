export type StagedPublicationSource = {
  sourceUri: string;
  size: number;
};

export type PublishedSource = {
  sourceUri: string;
};

export class PublicationLedger<
  TStaged extends StagedPublicationSource,
  THistory,
> {
  private remainingFiles: TStaged[] = [];
  private cleanupFiles: TStaged[] = [];
  private historyItems: THistory[] = [];

  addStaged(file: TStaged): void {
    if (
      this.remainingFiles.some((item) => item.sourceUri === file.sourceUri) ||
      this.cleanupFiles.some((item) => item.sourceUri === file.sourceUri)
    ) {
      throw new Error('Staged publication source must be unique');
    }
    this.remainingFiles.push(file);
  }

  recordPublication(
    published: readonly PublishedSource[],
    history: readonly THistory[],
    complete: boolean,
  ): void {
    if (published.length !== history.length) {
      throw new Error('Published files and Receive History must have identical ownership');
    }
    const publishedSources = new Set(published.map((file) => file.sourceUri));
    if (
      publishedSources.size !== published.length ||
      published.some(
        (file) => !this.remainingFiles.some((staged) => staged.sourceUri === file.sourceUri),
      )
    ) {
      throw new Error('Native publication returned inconsistent source ownership');
    }

    const publishedStaging = this.remainingFiles.filter((file) =>
      publishedSources.has(file.sourceUri),
    );
    const remaining = this.remainingFiles.filter(
      (file) => !publishedSources.has(file.sourceUri),
    );
    if (publishedStaging.length === 0 || complete !== (remaining.length === 0)) {
      throw new Error('Native publication returned inconsistent completion state');
    }

    this.remainingFiles = remaining;
    this.cleanupFiles.push(...publishedStaging);
    this.historyItems.push(...history);
  }

  acknowledgeCleanup(sourceUri: string): TStaged {
    const index = this.cleanupFiles.findIndex((file) => file.sourceUri === sourceUri);
    if (index === -1) throw new Error('Published staging cleanup is not owned by this batch');
    return this.cleanupFiles.splice(index, 1)[0]!;
  }

  acknowledgeHistory(items: readonly THistory[]): void {
    if (
      items.length > this.historyItems.length ||
      items.some((item, index) => this.historyItems[index] !== item)
    ) {
      throw new Error('Receive History acknowledgement does not match pending ownership');
    }
    this.historyItems.splice(0, items.length);
  }

  get remaining(): readonly TStaged[] {
    return this.remainingFiles;
  }

  get pendingCleanup(): readonly TStaged[] {
    return this.cleanupFiles;
  }

  get pendingHistory(): readonly THistory[] {
    return this.historyItems;
  }
}
