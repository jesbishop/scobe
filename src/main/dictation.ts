import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'

export type DictationEvent =
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string }
  | { type: 'error'; text: string }

type StartResult = { ok: true } | { ok: false; error: string }

const listeners = new Set<(event: DictationEvent) => void>()

let child: ChildProcess | null = null
let starting: Promise<StartResult> | null = null
let stopping = false

function emit(event: DictationEvent): void {
  for (const fn of listeners) fn(event)
}

export function onDictation(fn: (event: DictationEvent) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

const SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
try {
  Add-Type -AssemblyName System.Speech
  Add-Type -AssemblyName System.Windows.Forms
  $infos = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
  if ($infos.Count -eq 0) { throw 'No speech recognizer is installed.' }
  $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine($infos[0].Culture)
  $engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  $engine.SetInputToDefaultAudioDevice()
  $engine.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(800)
  $engine.EndSilenceTimeoutAmbiguous = [TimeSpan]::FromMilliseconds(1100)
  $engine.add_SpeechHypothesized({
    param($sender, $e)
    $text = $e.Result.Text
    if ($text) { [Console]::Out.WriteLine("P\`t$text"); [Console]::Out.Flush() }
  })
  $engine.add_SpeechRecognized({
    param($sender, $e)
    $text = $e.Result.Text
    if ($text) { [Console]::Out.WriteLine("F\`t$text"); [Console]::Out.Flush() }
  })
  $engine.add_SpeechRecognitionRejected({
    param($sender, $e)
    $text = if ($e.Result) { $e.Result.Text } else { '' }
    if ($text) { [Console]::Out.WriteLine("F\`t$text"); [Console]::Out.Flush() }
  })
  [Console]::Out.WriteLine('R\`tready')
  [Console]::Out.Flush()
  $engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
  while ($true) {
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 30
  }
} catch {
  [Console]::Out.WriteLine("E\`t$($_.Exception.Message)")
  [Console]::Out.Flush()
  exit 1
}
`

function powershellPath(): string {
  const root = process.env.SystemRoot || 'C:\\\\Windows'
  return join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

function readLine(line: string): { kind: string; text: string } | null {
  const trimmed = line.replace(/^\uFEFF/, '').trim()
  if (!trimmed || trimmed.startsWith('<') || trimmed.startsWith('#')) return null
  const tab = trimmed.indexOf('\t')
  if (tab < 1) return null
  const text = trimmed.slice(tab + 1).trim()
  if (!text) return null
  return { kind: trimmed.slice(0, tab), text }
}

/** Live Windows dictation. Hypotheses update as the person speaks; a pause emits the phrase. */
export function startDictation(): Promise<StartResult> {
  if (process.platform !== 'win32') return Promise.resolve({ ok: false, error: 'Live dictation is only set up on Windows.' })
  if (child) return Promise.resolve({ ok: true })
  if (starting) return starting

  starting = new Promise<StartResult>((resolve) => {
    stopping = false
    const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64')
    const proc = spawn(powershellPath(), ['-NoProfile', '-STA', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    child = proc
    let settled = false
    let buffer = ''
    if (!proc.stdout) {
      proc.kill()
      child = null
      resolve({ ok: false, error: 'Could not read speech recognition.' })
      return
    }

    const finish = (result: StartResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const timer = setTimeout(() => {
      finish({ ok: false, error: 'Speech recognizer took too long to start.' })
      if (child === proc) {
        stopping = true
        proc.kill()
        child = null
      }
    }, 4000)

    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => {
      buffer += chunk
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() || ''
      for (const line of lines) {
        const message = readLine(line)
        if (!message) continue
        if (message.kind === 'R') finish({ ok: true })
        else if (message.kind === 'E') {
          emit({ type: 'error', text: message.text })
          finish({ ok: false, error: message.text })
          if (child === proc) {
            stopping = true
            proc.kill()
            child = null
          }
        } else if (message.kind === 'P') emit({ type: 'partial', text: message.text })
        else if (message.kind === 'F') emit({ type: 'final', text: message.text })
      }
    })

    proc.on('error', (error) => {
      if (child === proc) child = null
      const message = error.message || 'Could not start speech recognition.'
      emit({ type: 'error', text: message })
      finish({ ok: false, error: message })
    })

    proc.on('exit', () => {
      if (child === proc) child = null
      if (!stopping && !settled) {
        finish({ ok: false, error: 'Speech recognizer stopped.' })
      } else if (!stopping) {
        emit({ type: 'error', text: 'Speech recognizer stopped.' })
      }
    })
  }).finally(() => {
    starting = null
  })

  return starting
}

export function stopDictation(): void {
  stopping = true
  const proc = child
  child = null
  if (!proc) return
  proc.kill()
}
