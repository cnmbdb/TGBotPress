import { can, identity, run } from './api.server'
import { db } from './db.server'
import { getCloneProxyLifecycle, lockCloneProxyLifecycle, transitionCloneProxyLifecycle } from '../plugins/cloneproxy/lifecycle.server'
import { createCloneProxyApi } from '@tgbotpress/plugin-cloneproxy/admin-api.js'

/** Preserve the built-in entry point while injecting host security and lifecycle services. */
export const cloneProxyApi = createCloneProxyApi({ db, identity, can, run, getCloneProxyLifecycle, lockCloneProxyLifecycle, transitionCloneProxyLifecycle })
