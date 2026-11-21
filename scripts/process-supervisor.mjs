import { spawn as nodeSpawn } from 'node:child_process'

export function createProcessSupervisor({
  spawnImpl = nodeSpawn,
  signalTarget = process,
  killTimeoutMs = 15_000,
} = {}) {
  const children = new Set()
  let stopping = false
  let shutdownTimer

  function stop(signal = 'SIGTERM') {
    if (stopping) return
    stopping = true
    for (const child of children) child.kill(signal)
    if (children.size) {
      shutdownTimer = setTimeout(() => {
        for (const child of children) child.kill('SIGKILL')
      }, killTimeoutMs)
      shutdownTimer.unref?.()
    }
  }

  const onSigterm = () => stop('SIGTERM')
  const onSigint = () => stop('SIGINT')
  signalTarget.once('SIGTERM', onSigterm)
  signalTarget.once('SIGINT', onSigint)

  function runChild({ label, command = process.execPath, args, env = process.env }) {
    if (stopping) return Promise.resolve({ code: 0, signal: null })
    return new Promise(resolve => {
      let child
      let settled = false
      const finish = result => {
        if (settled) return
        settled = true
        if (child) children.delete(child)
        if (!children.size && shutdownTimer) {
          clearTimeout(shutdownTimer)
          shutdownTimer = undefined
        }
        resolve(result)
      }
      try {
        child = spawnImpl(command, args, { env, stdio: 'inherit' })
        children.add(child)
        child.once('error', error => {
          console.error(label + ' process failed to start: ' + error.message)
          finish({ code: 1, signal: null })
        })
        child.once('exit', (code, signal) => finish({ code: code ?? 1, signal }))
      } catch (error) {
        console.error(label + ' process failed to start: ' + (error instanceof Error ? error.message : 'unknown error'))
        finish({ code: 1, signal: null })
      }
    })
  }

  async function runGroup(services) {
    if (!services.length) return { exitCode: 78, stopping }
    const exits = services.map(service => runChild(service))
    const firstExit = await Promise.race(exits)
    let exitCode = 0
    if (!stopping) {
      exitCode = firstExit.code === 0 ? 1 : firstExit.code
      stop('SIGTERM')
    }
    await Promise.all(exits)
    return { exitCode, stopping }
  }

  function dispose() {
    signalTarget.removeListener('SIGTERM', onSigterm)
    signalTarget.removeListener('SIGINT', onSigint)
    if (shutdownTimer) clearTimeout(shutdownTimer)
  }

  return { runChild, runGroup, stop, dispose, get stopping() { return stopping } }
}
