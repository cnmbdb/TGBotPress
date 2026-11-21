export function isExpectedTurnstileResult(value:unknown,hostname:string,action:string):boolean {
  if(!value||typeof value!=="object")return false
  const result=value as Record<string,unknown>
  return result.success===true&&result.hostname===hostname&&result.action===action
}
