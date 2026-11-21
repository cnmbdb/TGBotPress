import { createFileRoute } from '@tanstack/react-router'
import { AdminShell, type AdminUser } from '@/components/admin-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, ApiError } from '@/lib/api'
import { createRechargeOrdersPage } from '@tgbotpress/plugin-groups/recharge-orders-page'
const RechargeOrders = createRechargeOrdersPage({ AdminShell, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, api, ApiError })
export const Route = createFileRoute('/console/recharge-orders')({ component: RechargeOrders })
