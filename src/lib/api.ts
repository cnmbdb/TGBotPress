import { translateApiMessage } from './api-messages'
export class ApiError extends Error { constructor(public status: number, message: string) { super(message) } }
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const apiUrl = url.startsWith('/api/') && !url.startsWith('/api/telegram/getdata') ? url.replace(/^(\/api\/[^?]+)(\?.*)?$/, (_match, path, query = '') => `${path.endsWith('/') ? path : `${path}/`}${query}`) : url
  const response = await fetch(apiUrl, { credentials: 'same-origin', ...init })
  const data = await response.json()
  if (!response.ok) throw new ApiError(response.status, translateApiMessage(data.message || '操作失败'))
  if (apiUrl === '/api/auth/logout/' && typeof window !== 'undefined' && typeof data?.accessLogoutUrl === 'string' && data.accessLogoutUrl) {
    window.location.assign(data.accessLogoutUrl)
    return await new Promise<T>(() => {})
  }
  if (data && typeof data === 'object' && !Array.isArray(data) && typeof data.message === 'string') {
    const message = translateApiMessage(data.message)
    if (message !== data.message) return { ...data, message } as T
  }
  return data
}
