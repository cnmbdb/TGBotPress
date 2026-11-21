import { Globe } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { locales, localeLabels, setRuntimeLocale, type Locale } from '@/lib/i18n'
import { translateUiText } from '@/lib/ui-locale-extra'
import { translateUiAttribute } from '@/lib/ui-locale-attributes'
import { untranslatedTextSelector } from '@/lib/locale-dom'

type LocaleContextValue={locale:Locale;setLocale:(value:Locale)=>Promise<void>;t:(value:string)=>string;saveError:string}
type LocaleRuntime = {
 __tgUltraLocaleContext?: ReturnType<typeof createContext<LocaleContextValue | null>>
 __tgUltraOriginalTextNodes?: WeakMap<Text,string>
 __tgUltraRenderedTextNodes?: WeakMap<Text,string>
 __tgUltraOriginalAttributes?: WeakMap<Element,Map<string,string>>
 __tgUltraRenderedAttributes?: WeakMap<Element,Map<string,string>>
}
const localeRuntime = globalThis as typeof globalThis & LocaleRuntime
// Keep caches and context stable across Vite HMR so live translated DOM can always return to its source text.
const originalTextNodes=localeRuntime.__tgUltraOriginalTextNodes ??= new WeakMap<Text,string>()
const renderedTextNodes=localeRuntime.__tgUltraRenderedTextNodes ??= new WeakMap<Text,string>()
const originalAttributes=localeRuntime.__tgUltraOriginalAttributes ??= new WeakMap<Element,Map<string,string>>()
const renderedAttributes=localeRuntime.__tgUltraRenderedAttributes ??= new WeakMap<Element,Map<string,string>>()
const LocaleContext=localeRuntime.__tgUltraLocaleContext ??= createContext<LocaleContextValue|null>(null)
export function LocaleProvider({children}:{children:ReactNode}){
 const [locale,setLocaleState]=useState<Locale>('zh-CN'),[saveError,setSaveError]=useState('')
 useEffect(()=>{
  let alive=true
  const local=localStorage.getItem('tg-ultra-locale')
  if(locales.includes(local as Locale)){setLocaleState(local as Locale);setRuntimeLocale(local as Locale)}
  fetch('/api/admin-locale',{credentials:'same-origin'}).then(async response=>{if(!response.ok)return null;return await response.json() as {locale?:string}}).then(value=>{if(alive&&locales.includes(value?.locale as Locale)){setRuntimeLocale(value!.locale as Locale);setLocaleState(value!.locale as Locale);localStorage.setItem('tg-ultra-locale',value!.locale as string)}}).catch(()=>undefined)
  return()=>{alive=false}
 },[])
 useEffect(()=>{
  document.documentElement.lang=locale;setRuntimeLocale(locale);localStorage.setItem('tg-ultra-locale',locale)
  const blocked=(node:Node)=>Boolean(node.parentElement?.closest(untranslatedTextSelector))
  const renderText=(node:Text)=>{
   if(blocked(node))return
   const last=renderedTextNodes.get(node)
   const base=last&&node.data===last?originalTextNodes.get(node)??node.data:node.data
   originalTextNodes.set(node,base)
   const translated=translateUiText(base,locale)
   if(translated!==node.data){renderedTextNodes.set(node,translated);node.data=translated}else if(base!==node.data){renderedTextNodes.set(node,node.data)}else renderedTextNodes.delete(node)
  }
  const renderAttribute=(element:Element,name:string)=>{
   const value=element.getAttribute(name);if(value===null)return
   let originals=originalAttributes.get(element);if(!originals){originals=new Map();originalAttributes.set(element,originals)}
   let rendered=renderedAttributes.get(element);if(!rendered){rendered=new Map();renderedAttributes.set(element,rendered)}
   const last=rendered.get(name),base=last===value?originals.get(name)??value:value
   originals.set(name,base);const translated=translateUiAttribute(base,locale,name)
   if(translated!==value){rendered.set(name,translated);element.setAttribute(name,translated)}else if(base!==value){rendered.set(name,value)}else rendered.delete(name)
  }
  const renderSubtree=(node:Node)=>{
   if(node.nodeType===Node.TEXT_NODE){renderText(node as Text);return}
   if(node.nodeType!==Node.ELEMENT_NODE&&node!==document.body)return
   const element=node as Element
   const elements=[element,...Array.from(element.querySelectorAll('*'))]
   for(const candidate of elements)for(const name of ['aria-label','title','placeholder','alt'])renderAttribute(candidate,name)
   const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT)
   while(walker.nextNode())renderText(walker.currentNode as Text)
  }
  renderSubtree(document.body)
  const observer=new MutationObserver(records=>{for(const record of records){if(record.type==='characterData'&&record.target.nodeType===Node.TEXT_NODE)renderText(record.target as Text);else if(record.type==='attributes'&&record.target instanceof Element&&record.attributeName)renderAttribute(record.target,record.attributeName);else for(const node of Array.from(record.addedNodes))renderSubtree(node)}})
  observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-label','title','placeholder','alt']})
  return()=>observer.disconnect()
 },[locale])
 const setLocale=useCallback(async(value:Locale)=>{setRuntimeLocale(value);setLocaleState(value);setSaveError('');try{const response=await fetch('/api/admin-locale',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({locale:value})});if(!response.ok)throw new Error('save');localStorage.setItem('tg-ultra-locale',value)}catch{setSaveError(translateUiText('语言偏好未能保存',value))}},[])
 const value=useMemo(()=>({locale,setLocale,t:(text:string)=>translateUiText(text,locale),saveError}),[locale,setLocale,saveError])
 return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}
export function useLocale(){const value=useContext(LocaleContext);if(!value)throw new Error('LocaleProvider is missing');return value}
export function LanguageSwitcher(){
 const {locale,setLocale,saveError,t}=useLocale()
 return <div className="flex items-center gap-1.5"><Select value={locale} onValueChange={value=>void setLocale(value as Locale)}><SelectTrigger aria-label={t('语言')} className="size-8 justify-center border-0 bg-transparent p-0 shadow-none hover:bg-accent focus-visible:ring-2 [&>svg:last-child]:hidden"><Globe className="size-4" aria-hidden="true"/></SelectTrigger><SelectContent position="popper" align="end" sideOffset={6}>{locales.map(code=><SelectItem key={code} value={code} className="text-xs">{localeLabels[code]}</SelectItem>)}</SelectContent></Select><span className="sr-only" role="status">{saveError}</span></div>
}
export function useLocaleText(){return useLocale().t}
