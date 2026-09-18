import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type NativeBounds = {
  x: number
  y: number
  width: number
  height: number
}

type Waiter = {
  resolve: (value: string) => void
  reject: (error: Error) => void
}

/**
 * Persistent PowerShell HWND helper.
 * Avoids a native addon (fragile with Electron) while still batching SetWindowPos.
 */
const WORKER = `
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
public class VantaHwnd {
  public delegate bool Cb(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Cb cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr i, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int n);
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW")] public static extern IntPtr SetWindowLongPtr(IntPtr h, int n, IntPtr v);
  [DllImport("user32.dll")] public static extern IntPtr SetParent(IntPtr c, IntPtr p);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint attach, uint attachTo, bool fAttach);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }

  static bool IsBrowserProcess(IntPtr h) {
    uint pid;
    GetWindowThreadProcessId(h, out pid);
    try {
      var name = Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant();
      return name == "chrome" || name == "msedge";
    } catch { return false; }
  }

  static bool RealBrowserWindow(IntPtr h, out int w, out int hgt) {
    w = 0; hgt = 0;
    if (!IsWindowVisible(h)) return false;
    var cls = new StringBuilder(256);
    GetClassName(h, cls, 256);
    if (cls.ToString() != "Chrome_WidgetWin_1") return false;
    if (!IsBrowserProcess(h)) return false;
    RECT r;
    GetWindowRect(h, out r);
    w = r.R - r.L; hgt = r.B - r.T;
    return w >= 120 && hgt >= 80;
  }

  public static string List() {
    var found = new List<string>();
    EnumWindows((h, l) => {
      int w, hgt;
      if (RealBrowserWindow(h, out w, out hgt))
        found.Add(((long)h).ToString());
      return true;
    }, IntPtr.Zero);
    return string.Join(",", found);
  }

  public static string FindAt(string x, string y) {
    var left = int.Parse(x);
    var top = int.Parse(y);
    string hit = null;
    int best = int.MaxValue;
    EnumWindows((h, l) => {
      int w, hgt;
      if (!RealBrowserWindow(h, out w, out hgt)) return true;
      RECT r;
      GetWindowRect(h, out r);
      var d = Math.Abs(r.L - left) + Math.Abs(r.T - top);
      if (d < best && d < 320) { best = d; hit = ((long)h).ToString(); }
      return true;
    }, IntPtr.Zero);
    return hit ?? "";
  }

  public static string WaitNew(string timeoutMs, string excludeCsv) {
    var exclude = new HashSet<string>(excludeCsv.Split(new[]{','}, StringSplitOptions.RemoveEmptyEntries));
    var until = DateTime.UtcNow.AddMilliseconds(int.Parse(timeoutMs));
    while (DateTime.UtcNow < until) {
      string hit = null;
      EnumWindows((h, l) => {
        if (hit != null) return true;
        var id = ((long)h).ToString();
        if (exclude.Contains(id)) return true;
        int w, hgt;
        if (RealBrowserWindow(h, out w, out hgt)) hit = id;
        return true;
      }, IntPtr.Zero);
      if (hit != null) return hit;
      System.Threading.Thread.Sleep(50);
    }
    return "";
  }

  public static void OwnFrameless(string hwnd, string owner) {
    var h = (IntPtr)long.Parse(hwnd);
    var o = (IntPtr)long.Parse(owner);
    SetParent(h, IntPtr.Zero);
    SetWindowLongPtr(h, -8, o);
    var style = GetWindowLongPtr(h, -16).ToInt64();
    style = style & ~0x00CF0000L;
    SetWindowLongPtr(h, -16, (IntPtr)style);
    SetWindowPos(h, IntPtr.Zero, 0, 0, 0, 0, 0x0027);
  }

  public static void OwnTopLevel(string hwnd, string owner) {
    var h = (IntPtr)long.Parse(hwnd);
    var o = (IntPtr)long.Parse(owner);
    SetParent(h, IntPtr.Zero);
    SetWindowLongPtr(h, -8, o);
  }

  public static void Place(string hwnd, int x, int y, int w, int hgt) {
    var h = (IntPtr)long.Parse(hwnd);
    if (!IsWindow(h)) return;
    ShowWindow(h, 8);
    SetWindowPos(h, IntPtr.Zero, x, y, w, hgt, 0x0064);
  }

  public static void PlaceMany(string spec) {
    foreach (var part in spec.Split(new[]{'|'}, StringSplitOptions.RemoveEmptyEntries)) {
      var b = part.Split(',');
      Place(b[0], int.Parse(b[1]), int.Parse(b[2]), int.Parse(b[3]), int.Parse(b[4]));
    }
  }

  public static void ClickThrough(string hwnd, int enable) {
    var h = (IntPtr)long.Parse(hwnd);
    if (!IsWindow(h)) return;
    var ex = GetWindowLongPtr(h, -20).ToInt64();
    const long WS_EX_TRANSPARENT = 0x00000020L;
    const long WS_EX_LAYERED = 0x00080000L;
    if (enable != 0) ex |= WS_EX_TRANSPARENT | WS_EX_LAYERED;
    else ex &= ~WS_EX_TRANSPARENT;
    SetWindowLongPtr(h, -20, (IntPtr)ex);
    SetWindowPos(h, IntPtr.Zero, 0, 0, 0, 0, 0x0027);
  }

  public static void Raise(string hwnd) {
    var h = (IntPtr)long.Parse(hwnd);
    if (!IsWindow(h)) return;
    SetWindowPos(h, new IntPtr(-1), 0, 0, 0, 0, 0x0013);
  }

  public static void Show(string hwnd, int visible) {
    var h = (IntPtr)long.Parse(hwnd);
    if (IsWindow(h)) ShowWindow(h, visible != 0 ? 8 : 0);
  }

  public static void Focus(string hwnd) {
    var h = (IntPtr)long.Parse(hwnd);
    if (!IsWindow(h)) return;
    uint pid;
    var chromeThread = GetWindowThreadProcessId(h, out pid);
    var fore = GetForegroundWindow();
    uint pid2;
    var foreThread = GetWindowThreadProcessId(fore, out pid2);
    var curThread = GetCurrentThreadId();
    if (foreThread != chromeThread) AttachThreadInput(foreThread, chromeThread, true);
    if (curThread != chromeThread) AttachThreadInput(curThread, chromeThread, true);
    SetForegroundWindow(h);
    SetFocus(h);
    if (curThread != chromeThread) AttachThreadInput(curThread, chromeThread, false);
    if (foreThread != chromeThread) AttachThreadInput(foreThread, chromeThread, false);
  }

  public static void Close(string hwnd) {
    var h = (IntPtr)long.Parse(hwnd);
    if (!IsWindow(h)) return;
    SetWindowLongPtr(h, -8, IntPtr.Zero);
    SetParent(h, IntPtr.Zero);
    PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero);
  }

  public static string Alive(string hwnd) {
    return IsWindow((IntPtr)long.Parse(hwnd)) ? "1" : "0";
  }
}
"@
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class VantaDpi {
  [DllImport("shcore.dll")] public static extern int SetProcessDpiAwareness(int v);
}
"@
try { [VantaDpi]::SetProcessDpiAwareness(2) | Out-Null } catch {}
function Write-Reply([string]$kind, [string]$body) {
  [Console]::Out.WriteLine($kind + '|' + ($body -replace '[\\r\\n]', ' '))
  [Console]::Out.Flush()
}
[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line -eq 'quit') { break }
  $space = $line.IndexOf(' ')
  $cmd = if ($space -lt 0) { $line } else { $line.Substring(0, $space) }
  $arg = if ($space -lt 0) { '' } else { $line.Substring($space + 1) }
  try {
    switch ($cmd) {
      'list' { Write-Reply 'OK' ([VantaHwnd]::List()) }
      'wait' {
        $bits = $arg.Split(' ', 2)
        Write-Reply 'OK' ([VantaHwnd]::WaitNew($bits[0], $(if ($bits.Length -gt 1) { $bits[1] } else { '' })))
      }
      'findAt' {
        $bits = $arg.Split(' ')
        Write-Reply 'OK' ([VantaHwnd]::FindAt($bits[0], $bits[1]))
      }
      'own' {
        $bits = $arg.Split(' ', 2)
        [VantaHwnd]::OwnFrameless($bits[0], $bits[1])
        Write-Reply 'OK' ''
      }
      'ownTopLevel' {
        $bits = $arg.Split(' ', 2)
        [VantaHwnd]::OwnTopLevel($bits[0], $bits[1])
        Write-Reply 'OK' ''
      }
      'place' {
        $bits = $arg.Split(' ')
        [VantaHwnd]::Place($bits[0], [int]$bits[1], [int]$bits[2], [int]$bits[3], [int]$bits[4])
        Write-Reply 'OK' ''
      }
      'placeMany' { [VantaHwnd]::PlaceMany($arg); Write-Reply 'OK' '' }
      'clickThrough' {
        $bits = $arg.Split(' ')
        [VantaHwnd]::ClickThrough($bits[0], [int]$bits[1])
        Write-Reply 'OK' ''
      }
      'raise' { [VantaHwnd]::Raise($arg); Write-Reply 'OK' '' }
      'show' {
        $bits = $arg.Split(' ')
        [VantaHwnd]::Show($bits[0], [int]$bits[1])
        Write-Reply 'OK' ''
      }
      'focus' { [VantaHwnd]::Focus($arg); Write-Reply 'OK' '' }
      'close' { [VantaHwnd]::Close($arg); Write-Reply 'OK' '' }
      'alive' { Write-Reply 'OK' ([VantaHwnd]::Alive($arg)) }
      default { Write-Reply 'ERR' 'unknown command' }
    }
  } catch {
    Write-Reply 'ERR' $_.Exception.Message
  }
}
`

