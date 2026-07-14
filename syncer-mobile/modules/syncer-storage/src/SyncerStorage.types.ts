export type SaveFileInput = {
  sourceUri: string;
  name: string;
  size: number;
  mimeType?: string | null;
};

export type SavedFile = {
  sourceUri: string;
  name: string;
  locator: string;
};

export type SaveFileResult = {
  file: SavedFile;
  downloadsPath: string;
};
