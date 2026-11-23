import { createContext, createElement, useContext, type ButtonHTMLAttributes, type ComponentType, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TableHTMLAttributes, type TextareaHTMLAttributes, type TdHTMLAttributes, type ThHTMLAttributes } from 'react'

type ApiErrorConstructor = abstract new (...args: any[]) => Error
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string; asChild?: boolean }
type SelectProps = { value?: string; defaultValue?: string; disabled?: boolean; onValueChange?: (value: string) => void; children?: ReactNode }
type SwitchProps = { checked?: boolean; disabled?: boolean; onCheckedChange?: (checked: boolean) => void; id?: string; className?: string }
type DialogProps = { open?: boolean; onOpenChange?: (open: boolean) => void; children?: ReactNode }
export type PremiumAdminRuntime = {
  api: <T = unknown>(url: string, init?: RequestInit) => Promise<T>
  ApiError: ApiErrorConstructor
  AdminShell: ComponentType<any>
  Button: ComponentType<ButtonProps>
  Input: ComponentType<InputHTMLAttributes<HTMLInputElement>>
  Select: ComponentType<SelectProps>
  SelectContent: ComponentType<HTMLAttributes<HTMLDivElement>>
  SelectItem: ComponentType<HTMLAttributes<HTMLDivElement> & { value: string }>
  SelectTrigger: ComponentType<ButtonProps>
  SelectValue: ComponentType<HTMLAttributes<HTMLSpanElement> & { placeholder?: string }>
  Switch: ComponentType<SwitchProps>
  Table: ComponentType<TableHTMLAttributes<HTMLTableElement>>
  TableBody: ComponentType<HTMLAttributes<HTMLTableSectionElement>>
  TableCell: ComponentType<TdHTMLAttributes<HTMLTableCellElement>>
  TableHead: ComponentType<ThHTMLAttributes<HTMLTableCellElement>>
  TableHeader: ComponentType<HTMLAttributes<HTMLTableSectionElement>>
  TableRow: ComponentType<HTMLAttributes<HTMLTableRowElement>>
  Dialog: ComponentType<DialogProps>
  DialogContent: ComponentType<HTMLAttributes<HTMLDivElement> & { 'aria-describedby'?: string }>
  DialogFooter: ComponentType<HTMLAttributes<HTMLDivElement>>
  DialogHeader: ComponentType<HTMLAttributes<HTMLDivElement>>
  DialogTitle: ComponentType<HTMLAttributes<HTMLHeadingElement>>
  Textarea: ComponentType<TextareaHTMLAttributes<HTMLTextAreaElement>>
}

const runtimeContext = createContext<PremiumAdminRuntime | null>(null)

export function PremiumAdminProvider(props: { runtime: PremiumAdminRuntime; children?: ReactNode }) {
  return createElement(runtimeContext.Provider, { value: props.runtime }, props.children)
}

export function usePremiumAdminRuntime() {
  const runtime = useContext(runtimeContext)
  if (!runtime) throw new Error('PremiumAdminProvider is missing')
  return runtime
}
