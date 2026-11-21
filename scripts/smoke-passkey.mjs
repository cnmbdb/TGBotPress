const base='http://127.0.0.1:8083'
for (const [path,init] of [['/api/passkey-auth',{}],['/api/passkey-management',{}]]) {
  const response=await fetch(base+path,init)
  console.log(path,response.status,await response.text())
}
