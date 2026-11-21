import { createFileRoute } from '@tanstack/react-router'
import { MessageConfigConsole } from '@/components/message-config-console'
export const Route=createFileRoute('/console/keyreply')({component:()=> <MessageConfigConsole kind="reply" />})
