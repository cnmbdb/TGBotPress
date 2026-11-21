export type ConfigKind = 'command' | 'keyboard'
export type ConfigField = {key:string;label:string;type:'text'|'number'|'select'|'bot';max?:number;options?:Record<string,string>;initial?:string;required?:boolean}
export const telegramConfig = {
  command: {title:'命令设置',singular:'命令',route:'admin.telegram.command.index',search:'命令',fields:[
    {key:'bot_rid',label:'机器人',type:'bot',required:true},
    {key:'command_type',label:'命令类型',type:'select',options:{'1':'通用','2':'私聊','3':'群聊'},initial:'1'},
    {key:'command',label:'命令',type:'text',max:50,required:true},
    {key:'description',label:'描述',type:'text',max:100,required:true},
    {key:'seq_sn',label:'排序',type:'number',initial:'0'},
  ] as ConfigField[]},
  keyboard: {title:'键盘设置',singular:'键盘',route:'admin.telegram.keyboard.index',search:'键盘名称',fields:[
    {key:'keyboard_type',label:'键盘类型',type:'select',options:{'1':'键盘','2':'内联按钮'},initial:'1'},
    {key:'keyboard_name',label:'键盘名称',type:'text',max:20,required:true},
    {key:'keyboard_icon_custom_emoji_id',label:'TG Emoji ID',type:'text',max:500},
    {key:'inline_type',label:'内联按钮类型',type:'select',options:{'0':'—','1':'URL','2':'回调'},initial:'0'},
    {key:'keyboard_value',label:'内联按钮值',type:'text',max:500,initial:'-'},
    {key:'seq_sn',label:'排序',type:'number',initial:'0'},
  ] as ConfigField[]},
} as const
