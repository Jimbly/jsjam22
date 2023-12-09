
export type FilewatchCB = (filename: string) => void | boolean;

export type FSAPI = {
  getFileNames(directory: string): string[];
  getFile<T>(filename: string, encoding: 'jsobj'): T;
  getFile(filename: string, encoding: 'buffer'): Buffer;
  filewatchOn(ext_or_search: RegExp | string, cb: FilewatchCB): void;
};

// filename from webfs or serverfs, convert to same base name
export function fileBaseName(filename: string): string {
  let idx = filename.lastIndexOf('/');
  if (idx !== -1) {
    filename = filename.slice(idx + 1);
  }
  idx = filename.indexOf('.');
  if (idx !== -1) {
    filename = filename.slice(0, idx);
  }
  return filename;
}
