/** Lifecycle decisions are shared by built-in plugins. The caller must hold the
 * plugin's exclusive transaction lock while checking blockers and persisting. */
export type PluginLifecycleState = 'active' | 'draining' | 'uninstalled'
export type PluginLifecycleAction = 'install' | 'disable' | 'resume' | 'uninstall'
export type PluginBlockers = { inFlight: number; obligations: number; dependents: number }

export class PluginLifecycleError extends Error {
  constructor(readonly code: 'already_installed' | 'not_installed' | 'must_drain' | 'outstanding_business') { super(code) }
}

export function decidePluginTransition(state: PluginLifecycleState, action: PluginLifecycleAction, blockers: PluginBlockers): PluginLifecycleState {
  if (Object.values(blockers).some(value => !Number.isSafeInteger(value) || value < 0)) throw new TypeError('invalid_plugin_blocker_count')
  if (action === 'install') {
    if (state !== 'uninstalled') throw new PluginLifecycleError('already_installed')
    return 'active'
  }
  if (action === 'disable') {
    if (state === 'uninstalled') throw new PluginLifecycleError('not_installed')
    return 'draining'
  }
  if (action === 'resume') {
    if (state === 'uninstalled') throw new PluginLifecycleError('not_installed')
    return 'active'
  }
  if (state === 'uninstalled') return state
  if (state !== 'draining') throw new PluginLifecycleError('must_drain')
  if (blockers.inFlight || blockers.obligations || blockers.dependents) throw new PluginLifecycleError('outstanding_business')
  return 'uninstalled'
}
