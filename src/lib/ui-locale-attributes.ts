import { translateUiText } from "./ui-locale-extra"
import type { Locale } from "./i18n"

type DynamicLocale = Exclude<Locale, "zh-CN">
const localized = (locale: DynamicLocale, en: string, ru: string, ja: string) =>
  locale === "en" ? en : locale === "ru" ? ru : ja

export function translateUiAttribute(value: string, locale: Locale, attribute: string): string {
  const exact = translateUiText(value, locale)
  if (exact !== value || locale === "zh-CN") return exact
  if (attribute !== "aria-label" && attribute !== "placeholder") return exact
  const l = locale as DynamicLocale
  let match: RegExpExecArray | null

  if ((match = /^选择订单 (\d+)$/.exec(value))) return localized(l, "Select order " + match[1], "Выбрать заказ №" + match[1], "注文 " + match[1] + " を選択")
  if ((match = /^(.+)机器人商品状态$/.exec(value))) return localized(l, "Bot product status for " + match[1], "Статус товара бота: " + match[1], "ボット商品 " + match[1] + " の状態")
  if ((match = /^启用(.+)插件$/.exec(value))) {
    const name = translateUiText(match[1], locale)
    return localized(l, "Enable " + name + " plugin", "Включить плагин «" + name + "»", name + " プラグインを有効化")
  }
  if ((match = /^在该机器人启用(.+)$/.exec(value))) return localized(l, "Enable " + translateUiText(match[1], locale) + " on this Bot", "Включить «" + translateUiText(match[1], locale) + "» для этого бота", "この Bot で" + translateUiText(match[1], locale) + "を有効化")
  if ((match = /^键盘 (\d+) 启用状态$/.exec(value))) return localized(l, "Keyboard " + match[1] + " enabled status", "Статус клавиатуры №" + match[1], "キーボード " + match[1] + " の有効状態")
  if ((match = /^(.+)状态$/.exec(value))) return localized(l, "Status for " + match[1], "Статус: " + match[1], match[1] + " の状態")
  if ((match = /^删除(.+)$/.exec(value))) return localized(l, "Delete " + match[1], "Удалить " + match[1], match[1] + " を削除")
  if ((match = /^切换 (.+) 状态$/.exec(value))) return localized(l, "Toggle " + match[1] + " status", "Изменить статус: " + match[1], match[1] + " の状態を切り替え")
  if ((match = /^编辑 (.+)$/.exec(value))) return localized(l, "Edit " + match[1], "Изменить: " + match[1], match[1] + " を編集")
  if ((match = /^删除 (.+)$/.exec(value))) return localized(l, "Delete " + match[1], "Удалить: " + match[1], match[1] + " を削除")
  if ((match = /^移除 (.+)$/.exec(value))) return localized(l, "Remove " + match[1], "Удалить: " + match[1], match[1] + " を削除")
  if ((match = /^添加 (.+) 的子权限$/.exec(value))) return localized(l, "Add a child permission to " + match[1], "Добавить дочернее право для " + match[1], match[1] + " に子権限を追加")
  if ((match = /^修改 (.+)$/.exec(value))) return localized(l, "Edit " + match[1], "Изменить: " + match[1], match[1] + " を変更")
  if ((match = /^选择交易 (\d+)$/.exec(value))) return localized(l, "Select trade " + match[1], "Выбрать сделку №" + match[1], "取引 " + match[1] + " を選択")
  if ((match = /^钱包 (\d+) 状态$/.exec(value))) return localized(l, "Wallet " + match[1] + " status", "Статус кошелька №" + match[1], "ウォレット " + match[1] + " の状態")
  if ((match = /^(收起|展开)机器人 (\d+) 详情$/.exec(value))) return localized(l, (match[1] === "收起" ? "Collapse" : "Expand") + " bot " + match[2] + " details", (match[1] === "收起" ? "Свернуть" : "Развернуть") + " сведения бота №" + match[2], "ボット " + match[2] + " の詳細を" + (match[1] === "收起" ? "折りたたむ" : "展開"))
  if ((match = /^机器人 (\d+) 操作$/.exec(value))) return localized(l, "Actions for bot " + match[1], "Действия бота №" + match[1], "ボット " + match[1] + " の操作")
  if ((match = /^启用归集钱包 (\d+)$/.exec(value))) return localized(l, "Enable collection wallet " + match[1], "Включить кошелёк сбора №" + match[1], "集金ウォレット " + match[1] + " を有効化")
  if ((match = /^编辑归集钱包 (\d+)$/.exec(value))) return localized(l, "Edit collection wallet " + match[1], "Изменить кошелёк сбора №" + match[1], "集金ウォレット " + match[1] + " を編集")
  if ((match = /^删除归集钱包 (\d+)$/.exec(value))) return localized(l, "Delete collection wallet " + match[1], "Удалить кошелёк сбора №" + match[1], "集金ウォレット " + match[1] + " を削除")
  if ((match = /^启用机器人监控 (\d+)$/.exec(value))) return localized(l, "Enable bot monitoring " + match[1], "Включить мониторинг бота №" + match[1], "ボット監視 " + match[1] + " を有効化")
  if ((match = /^启用监控钱包 (\d+)$/.exec(value))) return localized(l, "Enable monitoring wallet " + match[1], "Включить кошелёк мониторинга №" + match[1], "監視ウォレット " + match[1] + " を有効化")
  if ((match = /^编辑钱包 (\d+)$/.exec(value))) return localized(l, "Edit wallet " + match[1], "Изменить кошелёк №" + match[1], "ウォレット " + match[1] + " を編集")
  if ((match = /^删除钱包 (\d+)$/.exec(value))) return localized(l, "Delete wallet " + match[1], "Удалить кошелёк №" + match[1], "ウォレット " + match[1] + " を削除")
  if ((match = /^启用 (.+) (\d+)$/.exec(value))) {
    const title = translateUiText(match[1], locale)
    return localized(l, "Enable " + title + " " + match[2], "Включить " + title + " " + match[2], title + " " + match[2] + " を有効化")
  }
  if ((match = /^(收起|展开)记录 (\d+) 详情$/.exec(value))) return localized(l, (match[1] === "收起" ? "Collapse" : "Expand") + " record " + match[2] + " details", (match[1] === "收起" ? "Свернуть" : "Развернуть") + " запись №" + match[2], "レコード " + match[2] + " の詳細を" + (match[1] === "收起" ? "折りたたむ" : "展開"))
  if ((match = /^记录 (\d+) 操作$/.exec(value))) return localized(l, "Actions for record " + match[1], "Действия записи №" + match[1], "レコード " + match[1] + " の操作")
  if ((match = /^搜索(.+)$/.exec(value))) return localized(l, "Search " + translateUiText(match[1], locale), "Поиск: " + translateUiText(match[1], locale), translateUiText(match[1], locale) + "を検索")
  if ((match = /^(.+)列表$/.exec(value))) return localized(l, translateUiText(match[1], locale) + " list", "Список: " + translateUiText(match[1], locale), translateUiText(match[1], locale) + "一覧")
  if ((match = /^(.+)表格滚动区$/.exec(value))) return localized(l, translateUiText(match[1], locale) + " table scroll area", "Область прокрутки таблицы: " + translateUiText(match[1], locale), translateUiText(match[1], locale) + "テーブルのスクロール領域")
  const state = /^(.*?)(开启|关闭|启用|未启用|开|关)$/.exec(value)
  if (state && state[1]) {
    const name = translateUiText(state[1], locale)
    const enabled = state[2] === "开启" || state[2] === "启用" || state[2] === "开"
    return localized(l, name + (enabled ? ": on" : ": off"), name + (enabled ? ": включено" : ": выключено"), name + (enabled ? "：有効" : "：無効"))
  }
  return exact
}
