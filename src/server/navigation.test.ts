import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { adminNavigation } from '../config/admin-navigation'
import { adminMenuHref, visibleNavigation } from '../lib/navigation'
import { authDestination } from './auth-destination'

test('all 47 original menu pages have unique canonical routes across 12 groups', () => {
  const pages = adminNavigation.flatMap(group => group.items)
  assert.equal(adminNavigation.length, 12)
  assert.equal(pages.length, 47)
  assert.equal(new Set(pages.map(page => page.id)).size, 47)
  assert.equal(new Set(pages.map(page => page.path)).size, 47)
  for (const page of pages) assert.match(page.path, /^\/admin\/[a-z0-9_/-]+$/)
  assert.equal(visibleNavigation({ roles: ['超级管理员'], permissions: [] }).flatMap(group => group.items).length, 47)
})
test('migration manifest covers all menu pages and 290 required actions', () => {
  const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
  const manifest = JSON.parse(readFileSync(join(repositoryRoot, 'docs/migrations/menu-parity.json'), 'utf8')) as {
    pagesDetail: { id: string; requiredActions: { path: string; methods: string[] }[] }[]
  }
  const menuPages = adminNavigation.flatMap(group => group.items)
  const actions = manifest.pagesDetail.flatMap(page => page.requiredActions)
  assert.equal(manifest.pagesDetail.length, 47)
  assert.deepEqual(manifest.pagesDetail.map(page => page.id).sort(), menuPages.map(page => page.id).sort())
  assert.equal(actions.length, 290)
  assert.equal(new Set(actions.map(action => action.path)).size, 279)
  for (const action of actions) {
    assert.ok(action.path.startsWith('/admin/'))
    assert.ok(action.methods.length > 0)
  }
})
test('all 47 admin menu entries route to an existing native TanStack page', () => {
  const pages = adminNavigation.flatMap(group => group.items)
  const routesDirectory = fileURLToPath(new URL('../routes/', import.meta.url))
  for (const page of pages) {
    const href = adminMenuHref(page.id)
    assert.equal(href.startsWith('/api/legacy'), false, `${page.id} must not fall back to PHP`)
    const moduleName = `${href.slice(1).replaceAll('/', '.')}.tsx`
    assert.equal(existsSync(join(routesDirectory, moduleName)), true, `${page.id} is missing ${moduleName}`)
  }
})
test('menu access preserves both original parent and leaf permission requirements', () => {
  const pages = (permissions: string[]) => visibleNavigation({ roles: [], permissions }).flatMap(group => group.items).map(page => page.id)
  assert.equal(pages(['群组列表']).includes('admin.groupuser.group.index'), false)
  assert.equal(pages(['群组用户', '群组列表']).includes('admin.groupuser.group.index'), true)
  assert.equal(pages([]).includes('admin.system.admin.index'), false)
  assert.deepEqual(pages([]), ['admin.home'])
})
test('authentication callback destination cannot become an open redirect', () => {
  assert.equal(authDestination('bots'), '/migration/bots')
  for (const value of ['https://attacker.invalid', '//attacker.invalid', '/admin/home', '../', null, undefined]) assert.equal(authDestination(value), '/console/home')
})

test('a direct route grant exposes only its matching menu page', () => {
  const pages = visibleNavigation({ roles: [], permissions: [], routes: ['admin.telegram.command.index'] }).flatMap(group => group.items).map(page => page.id)
  assert.deepEqual(pages, ['admin.home', 'admin.telegram.command.index'])
})
