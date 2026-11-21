import { currentLocale, translateMessage, type Locale } from "./i18n"

const apiMessages: Record<string, Record<Locale, string>> = {
  "后台登录已切换到 Cloudflare Access": { "zh-CN": "后台登录已切换到 Cloudflare Access", en: "Admin login now uses Cloudflare Access", ru: "Вход в панель управления теперь выполняется через Cloudflare Access", ja: "管理画面のログインは Cloudflare Access に切り替わりました" },
  "基础设置已保存": { "zh-CN": "基础设置已保存", en: "Basic settings saved", ru: "Основные настройки сохранены", ja: "基本設定を保存しました" },
  "商户设置已保存": { "zh-CN": "商户设置已保存", en: "Merchant settings saved", ru: "Настройки продавца сохранены", ja: "加盟店設定を保存しました" },
  "商户已启用": { "zh-CN": "商户已启用", en: "Merchant enabled", ru: "Продавец включён", ja: "加盟店を有効にしました" },
  "商户已停用": { "zh-CN": "商户已停用", en: "Merchant disabled", ru: "Продавец отключён", ja: "加盟店を無効にしました" },
  "归集钱包已添加": { "zh-CN": "归集钱包已添加", en: "Collection wallet added", ru: "Кошелёк сбора добавлен", ja: "集金ウォレットを追加しました" },
  "归集钱包已更新": { "zh-CN": "归集钱包已更新", en: "Collection wallet updated", ru: "Кошелёк сбора обновлён", ja: "集金ウォレットを更新しました" },
  "归集状态已更新": { "zh-CN": "归集状态已更新", en: "Collection status updated", ru: "Статус сбора обновлён", ja: "集金状態を更新しました" },
  "归集钱包已删除": { "zh-CN": "归集钱包已删除", en: "Collection wallet deleted", ru: "Кошелёк сбора удалён", ja: "集金ウォレットを削除しました" },
  "能量套餐已添加": { "zh-CN": "能量套餐已添加", en: "Energy plan added", ru: "Энергопакет добавлен", ja: "エネルギープランを追加しました" },
  "能量套餐已更新": { "zh-CN": "能量套餐已更新", en: "Energy plan updated", ru: "Энергопакет обновлён", ja: "エネルギープランを更新しました" },
  "套餐状态已更新": { "zh-CN": "套餐状态已更新", en: "Plan status updated", ru: "Статус пакета обновлён", ja: "プランの状態を更新しました" },
  "能量套餐已删除": { "zh-CN": "能量套餐已删除", en: "Energy plan deleted", ru: "Энергопакет удалён", ja: "エネルギープランを削除しました" },
  "群组策略已保存；开发环境 Telegram 操作已关闭，未执行历史回扫": { "zh-CN": "群组策略已保存；开发环境 Telegram 操作已关闭，未执行历史回扫", en: "Group policy saved. Telegram actions are disabled in this development environment; no history scan was run.", ru: "Политика группы сохранена. Действия Telegram отключены в среде разработки; история не проверялась.", ja: "グループ設定を保存しました。この開発環境では Telegram 操作が無効のため、過去メッセージの再確認は行っていません。" },
  "监控钱包已添加": { "zh-CN": "监控钱包已添加", en: "Monitoring wallet added", ru: "Кошелёк мониторинга добавлен", ja: "監視ウォレットを追加しました" },
  "监控钱包已更新": { "zh-CN": "监控钱包已更新", en: "Monitoring wallet updated", ru: "Кошелёк мониторинга обновлён", ja: "監視ウォレットを更新しました" },
  "监控状态已更新": { "zh-CN": "监控状态已更新", en: "Monitoring status updated", ru: "Статус мониторинга обновлён", ja: "監視状態を更新しました" },
  "监控钱包已删除": { "zh-CN": "监控钱包已删除", en: "Monitoring wallet deleted", ru: "Кошелёк мониторинга удалён", ja: "監視ウォレットを削除しました" },
  "会员套餐已添加": { "zh-CN": "会员套餐已添加", en: "Membership plan added", ru: "Тариф членства добавлен", ja: "会員プランを追加しました" },
  "商品已添加": { "zh-CN": "商品已添加", en: "Product added", ru: "Товар добавлен", ja: "商品を追加しました" },
  "商品已更新": { "zh-CN": "商品已更新", en: "Product updated", ru: "Товар обновлён", ja: "商品を更新しました" },
  "商品已删除": { "zh-CN": "商品已删除", en: "Product deleted", ru: "Товар удалён", ja: "商品を削除しました" },
  "商品状态已更新": { "zh-CN": "商品状态已更新", en: "Product status updated", ru: "Статус товара обновлён", ja: "商品状態を更新しました" }
}

