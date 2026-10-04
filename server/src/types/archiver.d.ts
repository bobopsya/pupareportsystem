declare module 'archiver' {
  import { Transform, Readable } from 'node:stream';
  export class ZipArchive extends Transform {
    constructor(options?: { zlib?: { level?: number } });
    append(source: Readable | Buffer | string, data: { name: string; date?: Date }): this;
    file(filename: string, data: { name: string }): this;
    finalize(): Promise<void>;
  }
}
