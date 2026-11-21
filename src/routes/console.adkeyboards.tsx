import {createFileRoute} from '@tanstack/react-router'
import {KeyboardRelationsConsole} from '@/components/keyboard-relations-console'
export const Route=createFileRoute('/console/adkeyboards')({component:()=> <KeyboardRelationsConsole kind="ad"/>})