type DynamicRule = { pattern: RegExp; render: (match: RegExpExecArray, locale: Locale) => string }

const dynamicRules: DynamicRule[] = [
  { pattern: /^已软删除 (\d+) 条订单$/, render: (m, l) => l === "en" ? "Soft-deleted " + m[1] + " orders" : l === "ru" ? "Мягко удалено заказов: " + m[1] : "注文 " + m[1] + " 件を論理削除しました" },
  { pattern: /^已删除 (\d+) 个套餐$/, render: (m, l) => l === "en" ? "Deleted " + m[1] + " plans" : l === "ru" ? "Удалено тарифов: " + m[1] : "プラン " + m[1] + " 件を削除しました" },
  { pattern: /^已删除 (\d+) 个停用用户$/, render: (m, l) => l === "en" ? "Deleted " + m[1] + " inactive users" : l === "ru" ? "Удалено неактивных пользователей: " + m[1] : "無効なユーザー " + m[1] + " 人を削除しました" },
  { pattern: /^已删除 (\d+) 条记录$/, render: (m, l) => l === "en" ? "Deleted " + m[1] + " records" : l === "ru" ? "Удалено записей: " + m[1] : "レコード " + m[1] + " 件を削除しました" },
  { pattern: /^已复制 (\d+) 个套餐，并覆盖目标机器人原套餐$/, render: (m, l) => l === "en" ? "Copied " + m[1] + " plans and replaced the target bot's existing plans" : l === "ru" ? "Скопировано тарифов: " + m[1] + "; существующие тарифы целевого бота заменены" : "プラン " + m[1] + " 件をコピーし、対象ボットの既存プランを置き換えました" },
  { pattern: /^已复制 (\d+) 个套餐并覆盖目标平台$/, render: (m, l) => l === "en" ? "Copied " + m[1] + " plans and replaced the target platform's existing plans" : l === "ru" ? "Скопировано тарифов: " + m[1] + "; существующие тарифы целевой платформы заменены" : "プラン " + m[1] + " 件をコピーし、対象プラットフォームの既存プランを置き換えました" },
  {
    pattern: /^群组策略已保存，最近 30 分钟已回扫并处理 (\d+) 条消息(?:，(\d+) 条处理失败)?(?:；(\d+) 条验证挑战未能启动，已回退为删除消息)?$/,
    render: (m, l) => l === "en"
      ? "Group policy saved. Scanned the last 30 minutes and processed " + m[1] + " messages" + (m[2] ? "; " + m[2] + " failed" : "") + (m[3] ? "; verification could not start for " + m[3] + " messages, which were deleted instead" : "") + "."
      : l === "ru"
        ? "Политика группы сохранена. За последние 30 минут проверено и обработано сообщений: " + m[1] + (m[2] ? "; ошибок обработки: " + m[2] : "") + (m[3] ? "; для " + m[3] + " сообщений проверка не запустилась, сообщения удалены" : "") + "."
        : "グループ設定を保存しました。直近30分を再確認し、" + m[1] + "件を処理しました" + (m[2] ? "。" + m[2] + "件の処理に失敗" : "") + (m[3] ? "。" + m[3] + "件は確認を開始できず削除しました" : "") + "。",
  },
  { pattern: /^已添加 (\d+) 个钱包(?:，跳过重复 (\d+) 个)?$/, render: (m, l) => l === "en" ? "Added " + m[1] + " wallets" + (m[2] ? "; skipped " + m[2] + " duplicates" : "") : l === "ru" ? "Добавлено кошельков: " + m[1] + (m[2] ? "; пропущено повторов: " + m[2] : "") : "ウォレット " + m[1] + " 件を追加しました" + (m[2] ? "。重複 " + m[2] + " 件はスキップしました" : "") },
  { pattern: /^(发送失败|解除失败)：(.*)$/, render: (m, l) => (m[1] === "发送失败" ? (l === "en" ? "Send failed: " : l === "ru" ? "Ошибка отправки: " : "送信に失敗しました：") : (l === "en" ? "Release failed: " : l === "ru" ? "Ошибка снятия ограничений: " : "制限解除に失敗しました：")) + m[2] },
  { pattern: /^Job 返回 HTTP (\d+)$/, render: (m, l) => l === "en" ? "Job returned HTTP " + m[1] : l === "ru" ? "Задача вернула HTTP " + m[1] : "Job が HTTP " + m[1] + " を返しました" },
  { pattern: /^Job 接口返回错误：(.*)$/, render: (m, l) => (l === "en" ? "Job endpoint returned an error: " : l === "ru" ? "Ошибка ответа API задачи: " : "Job API がエラーを返しました：") + m[1] },
  { pattern: /^第 (\d+) 行格式无效，应为卡号,卡密$/, render: (m, l) => l === "en" ? "Invalid format on line " + m[1] + "; expected card number, card key" : l === "ru" ? "Неверный формат в строке " + m[1] + "; ожидаются номер карты и ключ" : "行 " + m[1] + " の形式が無効です。カード番号, カードキーを指定してください" },
  { pattern: /^第 (\d+) 行卡号或卡密为空\/超长$/, render: (m, l) => l === "en" ? "Card number or key is empty or too long on line " + m[1] : l === "ru" ? "В строке " + m[1] + " номер карты или ключ пуст либо слишком длинный" : "行 " + m[1] + " のカード番号またはカードキーが空か長すぎます" },
  { pattern: /^已添加 (\d+) 条，跳过重复 (\d+) 条$/, render: (m, l) => l === "en" ? "Added " + m[1] + " entries; skipped " + m[2] + " duplicates" : l === "ru" ? "Добавлено записей: " + m[1] + "; пропущено повторов: " + m[2] : m[1] + " 件を追加、重複 " + m[2] + " 件をスキップしました" },
  { pattern: /^(上架|下架)完成，共更新 (\d+) 条$/, render: (m, l) => l === "en" ? (m[1] === "上架" ? "Listed" : "Unlisted") + "; updated " + m[2] + " items" : l === "ru" ? (m[1] === "上架" ? "Опубликовано" : "Снято с публикации") + "; обновлено: " + m[2] : (m[1] === "上架" ? "公開" : "非公開") + "にし、" + m[2] + " 件を更新しました" },
  { pattern: /^群发完成：成功 (\d+)，失败 (\d+)，停用 (\d+)$/, render: (m, l) => l === "en" ? "Broadcast complete: " + m[1] + " succeeded, " + m[2] + " failed, " + m[3] + " disabled" : l === "ru" ? "Рассылка завершена: успешно " + m[1] + ", ошибок " + m[2] + ", отключено " + m[3] : "一斉送信完了：成功 " + m[1] + " 件、失敗 " + m[2] + " 件、停止 " + m[3] + " 件" },
]

export function translateApiMessage(value: string, locale: Locale = currentLocale()): string {
  if (locale === "zh-CN") return value
  const exact = apiMessages[value]?.[locale]
  if (exact !== undefined) return exact
  for (const rule of dynamicRules) {
    const match = rule.pattern.exec(value)
    if (match) return rule.render(match, locale)
  }
  return translateMessage(value, locale)
}
