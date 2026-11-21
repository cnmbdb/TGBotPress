import type { ComponentType, ReactElement } from 'react'

export interface RechargeTradesPageHost {
  AdminShell: ComponentType<any>
  Button: ComponentType<any>
  Input: ComponentType<any>
  Table: ComponentType<any>
  TableBody: ComponentType<any>
  TableCell: ComponentType<any>
  TableHead: ComponentType<any>
  TableHeader: ComponentType<any>
  TableRow: ComponentType<any>
  Select: ComponentType<any>
  SelectContent: ComponentType<any>
  SelectItem: ComponentType<any>
  SelectTrigger: ComponentType<any>
  SelectValue: ComponentType<any>
  Dialog: ComponentType<any>
  DialogContent: ComponentType<any>
  DialogFooter: ComponentType<any>
  DialogHeader: ComponentType<any>
  DialogTitle: ComponentType<any>
  api: <T>(url: string, init?: RequestInit) => Promise<T>
  ApiError: new (status: number, message: string) => Error & { status: number }
}

export declare function createRechargeTradesPage(host: RechargeTradesPageHost): () => ReactElement
