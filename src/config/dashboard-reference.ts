// Content ported from the original dashboard; values are rendered as text, never HTML.
export const dashboardReference = [
  {
    "id": "commands",
    "title": "内置命令",
    "label": "命令",
    "valueLabel": "用途",
    "rows": [
      [
        "z0",
        "查询欧意 C2C 实时汇率。z0 查所有，z1 银行卡，z2 支付宝，z3 微信。"
      ],
      [
        "统计",
        "统计当天、当月、历史总兑换订单情况。"
      ],
      [
        "能量统计",
        "统计当天、当月、历史总能量订单情况。"
      ],
      [
        "预支给xxx",
        "仅闪兑钱包 TG 通知对象可发起，格式为「预支给地址 数量」。"
      ],
      [
        "能量给xxx 65000 0",
        "0 为 1 小时，1 为 1 天，3 为 3 天；也可使用「能量强制给xxx」。"
      ],
      [
        "查授权xxx",
        "查询波场地址授权信息。"
      ],
      [
        "激活地址xxx",
        "转 1 TRX 激活地址，仅闪兑钱包 TG 通知对象可发起。"
      ],
      [
        "下发trx / 下发usdt",
        "格式为「下发trx 地址 数量」。"
      ],
      [
        "授权波场 / 多签波场",
        "格式为「地址 私钥 [权限ID]」。"
      ],
      [
        "直接发送波场地址",
        "查询余额、转账和多签信息。"
      ],
      [
        "增加笔数 / 绑定笔数",
        "给地址增加笔数或绑定用户 ID。"
      ]
    ],
    "note": ""
  },
  {
    "id": "format",
    "title": "回复消息与广告格式",
    "label": "类型",
    "valueLabel": "格式",
    "rows": [
      [
        "粗体",
        "<b>文字</b> 或 <strong>文字</strong>"
      ],
      [
        "斜体",
        "<i>文字</i> 或 <em>文字</em>"
      ],
      [
        "底线",
        "<u>文字</u> 或 <ins>文字</ins>"
      ],
      [
        "删除线",
        "<s>文字</s> 或 <del>文字</del>"
      ],
      [
        "遮挡码",
        "<span class=\"tg-spoiler\">文字</span>"
      ],
      [
        "超链接",
        "<a href=\"链接\">文字</a>"
      ],
      [
        "TG 用户链接",
        "<a href=\"tg://user?id=123456789\">文字</a>"
      ],
      [
        "等宽与代码块",
        "<code>、<pre>"
      ]
    ],
    "note": "非标签内容中的 <、>、& 需使用 HTML 实体。"
  },
  {
    "id": "variables",
    "title": "内置变量",
    "label": "变量",
    "valueLabel": "对应内容",
    "rows": [
      [
        "${trxusdtrate}",
        "闪兑汇率"
      ],
      [
        "${trx10usdtrate}",
        "10U 闪兑汇率"
      ],
      [
        "${trx100usdtrate}",
        "100U 闪兑汇率"
      ],
      [
        "${trx1000usdtrate}",
        "1000U 闪兑汇率"
      ],
      [
        "${trxusdtwallet}",
        "闪兑钱包地址"
      ],
      [
        "${trxusdtshownotes}",
        "闪兑钱包显示说明"
      ],
      [
        "${tgbotadmin}",
        "机器人管理员名"
      ],
      [
        "${tgbotname}",
        "机器人名"
      ]
    ],
    "note": ""
  }
]
