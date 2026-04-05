import { spawn, type ChildProcess } from 'node:child_process'

const MAX_OUTPUT_BYTES = 1 * 1024 * 1024 // 1MB per command

export interface SessionCallbacks {
  onStdout: (data: string) => void
  onStderr: (data: string) => void
  onExit: (code: number) => void
  onError: (message: string) => void
}

export class ShellSession {
  private process: ChildProcess | null = null
  private totalBytes = 0
  private truncated = false
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null

  // Debounce state
  private stdoutBuffer = ''
  private stderrBuffer = ''
  private stdoutTimer: ReturnType<typeof setTimeout> | null = null
  private stderrTimer: ReturnType<typeof setTimeout> | null = null
  private callbacks: SessionCallbacks | null = null

  private flushStdout(): void {
    if (this.stdoutBuffer && this.callbacks) {
      this.callbacks.onStdout(this.stdoutBuffer)
      this.stdoutBuffer = ''
    }
    this.stdoutTimer = null
  }

  private flushStderr(): void {
    if (this.stderrBuffer && this.callbacks) {
      this.callbacks.onStderr(this.stderrBuffer)
      this.stderrBuffer = ''
    }
    this.stderrTimer = null
  }

  private scheduleFlushStdout(): void {
    if (!this.stdoutTimer) {
      this.stdoutTimer = setTimeout(() => this.flushStdout(), 100)
    }
  }

  private scheduleFlushStderr(): void {
    if (!this.stderrTimer) {
      this.stderrTimer = setTimeout(() => this.flushStderr(), 100)
    }
  }

  exec(
    command: string,
    cwd: string | undefined,
    timeout: number,
    callbacks: SessionCallbacks,
  ): void {
    if (this.process) {
      callbacks.onError('Session already has a running process')
      return
    }

    this.callbacks = callbacks
    this.totalBytes = 0
    this.truncated = false

    const isWindows = process.platform === 'win32'
    const shell = isWindows ? 'cmd' : 'bash'
    const shellArgs = isWindows ? ['/c', command] : ['-c', command]

    try {
      this.process = spawn(shell, shellArgs, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
        detached: process.platform !== 'win32', // create process group on unix
      })
    } catch (err) {
      callbacks.onError(`Failed to spawn process: ${err instanceof Error ? err.message : String(err)}`)
      return
    }

    // Set timeout
    this.timeoutHandle = setTimeout(() => {
      console.log(`[ShellSession] Command timed out after ${timeout}s, killing process`)
      this.kill()
      callbacks.onError(`Command timed out after ${timeout}s`)
    }, timeout * 1000)

    this.process.stdout?.on('data', (chunk: Buffer) => {
      if (this.truncated) return

      const data = chunk.toString('utf8')
      this.totalBytes += Buffer.byteLength(data, 'utf8')

      if (this.totalBytes > MAX_OUTPUT_BYTES) {
        this.truncated = true
        const warning = '\n[WARNING: Output truncated at 1MB limit]\n'
        this.stdoutBuffer += warning
        this.scheduleFlushStdout()
        return
      }

      this.stdoutBuffer += data
      this.scheduleFlushStdout()
    })

    this.process.stderr?.on('data', (chunk: Buffer) => {
      if (this.truncated) return

      const data = chunk.toString('utf8')
      this.totalBytes += Buffer.byteLength(data, 'utf8')

      if (this.totalBytes > MAX_OUTPUT_BYTES) {
        this.truncated = true
        const warning = '\n[WARNING: Output truncated at 1MB limit]\n'
        this.stderrBuffer += warning
        this.scheduleFlushStderr()
        return
      }

      this.stderrBuffer += data
      this.scheduleFlushStderr()
    })

    this.process.on('error', (err: Error) => {
      this.clearTimeout()
      this.flushStdout()
      this.flushStderr()
      this.process = null
      callbacks.onError(err.message)
    })

    this.process.on('close', (code: number | null) => {
      this.clearTimeout()
      // Flush any remaining buffered output before exit
      if (this.stdoutTimer) {
        clearTimeout(this.stdoutTimer)
        this.stdoutTimer = null
      }
      if (this.stderrTimer) {
        clearTimeout(this.stderrTimer)
        this.stderrTimer = null
      }
      this.flushStdout()
      this.flushStderr()
      this.process = null
      callbacks.onExit(code ?? 1)
    })
  }

  kill(): void {
    if (this.process) {
      try {
        // Kill entire process group on unix (handles shell children)
        if (this.process.pid && process.platform !== 'win32') {
          process.kill(-this.process.pid, 'SIGTERM')
        } else {
          this.process.kill('SIGTERM')
        }
        // Force kill after 2s if still running
        setTimeout(() => {
          if (this.process) {
            try {
              if (this.process.pid && process.platform !== 'win32') {
                process.kill(-this.process.pid, 'SIGKILL')
              } else {
                this.process.kill('SIGKILL')
              }
            } catch {
              // already dead
            }
          }
        }, 2000)
      } catch (err) {
        console.error('[ShellSession] Error killing process:', err)
      }
    }
  }

  private clearTimeout(): void {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle)
      this.timeoutHandle = null
    }
  }
}
