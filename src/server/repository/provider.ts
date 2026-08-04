export type RepositoryDocument = {
  content: string;
  revision: string;
};

export type RepositoryWrite = {
  path: string;
  content: string;
  expectedRevision?: string;
  message: string;
};

export class RepositoryRevisionConflictError extends Error {
  constructor() {
    super("The repository document changed before the export was written.");
    this.name = "RepositoryRevisionConflictError";
  }
}

export interface RepositoryProvider {
  read(path: string): Promise<RepositoryDocument>;
  write(input: RepositoryWrite): Promise<RepositoryDocument>;
}
