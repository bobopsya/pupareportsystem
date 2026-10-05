import { Cpu, Download, Eraser, LineChart, Plug, PlugZap, Plus, RotateCcw, Send, Settings2, Trash2, Unplug } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import {
  Badge, Button, Card, Checkbox, cx, Empty, IconButton, Input, Modal, Mono, PageHeader, Select, useToast,
} from '../components/ui';
import { saveBlob } from '../lib/api';
import { useDeleteRecord, useRecords, useSaveRecord } from '../lib/queries';
import { BAUD_RATES, guessBoard, LINE_ENDINGS, LineSplitter, parsePlotLine, vidPidStrings, type BoardGuess } from '../lib/serial';
import type { Device, DeviceData, SerialTemplateData } from '../lib/types';
import { DeviceModal } from './Devices';

interface Line {
  id: number;
  ts: number;
  dir: 'rx' | 'tx' | 'sys';
  text: string;
}

interface ChipInfo {
  chip: string;
  mac: string;
  flashSize: string;
  features: string[];
}

const MAX_LINES = 5000;
const MAX_POINTS = 600;
/** Series colours; the first follows the theme's foreground so it is visible on both backgrounds. */
const PLOT_EXTRA = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#a855f7', '#14b8a6', '#737373'];
const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function timeStr(ts: number) {
  const d = new Date(ts);
  return `${d.toLocaleTimeString('ru-RU')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

// ---------------- Plotter ----------------
function Plotter({ series, version }: { series: React.MutableRefObject<{ x: number[]; ys: Map<string, number[]> }>; version: number }) {
  const box = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const names = useRef<string>('');

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const keys = [...series.current.ys.keys()];
    // Theme is part of the signature, so the next data tick redraws the plot in the new colours.
    const sig = `${keys.join('|')}#${document.documentElement.dataset.theme}`;
    const data = [series.current.x, ...keys.map((k) => series.current.ys.get(k)!)] as uPlot.AlignedData;
    if (plot.current && sig === names.current) {
      plot.current.setData(data);
      return;
    }
    plot.current?.destroy();
    names.current = sig;
    if (!keys.length) return;
    const axis = { stroke: cssVar('--color-faint'), grid: { stroke: cssVar('--color-hover'), width: 1 }, ticks: { stroke: cssVar('--color-line'), width: 1 } };
    const colors = [cssVar('--color-fg'), ...PLOT_EXTRA];
    plot.current = new uPlot(
      {
        width: el.clientWidth,
        height: 260,
        legend: { show: true },
        cursor: { drag: { x: false, y: false } },
        scales: { x: { time: false } },
        axes: [{ ...axis, label: 'секунды' }, axis],
        series: [{ label: 't' }, ...keys.map((k, i) => ({ label: k, stroke: colors[i % colors.length], width: 1.5, points: { show: false } }))],
      },
      data,
      el,
    );
  }, [version, series]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => plot.current?.setSize({ width: el.clientWidth, height: 260 }));
    ro.observe(el);
    return () => {
      ro.disconnect();
      plot.current?.destroy();
      plot.current = null;
    };
  }, []);

  return (
    <div className="px-3 pb-3 pt-2">
      <div ref={box} className="w-full text-xs text-muted" />
      {series.current.ys.size === 0 && (
        <p className="py-10 text-center text-sm text-faint">
          Ждём числовые данные. Плата должна печатать строки вида <Mono>temp:21.5 hum:40</Mono> или <Mono>21.5 40</Mono>.
        </p>
      )}
    </div>
  );
}

