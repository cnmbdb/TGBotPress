import { createFileRoute } from '@tanstack/react-router'
import { TelegramConfigConsole } from '@/components/telegram-config-console'
export const Route=createFileRoute('/console/keyboards')({component:()=> <TelegramConfigConsole kind="keyboard" />})
