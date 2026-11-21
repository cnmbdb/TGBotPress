import { createFileRoute } from '@tanstack/react-router'
import { BotConsole } from '@/components/bot-console'
export const Route = createFileRoute('/migration/bots')({ component: BotConsole })
