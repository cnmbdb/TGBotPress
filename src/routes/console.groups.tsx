import { createFileRoute } from '@tanstack/react-router'
import { AdminShell, type AdminUser } from '@/components/admin-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api, ApiError } from '@/lib/api'
import { createGroupsPage } from '@tgbotpress/plugin-groups/groups-page'
const Groups = createGroupsPage({ AdminShell, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Textarea, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, api, ApiError })
export const Route = createFileRoute('/console/groups')({ component: Groups })