// ---------------- Templates ----------------
function TemplatesModal({ onClose }: { onClose: () => void }) {
  const { data = [] } = useRecords('serial-templates');
  const save = useSaveRecord('serial-templates');
  const del = useDeleteRecord('serial-templates');
  const [f, setF] = useState<SerialTemplateData>({ name: '', command: '', lineEnding: 'lf' });
  return (
    <Modal open onClose={onClose} title="Шаблоны команд" wide>
      <p className="mb-3 text-sm text-muted">Шаблоны общие для всей команды и отображаются кнопками над полем ввода.</p>
      <form
        className="grid gap-2 sm:grid-cols-[10rem_1fr_8rem_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          if (f.name.trim()) save.mutate(f, { onSuccess: () => setF({ name: '', command: '', lineEnding: f.lineEnding }) });
        }}
      >
        <Input placeholder="Название" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Input mono placeholder="Команда, напр. AT+GMR" value={f.command} onChange={(e) => setF({ ...f, command: e.target.value })} />
        <Select value={f.lineEnding} onChange={(e) => setF({ ...f, lineEnding: e.target.value as SerialTemplateData['lineEnding'] })}>
          <option value="none">Без конца</option>
          <option value="lf">LF \n</option>
          <option value="cr">CR \r</option>
          <option value="crlf">CR+LF</option>
        </Select>
        <Button type="submit" variant="primary" icon={<Plus className="size-4" />} loading={save.isPending}>
          Добавить
        </Button>
      </form>
      <ul className="mt-4 divide-y divide-line/70 rounded-lg border border-line">
        {data.length === 0 && <li className="px-3 py-4 text-center text-sm text-faint">Шаблонов пока нет</li>}
        {data.map((t) => (
          <li key={t.id} className="flex items-center gap-3 px-3 py-2">
            <span className="w-32 truncate text-sm font-medium">{t.name}</span>
            <Mono className="min-w-0 flex-1 truncate text-muted">{t.command}</Mono>
            <Badge>{t.lineEnding.toUpperCase()}</Badge>
            <IconButton label="Удалить" onClick={() => del.mutate(t.id)}>
              <Trash2 className="size-4" />
            </IconButton>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

// ---------------- Page ----------------
export default function SerialConsole() {
  const supported = typeof navigator !== 'undefined' && 'serial' in navigator;
  const toast = useToast();
  const { data: templates = [] } = useRecords('serial-templates');
  const { data: devices = [] } = useRecords('devices');

  const [port, setPort] = useState<SerialPort | null>(null);
  const [connected, setConnected] = useState(false);
  const [board, setBoard] = useState<(BoardGuess & { vid: string; pid: string }) | null>(null);
  const [baud, setBaud] = useState(115200);
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState('');
  const [ending, setEnding] = useState<keyof typeof LINE_ENDINGS>('lf');
  const [autoscroll, setAutoscroll] = useState(true);
  const [showTs, setShowTs] = useState(true);
  const [plotOn, setPlotOn] = useState(false);
  const [plotVersion, setPlotVersion] = useState(0);
  const [chip, setChip] = useState<ChipInfo | null>(null);
  const [chipBusy, setChipBusy] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [addDevice, setAddDevice] = useState<Partial<DeviceData> | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);

  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const readLoopDone = useRef<Promise<void> | null>(null);
  const seq = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const pending = useRef<Line[]>([]);
  const series = useRef<{ x: number[]; ys: Map<string, number[]>; t0: number }>({ x: [], ys: new Map(), t0: 0 });
  const plotOnRef = useRef(plotOn);
  plotOnRef.current = plotOn;

  // Batch incoming lines into state at most once per animation frame.
  const flushScheduled = useRef(false);
  const push = useCallback((dir: Line['dir'], text: string) => {
    pending.current.push({ id: ++seq.current, ts: Date.now(), dir, text });
    if (flushScheduled.current) return;
    flushScheduled.current = true;
    requestAnimationFrame(() => {
      flushScheduled.current = false;
      const batch = pending.current;
      pending.current = [];
      setLines((prev) => {
        const next = prev.concat(batch);
        return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
      });
      if (plotOnRef.current) setPlotVersion((v) => v + 1);
    });
  }, []);

  const feedPlot = (text: string) => {
    const vals = parsePlotLine(text);
    if (!vals) return;
    const s = series.current;
    if (!s.x.length) s.t0 = Date.now();
    const n = s.x.length;
    s.x.push((Date.now() - s.t0) / 1000);
    for (const k of Object.keys(vals)) if (!s.ys.has(k)) s.ys.set(k, new Array(n).fill(null));
    for (const [k, arr] of s.ys) arr.push(vals[k] ?? (null as unknown as number));
    if (s.x.length > MAX_POINTS) {
      s.x.shift();
      for (const arr of s.ys.values()) arr.shift();
    }
  };

  const startReading = useCallback(
    (p: SerialPort) => {
      const splitter = new LineSplitter();
      const decoder = new TextDecoder();
      readLoopDone.current = (async () => {
        while (p.readable) {
          const reader = p.readable.getReader();
          readerRef.current = reader;
          try {
            for (;;) {
              const { value, done } = await reader.read();
              if (done) break;
              for (const l of splitter.push(decoder.decode(value, { stream: true }))) {
                push('rx', l);
                feedPlot(l);
              }
            }
          } catch (e) {
            push('sys', `Ошибка чтения: ${(e as Error).message}`);
          } finally {
            reader.releaseLock();
            readerRef.current = null;
          }
          if (!connectedRef.current) break;
        }
        const rest = splitter.flush();
        if (rest) push('rx', rest);
      })();
    },
    [push],
  );
  const connectedRef = useRef(false);

  const open = useCallback(
    async (p: SerialPort, rate: number) => {
      await p.open({ baudRate: rate, bufferSize: 64 * 1024 });
      connectedRef.current = true;
      setConnected(true);
      startReading(p);
    },
    [startReading],
  );

  const close = useCallback(async () => {
    connectedRef.current = false;
    setConnected(false);
    try {
      await readerRef.current?.cancel();
    } catch {
      /* already closed */
    }
    await readLoopDone.current?.catch(() => undefined);
    try {
      await port?.close();
    } catch {
      /* already closed */
    }
  }, [port]);

  const connect = async () => {
    try {
      const p = await navigator.serial.requestPort();
      const info = p.getInfo();
      const ids = vidPidStrings(info);
      setBoard({ ...guessBoard(info.usbVendorId, info.usbProductId), ...ids });
      setPort(p);
      setChip(null);
      await open(p, baud);
      push('sys', `Подключено: ${guessBoard(info.usbVendorId, info.usbProductId).label} (${ids.vid || '?'}:${ids.pid || '?'}), ${baud} бод`);
    } catch (e) {
      if ((e as DOMException).name !== 'NotFoundError') toast((e as Error).message, 'bad');
    }
  };

  const disconnect = async () => {
    await close();
    push('sys', 'Отключено');
  };

  // Close the port when leaving the page.
  useEffect(() => {
    const onDisconnect = (e: Event) => {
      if ((e.target as SerialPort) === port) {
        connectedRef.current = false;
        setConnected(false);
        push('sys', 'Устройство отключено от USB');
      }
    };
    navigator.serial?.addEventListener('disconnect', onDisconnect);
    return () => navigator.serial?.removeEventListener('disconnect', onDisconnect);
  }, [port, push]);
  useEffect(() => () => void close(), [close]);

  const changeBaud = async (rate: number) => {
    setBaud(rate);
    if (port && connected) {
      await close();
      await open(port, rate);
      push('sys', `Скорость: ${rate} бод`);
    }
  };

  const send = async (text: string, le: keyof typeof LINE_ENDINGS = ending) => {
    if (!port?.writable) return;
    const writer = port.writable.getWriter();
    push('tx', text);
    try {
      await writer.write(new TextEncoder().encode(text + LINE_ENDINGS[le]));
    } catch (e) {
      push('sys', `Ошибка отправки: ${(e as Error).message}`);
    } finally {
      writer.releaseLock();
    }
  };

  const resetBoard = async () => {
    if (!port) return;
    // ESP32 auto-reset: RTS drives EN. Arduino: DTR pulse resets via the capacitor.
    await port.setSignals({ dataTerminalReady: false, requestToSend: true });
    await sleep(120);
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
    push('sys', 'Плата перезагружена (DTR/RTS)');
  };

  const readChip = async () => {
    if (!port) return;
    setChipBusy(true);
    push('sys', 'Чтение информации о чипе (esptool)…');
    await close();
    try {
      const { ESPLoader, Transport } = await import('esptool-js');
      const transport = new Transport(port, false);
      const loader = new ESPLoader({
        transport,
        baudrate: 115200,
        terminal: { clean() {}, writeLine: (d: string) => push('sys', `esptool: ${d}`), write: () => undefined },
      });
      try {
        const description = await loader.main();
        const mac = await loader.chip.readMac(loader);
        const features = await loader.chip.getChipFeatures(loader).catch(() => [] as string[]);
        const flashSize = (await loader.detectFlashSize().catch(() => undefined)) ?? '';
        const info = { chip: description, mac, flashSize, features };
        setChip(info);
        push('sys', `Чип: ${description}, MAC: ${mac}${flashSize ? `, flash: ${flashSize}` : ''}`);
        await loader.after('hard_reset').catch(() => undefined);
      } finally {
        await transport.disconnect().catch(() => undefined);
      }
    } catch (e) {
      push('sys', `Не удалось прочитать чип: ${(e as Error).message}. Попробуйте зажать кнопку BOOT при подключении.`);
    } finally {
      setChipBusy(false);
      try {
        await open(port, baud);
      } catch (e) {
        push('sys', `Не удалось переоткрыть порт: ${(e as Error).message}`);
      }
    }
  };

  useEffect(() => {
    if (autoscroll && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lines, autoscroll]);

  const known: Device[] = useMemo(() => {
    if (chip?.mac) return devices.filter((d) => d.mac.toLowerCase() === chip.mac.toLowerCase());
    return [];
  }, [devices, chip]);
  const sameModel = board ? devices.filter((d) => d.usbVid === board.vid && d.usbPid === board.pid) : [];

  const saveLog = () => {
    const text = lines.map((l) => `${new Date(l.ts).toISOString()} ${l.dir === 'tx' ? '>' : l.dir === 'sys' ? '#' : '<'} ${l.text}`).join('\n');
    saveBlob(new Blob([text], { type: 'text/plain' }), `serial-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.log`);
  };

  if (!supported) {
    return (
      <>
        <PageHeader title="USB-консоль" />
        <Card>
          <Empty icon={<Unplug />} title="Браузер не поддерживает Web Serial">
            Откройте портал в Google Chrome или Microsoft Edge на компьютере (Windows, macOS, Linux). На телефонах и в Firefox/Safari подключение по USB недоступно.
          </Empty>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="USB-консоль"
        description="Монитор порта для ESP32 и Arduino Uno прямо в браузере"
        actions={
          connected ? (
            <Button icon={<Unplug className="size-4" />} onClick={() => void disconnect()}>
              Отключить
            </Button>
          ) : port ? (
            <>
              <Button icon={<Plug className="size-4" />} onClick={() => void open(port, baud).then(() => push('sys', 'Переподключено'))}>
                Переподключить
              </Button>
              <Button variant="primary" icon={<PlugZap className="size-4" />} onClick={() => void connect()}>
                Другой порт
              </Button>
            </>
          ) : (
            <Button variant="primary" icon={<PlugZap className="size-4" />} onClick={() => void connect()}>
              Подключить устройство
            </Button>
          )
        }
      />

      <div className="grid gap-5 xl:grid-cols-[1fr_20rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
              <span className="flex items-center gap-2 pr-2 text-sm">
                <span className={cx('size-2 rounded-full', connected ? 'bg-ok' : 'bg-faint')} />
                {connected ? 'Подключено' : 'Не подключено'}
              </span>
              <Select value={baud} onChange={(e) => void changeBaud(Number(e.target.value))} className="h-8 w-32 text-xs" aria-label="Скорость">
                {BAUD_RATES.map((b) => (
                  <option key={b} value={b}>
                    {b} бод
                  </option>
                ))}
              </Select>
              <div className="ml-auto flex flex-wrap items-center gap-3">
                <Checkbox checked={showTs} onChange={setShowTs} label={<span className="text-xs text-muted">Время</span>} />
                <Checkbox checked={autoscroll} onChange={setAutoscroll} label={<span className="text-xs text-muted">Автопрокрутка</span>} />
                <IconButton label="Перезагрузить плату" disabled={!connected} onClick={() => void resetBoard()}>
                  <RotateCcw className="size-4" />
                </IconButton>
                <IconButton label="Плоттер" className={cx(plotOn && 'bg-hover text-fg')} onClick={() => setPlotOn(!plotOn)}>
                  <LineChart className="size-4" />
                </IconButton>
                <IconButton label="Сохранить лог в файл" disabled={!lines.length} onClick={saveLog}>
                  <Download className="size-4" />
                </IconButton>
                <IconButton label="Очистить" onClick={() => (setLines([]), (series.current = { x: [], ys: new Map(), t0: 0 }), setPlotVersion((v) => v + 1))}>
                  <Eraser className="size-4" />
                </IconButton>
              </div>
            </div>

            {plotOn && (
              <div className="border-b border-line">
                <Plotter series={series} version={plotVersion} />
              </div>
            )}

            <div ref={logRef} className="h-[52dvh] min-h-64 overflow-y-auto bg-bg px-3 py-2 font-mono text-[12.5px] leading-relaxed" onScroll={(e) => {
              const el = e.currentTarget;
              const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
              if (atBottom !== autoscroll) setAutoscroll(atBottom);
            }}>
              {lines.length === 0 ? (
                <p className="py-10 text-center font-sans text-sm text-faint">{connected ? 'Ожидание данных…' : 'Подключите плату по USB и нажмите «Подключить устройство».'}</p>
              ) : (
                lines.map((l) => (
                  <div key={l.id} className={cx('whitespace-pre-wrap break-all', l.dir === 'tx' && 'text-info', l.dir === 'sys' && 'text-faint italic')}>
                    {showTs && <span className="mr-2 select-none text-faint">{timeStr(l.ts)}</span>}
                    {l.dir === 'tx' && <span className="select-none">› </span>}
                    {l.text}
                  </div>
                ))
              )}
            </div>

            <div className="border-t border-line p-3">
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                {templates.map((t) => (
                  <Button key={t.id} size="sm" disabled={!connected} onClick={() => void send(t.command, t.lineEnding)} title={t.command}>
                    {t.name}
                  </Button>
                ))}
                <Button size="sm" variant="ghost" icon={<Settings2 className="size-3.5" />} onClick={() => setTemplatesOpen(true)}>
                  Шаблоны
                </Button>
              </div>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!input) return;
                  void send(input);
                  setHistory((h) => [input, ...h.filter((x) => x !== input)].slice(0, 50));
                  setHistIdx(-1);
                  setInput('');
                }}
              >
                <Input
                  mono
                  value={input}
                  disabled={!connected}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowUp' && history.length) {
                      e.preventDefault();
                      const i = Math.min(histIdx + 1, history.length - 1);
                      setHistIdx(i);
                      setInput(history[i]!);
                    } else if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      const i = histIdx - 1;
                      setHistIdx(Math.max(i, -1));
                      setInput(i >= 0 ? history[i]! : '');
                    }
                  }}
                  placeholder={connected ? 'Команда… (↑↓ — история)' : 'Нет подключения'}
                />
                <Select value={ending} onChange={(e) => setEnding(e.target.value as keyof typeof LINE_ENDINGS)} className="w-28 shrink-0" aria-label="Конец строки">
                  <option value="none">Без конца</option>
                  <option value="lf">LF</option>
                  <option value="cr">CR</option>
                  <option value="crlf">CR+LF</option>
                </Select>
                <Button type="submit" variant="primary" disabled={!connected} icon={<Send className="size-4" />} aria-label="Отправить" />
              </form>
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card title="Плата">
            {!board ? (
              <p className="px-4 py-4 text-sm text-faint">Плата не выбрана</p>
            ) : (
              <div className="flex flex-col gap-3 px-4 py-3 text-sm">
                <div>
                  <div className="font-medium">{board.label}</div>
                  <Mono className="text-xs text-faint">
                    USB {board.vid || '????'}:{board.pid || '????'}
                  </Mono>
                </div>
                {chip && (
                  <div className="rounded-md border border-line bg-elevated p-3 text-xs">
                    <div className="text-muted">Чип</div>
                    <div className="mb-2">{chip.chip}</div>
                    <div className="text-muted">MAC</div>
                    <Mono className="mb-2 block">{chip.mac}</Mono>
                    {chip.flashSize && (
                      <>
                        <div className="text-muted">Flash</div>
                        <div className="mb-2">{chip.flashSize}</div>
                      </>
                    )}
                    {chip.features.length > 0 && <div className="text-faint">{chip.features.join(', ')}</div>}
                  </div>
                )}
                {known.length > 0 ? (
                  <div className="rounded-md border border-ok/30 bg-ok/5 px-3 py-2 text-xs">
                    <span className="text-ok">Уже в реестре:</span> {known.map((d) => d.name).join(', ')}
                  </div>
                ) : (
                  sameModel.length > 0 &&
                  !chip && <div className="text-xs text-faint">В реестре {sameModel.length} устр. с таким же USB-адаптером. Прочитайте MAC, чтобы найти точное совпадение.</div>
                )}
                {board.kind === 'esp32' && (
                  <Button icon={<Cpu className="size-4" />} loading={chipBusy} disabled={!port} onClick={() => void readChip()}>
                    Считать чип и MAC
                  </Button>
                )}
                {known.length === 0 && (
                  <Button
                    variant="primary"
                    icon={<Plus className="size-4" />}
                    onClick={() =>
                      setAddDevice({
                        kind: board.kind,
                        name: board.kind === 'uno' ? 'Arduino Uno' : chip?.chip.split(' ')[0] ?? 'ESP32',
                        chip: chip?.chip ?? (board.kind === 'uno' ? 'ATmega328P' : ''),
                        mac: chip?.mac ?? '',
                        flashSize: chip?.flashSize ?? '',
                        usbVid: board.vid,
                        usbPid: board.pid,
                      })
                    }
                  >
                    Добавить в реестр
                  </Button>
                )}
              </div>
            )}
          </Card>
          <Card title="Подсказки">
            <ul className="flex flex-col gap-2 px-4 py-3 text-xs text-muted">
              <li>ESP32 обычно работает на 115200 бод, Arduino Uno — часто 9600.</li>
              <li>Если порт занят — закройте Arduino IDE / другие мониторы порта.</li>
              <li>Для чтения MAC ESP32 перейдёт в режим загрузчика и перезапустится.</li>
              <li>Плоттер понимает строки «имя:значение» и числа через пробел/запятую.</li>
              <li>Нужен драйвер CP210x или CH340, если плата не видна в списке.</li>
            </ul>
          </Card>
        </div>
      </div>

      {templatesOpen && <TemplatesModal onClose={() => setTemplatesOpen(false)} />}
      {addDevice && (
        <DeviceModal
          device={null}
          initial={addDevice}
          onClose={(saved) => {
            setAddDevice(null);
            if (saved) toast(`«${saved.name}» добавлено в реестр`, 'ok');
          }}
        />
      )}
    </>
  );
}