export class HwndBridge {
  private child: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private ready: Promise<void> | null = null
  private waiters: Waiter[] = []

  supported(): boolean {
    return process.platform === 'win32'
  }

  async ensure(): Promise<void> {
    if (!this.supported()) throw new Error('Native browser embedding is currently implemented on Windows only')
    if (this.child && !this.child.killed) return this.ready ?? Promise.resolve()
    const script = join(tmpdir(), 'vanta-hwnd-bridge.ps1')
    writeFileSync(script, WORKER, 'utf8')
    this.child = spawn('powershell.exe', ['-NoProfile', '-STA', '-File', script], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.child.stdout.setEncoding('utf8')
    this.child.stderr?.setEncoding('utf8')
    this.child.stderr?.on('data', (chunk: string) => {
      const text = chunk.trim()
      if (text) console.error('[hwnd]', text)
    })
    this.child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk
      let newline = this.buffer.indexOf('\n')
      while (newline >= 0) {
        const line = this.buffer.slice(0, newline).replace(/\r$/, '')
        this.buffer = this.buffer.slice(newline + 1)
        if (line !== 'READY') {
          const waiter = this.waiters.shift()
          if (waiter) waiter.resolve(line)
        }
        newline = this.buffer.indexOf('\n')
      }
    })
    this.child.on('exit', () => {
      const error = new Error('window helper exited')
      while (this.waiters.length) this.waiters.shift()?.reject(error)
      this.child = null
      this.ready = null
    })
    this.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('window helper did not start')), 12_000)
      const onData = (chunk: string) => {
        if (!chunk.includes('READY')) return
        clearTimeout(timer)
        this.child?.stdout.off('data', onData)
        resolve()
      }
      this.child?.stdout.on('data', onData)
      this.child?.once('exit', () => {
        clearTimeout(timer)
        reject(new Error('window helper exited during startup'))
      })
    })
    await this.ready
  }

  private async rpc(command: string, timeoutMs: number): Promise<string> {
    await this.ensure()
    if (!this.child) throw new Error('window helper is not running')
    const line = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.resolve === resolve)
        if (index >= 0) this.waiters.splice(index, 1)
        reject(new Error(`window helper timeout: ${command}`))
      }, timeoutMs)
      this.waiters.push({
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        }
      })
      this.child!.stdin.write(command + '\n')
    }).catch((error) => {
      if (String(error.message || error).includes('timeout')) {
        this.dispose()
      }
      throw error
    })
    const sep = line.indexOf('|')
    const kind = sep < 0 ? line : line.slice(0, sep)
    const body = sep < 0 ? '' : line.slice(sep + 1)
    if (kind === 'ERR') throw new Error(body || 'window helper error')
    return body
  }

  async list(): Promise<string[]> {
    const body = await this.rpc('list', 4_000)
    return body ? body.split(',').filter(Boolean) : []
  }

  async waitNew(exclude: string[], timeoutMs = 8_000): Promise<string> {
    const hwnd = await this.rpc(`wait ${timeoutMs} ${exclude.join(',')}`, timeoutMs + 1_000)
    if (!hwnd) throw new Error('timed out waiting for browser window')
    return hwnd
  }

  async findAt(x: number, y: number): Promise<string> {
    return this.rpc(`findAt ${Math.round(x)} ${Math.round(y)}`, 4_000)
  }

  async ownFrameless(hwnd: string, owner: string): Promise<void> {
    await this.rpc(`own ${hwnd} ${owner}`, 4_000)
  }

  async ownTopLevel(hwnd: string, owner: string): Promise<void> {
    await this.rpc(`ownTopLevel ${hwnd} ${owner}`, 4_000)
  }

  async place(hwnd: string, bounds: NativeBounds): Promise<void> {
    await this.rpc(
      `place ${hwnd} ${Math.round(bounds.x)} ${Math.round(bounds.y)} ${Math.round(bounds.width)} ${Math.round(bounds.height)}`,
      4_000
    )
  }

  async placeMany(items: Array<{ hwnd: string; bounds: NativeBounds }>): Promise<void> {
    if (items.length === 0) return
    const spec = items
      .map(
        (item) =>
          `${item.hwnd},${Math.round(item.bounds.x)},${Math.round(item.bounds.y)},${Math.round(item.bounds.width)},${Math.round(item.bounds.height)}`
      )
      .join('|')
    await this.rpc(`placeMany ${spec}`, 4_000)
  }

  async clickThrough(hwnd: string, enable: boolean): Promise<void> {
    await this.rpc(`clickThrough ${hwnd} ${enable ? 1 : 0}`, 4_000)
  }

  async raise(hwnd: string): Promise<void> {
    await this.rpc(`raise ${hwnd}`, 2_000)
  }

  async show(hwnd: string, visible: boolean): Promise<void> {
    await this.rpc(`show ${hwnd} ${visible ? 1 : 0}`, 2_000)
  }

  async focus(hwnd: string): Promise<void> {
    await this.rpc(`focus ${hwnd}`, 2_000)
  }

  async close(hwnd: string): Promise<void> {
    await this.rpc(`close ${hwnd}`, 2_000)
  }

  async alive(hwnd: string): Promise<boolean> {
    try {
      return (await this.rpc(`alive ${hwnd}`, 2_000)) === '1'
    } catch {
      return false
    }
  }

  dispose(): void {
    try {
      this.child?.stdin.write('quit\n')
    } catch {
      /* ignore */
    }
    this.child?.kill()
    this.child = null
  }
}

export const hwndBridge = new HwndBridge()
