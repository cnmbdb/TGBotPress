import { jsx, jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, ChevronLeft, ChevronRight, KeyRound, RefreshCw, Search, ShoppingBag } from "lucide-react";
function createRechargeOrdersPage(host) {
  const { AdminShell, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, api, ApiError } = host;
  function RechargeOrders() {
    const client = useQueryClient();
    const me = useQuery({ queryKey: ["me"], queryFn: () => api("/api/me"), retry: false, staleTime: 6e4 });
    const logout = useMutation({ mutationFn: () => api("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), onSuccess: () => {
      client.clear();
      window.location.assign("/console/home");
    } });
    const [draft, setDraft] = useState(""), [search, setSearch] = useState(""), [botRid, setBotRid] = useState("all"), [page, setPage] = useState(1), [pageSize, setPageSize] = useState(15);
    const options = useQuery({ queryKey: ["recharge-orders", "options"], queryFn: () => api("/api/recharge-orders?action=options"), enabled: !!me.data, retry: false });
    const data = useQuery({ queryKey: ["recharge-orders", page, pageSize, search, botRid], queryFn: () => api(`/api/recharge-orders?${new URLSearchParams({ page: String(page), pageSize: String(pageSize), search, botRid })}`), enabled: !!me.data, retry: false });
    if (me.isPending) return /* @__PURE__ */ jsx("div", { className: "flex min-h-screen items-center justify-center", children: /* @__PURE__ */ jsx(RefreshCw, { className: "size-4 animate-spin text-muted-foreground", "aria-label": "\u6B63\u5728\u52A0\u8F7D" }) });
    if (!me.data) return /* @__PURE__ */ jsx("main", { className: "flex min-h-screen items-center justify-center p-4", children: /* @__PURE__ */ jsxs("section", { className: "w-full max-w-sm space-y-4 rounded-xl bg-card p-6 shadow-sm", children: [
      /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 text-sm font-semibold", children: [
        /* @__PURE__ */ jsx(ShoppingBag, { className: "size-4" }),
        "TGBotPress"
      ] }),
      /* @__PURE__ */ jsx("h1", { className: "text-base font-semibold", children: "\u767B\u5F55\u7BA1\u7406\u540E\u53F0" }),
      /* @__PURE__ */ jsx(Button, { asChild: true, className: "w-full", children: /* @__PURE__ */ jsxs("a", { href: "/api/auth/start?destination=rechargeOrders", children: [
        /* @__PURE__ */ jsx(KeyRound, { className: "size-4" }),
        "\u7BA1\u7406\u5458\u767B\u5F55"
      ] }) })
    ] }) });
    const total = data.data?.total || 0, pages = Math.max(1, Math.ceil(total / pageSize));
    return /* @__PURE__ */ jsx(AdminShell, { user: me.data, title: "\u5145\u503C\u8BA2\u5355", activeRoute: "admin.groupuser.rechargeorder.index", onRefresh: () => data.refetch(), onLogout: () => logout.mutate(), children: /* @__PURE__ */ jsxs("main", { className: "space-y-3 p-3 sm:p-4", children: [
      /* @__PURE__ */ jsxs("section", { className: "flex flex-wrap items-center gap-2 rounded-xl bg-card p-3", children: [
        /* @__PURE__ */ jsxs("form", { className: "flex min-w-0 flex-1 gap-2", onSubmit: (event) => {
          event.preventDefault();
          setSearch(draft.trim());
          setPage(1);
        }, children: [
          /* @__PURE__ */ jsxs("div", { className: "relative min-w-48 flex-1", children: [
            /* @__PURE__ */ jsx(Search, { className: "absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" }),
            /* @__PURE__ */ jsx(Input, { value: draft, onChange: (e) => setDraft(e.target.value), maxLength: 100, placeholder: "\u641C\u7D22 Telegram \u7528\u6237\u540D\u6216 ID", className: "h-9 pl-8 text-xs" })
          ] }),
          /* @__PURE__ */ jsx(Button, { size: "sm", className: "h-9", children: "\u641C\u7D22" })
        ] }),
        /* @__PURE__ */ jsxs(Select, { value: botRid, onValueChange: (v) => {
          setBotRid(v);
          setPage(1);
        }, children: [
          /* @__PURE__ */ jsx(SelectTrigger, { className: "h-9 w-48 text-xs", children: /* @__PURE__ */ jsx(SelectValue, { placeholder: "\u5168\u90E8\u673A\u5668\u4EBA" }) }),
          /* @__PURE__ */ jsxs(SelectContent, { children: [
            /* @__PURE__ */ jsx(SelectItem, { value: "all", className: "text-xs", children: "\u5168\u90E8\u673A\u5668\u4EBA" }),
            options.data?.bots.map((bot) => /* @__PURE__ */ jsx(SelectItem, { value: String(bot.rid), className: "text-xs", children: bot.bot_firstname || bot.bot_username || `\u673A\u5668\u4EBA #${bot.rid}` }, bot.rid))
          ] })
        ] }),
        /* @__PURE__ */ jsx(Button, { variant: "outline", size: "icon", className: "size-9", "aria-label": "\u5237\u65B0", disabled: data.isFetching, onClick: () => data.refetch(), children: /* @__PURE__ */ jsx(RefreshCw, { className: `size-3.5 ${data.isFetching ? "animate-spin" : ""}` }) })
      ] }),
      /* @__PURE__ */ jsxs("section", { className: "overflow-hidden rounded-xl bg-card", children: [
        /* @__PURE__ */ jsxs("header", { className: "flex h-11 items-center justify-between border-b px-3", children: [
          /* @__PURE__ */ jsxs("h1", { className: "flex items-center gap-2 text-sm font-semibold", children: [
            /* @__PURE__ */ jsx(ShoppingBag, { className: "size-4 text-muted-foreground" }),
            "\u5145\u503C\u8BA2\u5355"
          ] }),
          /* @__PURE__ */ jsxs("span", { className: "text-xs text-muted-foreground", children: [
            "\u5171 ",
            total,
            " \u6761"
          ] })
        ] }),
        data.error && /* @__PURE__ */ jsx("div", { role: "alert", className: "px-3 py-4 text-xs text-destructive", children: data.error instanceof ApiError ? data.error.message : "\u52A0\u8F7D\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5" }),
        /* @__PURE__ */ jsx("div", { className: "space-y-2 p-2 md:hidden", children: data.isPending ? /* @__PURE__ */ jsx("div", { className: "py-8 text-center text-xs text-muted-foreground", children: "\u52A0\u8F7D\u4E2D\u2026" }) : data.data?.rows.length ? data.data.rows.map((row) => /* @__PURE__ */ jsxs("article", { className: "space-y-3 rounded-lg border p-3", children: [
          /* @__PURE__ */ jsxs("header", { className: "flex items-start justify-between gap-3", children: [
            /* @__PURE__ */ jsxs("div", { className: "min-w-0", children: [
              /* @__PURE__ */ jsxs("div", { className: "truncate text-sm font-medium", children: [
                "\u8BA2\u5355 #",
                row.rid
              ] }),
              /* @__PURE__ */ jsxs("div", { className: "mt-1 truncate text-[11px] text-muted-foreground", children: [
                row.bot_firstname || row.bot_username || `\u673A\u5668\u4EBA #${row.bot_rid}`,
                " \xB7 ",
                row.recharge_tg_username ? `@${row.recharge_tg_username}` : row.recharge_tg_uid
              ] })
            ] }),
            /* @__PURE__ */ jsx("span", { className: "shrink-0 rounded-full bg-muted px-2 py-1 text-[10px]", children: row.status_label })
          ] }),
          /* @__PURE__ */ jsxs("dl", { className: "grid grid-cols-2 gap-x-3 gap-y-2 text-xs", children: [
            /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsx("dt", { className: "text-muted-foreground", children: "\u5E01\u79CD" }),
              /* @__PURE__ */ jsx("dd", { children: row.recharge_coin_name })
            ] }),
            /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsx("dt", { className: "text-muted-foreground", children: "\u5145\u503C\u91D1\u989D" }),
              /* @__PURE__ */ jsx("dd", { className: "font-mono", children: row.recharge_pay_price })
            ] }),
            /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsx("dt", { className: "text-muted-foreground", children: "\u5E94\u4ED8\u91D1\u989D" }),
              /* @__PURE__ */ jsx("dd", { className: "font-mono", children: row.need_pay_price })
            ] }),
            /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsx("dt", { className: "text-muted-foreground", children: "\u521B\u5EFA\u65F6\u95F4" }),
              /* @__PURE__ */ jsx("dd", { children: row.create_time })
            ] }),
            /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsx("dt", { className: "text-muted-foreground", children: "\u8FC7\u671F\u65F6\u95F4" }),
              /* @__PURE__ */ jsx("dd", { children: row.expire_time || "\u2014" })
            ] }),
            /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsx("dt", { className: "text-muted-foreground", children: "\u5B8C\u6210\u65F6\u95F4" }),
              /* @__PURE__ */ jsx("dd", { children: row.complete_time || "\u2014" })
            ] }),
            /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsx("dt", { className: "text-muted-foreground", children: "\u53D6\u6D88\u65F6\u95F4" }),
              /* @__PURE__ */ jsx("dd", { children: row.cancel_time || "\u2014" })
            ] }),
            /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsx("dt", { className: "text-muted-foreground", children: "\u66F4\u65B0\u65F6\u95F4" }),
              /* @__PURE__ */ jsx("dd", { children: row.update_time || "\u2014" })
            ] }),
            /* @__PURE__ */ jsxs("div", { className: "col-span-2 min-w-0", children: [
              /* @__PURE__ */ jsx("dt", { className: "text-muted-foreground", children: "\u4EA4\u6613\u54C8\u5E0C" }),
              /* @__PURE__ */ jsx("dd", { className: "break-all font-mono text-[10px]", children: row.tx_hash || "\u2014" })
            ] }),
            /* @__PURE__ */ jsxs("div", { className: "col-span-2", children: [
              /* @__PURE__ */ jsx("dt", { className: "text-muted-foreground", children: "\u5907\u6CE8" }),
              /* @__PURE__ */ jsx("dd", { className: "break-words", children: row.comments || "\u2014" })
            ] })
          ] })
        ] }, row.rid)) : /* @__PURE__ */ jsx("div", { className: "py-8 text-center text-xs text-muted-foreground", children: "\u6682\u65E0\u5145\u503C\u8BA2\u5355" }) }),
        /* @__PURE__ */ jsx("div", { className: "hidden overflow-x-auto md:block", children: /* @__PURE__ */ jsxs(Table, { className: "min-w-[1420px]", children: [
          /* @__PURE__ */ jsx(TableHeader, { children: /* @__PURE__ */ jsx(TableRow, { children: ["\u8BA2\u5355", "\u673A\u5668\u4EBA", "Telegram \u7528\u6237", "\u5E01\u79CD", "\u5145\u503C\u91D1\u989D", "\u5E94\u4ED8\u91D1\u989D", "\u72B6\u6001", "\u521B\u5EFA\u65F6\u95F4", "\u8FC7\u671F\u65F6\u95F4", "\u5B8C\u6210\u65F6\u95F4", "\u53D6\u6D88\u65F6\u95F4", "\u4EA4\u6613\u54C8\u5E0C", "\u5907\u6CE8"].map((label) => /* @__PURE__ */ jsx(TableHead, { className: "h-9 px-3", children: label }, label)) }) }),
          /* @__PURE__ */ jsx(TableBody, { children: data.isPending ? /* @__PURE__ */ jsx(TableRow, { children: /* @__PURE__ */ jsx(TableCell, { colSpan: 13, className: "h-20 text-center text-xs text-muted-foreground", children: "\u52A0\u8F7D\u4E2D\u2026" }) }) : data.data?.rows.length ? data.data.rows.map((row) => /* @__PURE__ */ jsxs(TableRow, { children: [
            /* @__PURE__ */ jsxs(TableCell, { className: "px-3 py-2 font-mono text-xs", children: [
              "#",
              row.rid
            ] }),
            /* @__PURE__ */ jsx(TableCell, { className: "max-w-36 truncate px-3 py-2 text-xs", title: row.bot_username || "", children: row.bot_firstname || row.bot_username || `#${row.bot_rid}` }),
            /* @__PURE__ */ jsxs(TableCell, { className: "px-3 py-2 text-xs", children: [
              /* @__PURE__ */ jsx("span", { children: row.recharge_tg_username ? `@${row.recharge_tg_username}` : "\u2014" }),
              /* @__PURE__ */ jsx("span", { className: "block font-mono text-[10px] text-muted-foreground", children: row.recharge_tg_uid })
            ] }),
            /* @__PURE__ */ jsx(TableCell, { className: "px-3 py-2 text-xs", children: row.recharge_coin_name }),
            /* @__PURE__ */ jsx(TableCell, { className: "px-3 py-2 font-mono text-xs", children: row.recharge_pay_price }),
            /* @__PURE__ */ jsx(TableCell, { className: "px-3 py-2 font-mono text-xs", children: row.need_pay_price }),
            /* @__PURE__ */ jsx(TableCell, { className: "px-3 py-2", children: /* @__PURE__ */ jsxs("span", { className: `inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] ${row.status === 1 ? "bg-emerald-50 text-emerald-700" : row.status === 0 ? "bg-amber-50 text-amber-700" : "bg-muted text-muted-foreground"}`, children: [
              row.status === 1 && /* @__PURE__ */ jsx(BadgeCheck, { className: "size-3" }),
              row.status_label
            ] }) }),
            /* @__PURE__ */ jsx(TableCell, { className: "whitespace-nowrap px-3 py-2 text-xs", children: row.create_time }),
            /* @__PURE__ */ jsx(TableCell, { className: "whitespace-nowrap px-3 py-2 text-xs", children: row.expire_time }),
            /* @__PURE__ */ jsx(TableCell, { className: "whitespace-nowrap px-3 py-2 text-xs", children: row.complete_time || "\u2014" }),
            /* @__PURE__ */ jsx(TableCell, { className: "whitespace-nowrap px-3 py-2 text-xs", children: row.cancel_time || "\u2014" }),
            /* @__PURE__ */ jsx(TableCell, { className: "max-w-48 truncate px-3 py-2 font-mono text-[10px]", title: row.tx_hash || "", children: row.tx_hash || "\u2014" }),
            /* @__PURE__ */ jsx(TableCell, { className: "max-w-48 truncate px-3 py-2 text-xs", title: row.comments || "", children: row.comments || "\u2014" })
          ] }, row.rid)) : /* @__PURE__ */ jsx(TableRow, { children: /* @__PURE__ */ jsx(TableCell, { colSpan: 13, className: "h-20 text-center text-xs text-muted-foreground", children: "\u6682\u65E0\u8BB0\u5F55" }) }) })
        ] }) }),
        /* @__PURE__ */ jsxs("footer", { className: "flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2", children: [
          /* @__PURE__ */ jsxs("span", { className: "text-xs text-muted-foreground", children: [
            "\u7B2C ",
            page,
            " / ",
            pages,
            " \u9875"
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-1.5", children: [
            /* @__PURE__ */ jsxs(Select, { value: String(pageSize), onValueChange: (v) => {
              setPageSize(Number(v));
              setPage(1);
            }, children: [
              /* @__PURE__ */ jsx(SelectTrigger, { className: "h-8 w-24 text-xs", children: /* @__PURE__ */ jsx(SelectValue, {}) }),
              /* @__PURE__ */ jsx(SelectContent, { children: [10, 15, 20, 30, 50, 100].map((v) => /* @__PURE__ */ jsxs(SelectItem, { value: String(v), className: "text-xs", children: [
                v,
                " \u6761/\u9875"
              ] }, v)) })
            ] }),
            /* @__PURE__ */ jsx(Button, { variant: "outline", size: "icon", className: "size-8", "aria-label": "\u4E0A\u4E00\u9875", disabled: page <= 1 || data.isFetching, onClick: () => setPage((v) => v - 1), children: /* @__PURE__ */ jsx(ChevronLeft, { className: "size-3.5" }) }),
            /* @__PURE__ */ jsx(Button, { variant: "outline", size: "icon", className: "size-8", "aria-label": "\u4E0B\u4E00\u9875", disabled: page >= pages || data.isFetching, onClick: () => setPage((v) => v + 1), children: /* @__PURE__ */ jsx(ChevronRight, { className: "size-3.5" }) })
          ] })
        ] })
      ] })
    ] }) });
  }
  return RechargeOrders;
}
export {
  createRechargeOrdersPage
};
