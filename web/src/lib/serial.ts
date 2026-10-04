/** USB-serial helpers for the ESP32 / Arduino console. */

export interface BoardGuess {
  label: string;
  kind: 'esp32' | 'uno' | 'other';
}

const hex4 = (n: number | undefined) => (n === undefined ? '' : n.toString(16).padStart(4, '0'));

/** Identifies a board from USB vendor/product IDs. */
export function guessBoard(vid?: number, pid?: number): BoardGuess {
  const v = hex4(vid);
  const p = hex4(pid);
  if (v === '2341' || v === '2a03') {
    if (['0043', '0001', '0243'].includes(p)) return { label: 'Arduino Uno', kind: 'uno' };
    return { label: 'Arduino', kind: 'other' };
  }
  if (v === '303a') return { label: 'ESP32 (встроенный USB)', kind: 'esp32' };
  if (v === '10c4' && p === 'ea60') return { label: 'ESP32 (мост CP210x)', kind: 'esp32' };
  if (v === '1a86') return { label: p === '7523' ? 'CH340 (ESP32 / клон Uno)' : 'CH34x (ESP32 / клон Uno)', kind: 'esp32' };
  if (v === '0403') return { label: 'FTDI USB-Serial', kind: 'other' };
  if (!v) return { label: 'Неизвестное устройство', kind: 'other' };
  return { label: `USB ${v}:${p}`, kind: 'other' };
}

export function vidPidStrings(info: SerialPortInfo) {
  return { vid: hex4(info.usbVendorId), pid: hex4(info.usbProductId) };
}

export const LINE_ENDINGS = { none: '', lf: '\n', cr: '\r', crlf: '\r\n' } as const;
export const BAUD_RATES = [300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 74880, 115200, 230400, 460800, 921600];

/**
 * Extracts plottable values from a serial line, like the Arduino Serial Plotter:
 * "temp:21.5 hum:40" / "temp=21.5, hum=40" → named series; "1.2 3.4" / "1,2,3" → value1..N.
 */
export function parsePlotLine(line: string): Record<string, number> | null {
  const s = line.trim();
  if (!s) return null;
  const out: Record<string, number> = {};
  const named = /([A-Za-zА-Яа-я_][\wА-Яа-я.-]*)\s*[:=]\s*(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/g;
  let m: RegExpExecArray | null;
  let found = false;
  while ((m = named.exec(s))) {
    out[m[1]!] = Number(m[2]);
    found = true;
  }
  if (found) return out;
  const parts = s.split(/[\s,;\t]+/).filter(Boolean);
  if (!parts.length || !parts.every((p) => /^-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/.test(p))) return null;
  parts.forEach((p, i) => (out[`value${i + 1}`] = Number(p)));
  return out;
}

/** Splits an incoming text stream into complete lines, carrying over the partial tail. */
export class LineSplitter {
  private buf = '';
  push(chunk: string): string[] {
    this.buf += chunk;
    const parts = this.buf.split(/\r?\n|\r(?!$)/);
    this.buf = parts.pop() ?? '';
    if (this.buf.length > 10_000) {
      parts.push(this.buf);
      this.buf = '';
    }
    return parts;
  }
  flush(): string | null {
    const rest = this.buf;
    this.buf = '';
    return rest || null;
  }
}
