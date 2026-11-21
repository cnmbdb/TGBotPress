import { test } from 'node:test'
import assert from 'node:assert/strict'
import { token, digest, equalTokens, isToken, cookies, cookie } from './security'
test('callback state cannot match malformed, truncated or attacker-selected tokens', () => {
 const state=token(); assert.equal(equalTokens(state,state),true)
 for(const forged of ['',state.slice(1),state+'0','g'.repeat(64),token()]) assert.equal(equalTokens(state,forged),false)
 assert.equal(isToken({}),false);assert.equal(digest(state).length,64)
})
test('duplicate and malformed cookies do not override the first valid credential', () => {
 const request=new Request('https://example.test',{headers:{cookie:'session=first; bad=%; session=attacker'}})
 assert.deepEqual(cookies(request),{session:'first'})
})
test('HTTPS session cookie is scoped to host, HTTP-only and SameSite', () => {
 process.env.PLATFORM_ORIGIN='https://example.test'
 const value=cookie('session',token(),3600)
 assert.match(value,/HttpOnly/);assert.match(value,/SameSite=Lax/);assert.match(value,/; Secure$/);assert.doesNotMatch(value,/Domain=/)
})
