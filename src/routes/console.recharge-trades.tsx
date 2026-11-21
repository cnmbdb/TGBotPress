import { createFileRoute } from '@tanstack/react-router'
import { AdminShell, type AdminUser } from '@/components/admin-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api, ApiError } from '@/lib/api'
import { createRechargeTradesPage } from '@tgbotpress/plugin-groups/recharge-trades-page'
const RechargeTrades = createRechargeTradesPage({ AdminShell, Button, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, api, ApiError })
export const Route = createFileRoute('/console/recharge-trades')({ component: RechargeTrades })
