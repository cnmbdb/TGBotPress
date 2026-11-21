import { jsx, jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, ChevronLeft, ChevronRight, KeyRound, MessageSquare, RefreshCw, Search, Users, Wallet } from "lucide-react";
function createUsersPage(host) {
  const { AdminShell, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Textarea, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, api, ApiError } = host;
  function UsersPage() {
    const client = useQueryClient(), me = useQuery({ queryKey: ["me"], queryFn: () => api("/api/me"), retry: false, staleTime: 6e4 });
    const logout = useMutation({ mutationFn: () => api("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), onSuccess: () => {
      client.clear();
      window.location.assign("/console/home");
    } });
    const [draft, setDraft] = useState({ username: "", uid: "", nickname: "", botRid: "all" }), [filters, setFilters] = useState(draft), [page, setPage] = useState(1), [pageSize, setPageSize] = useState(15), [action, setAction] = useState(null), [selected, setSelected] = useState(null), [broadcastBot, setBroadcastBot] = useState(""), [message, setMessage] = useState(""), [credit, setCredit] = useState({ cash_trx: "", cash_usdt: "", max_monitor_wallet: "" }), [feedback, setFeedback] = useState("");
    const options = useQuery({ queryKey: ["users", "options"], queryFn: () => api("/api/users?action=options"), enabled: !!me.data, retry: false });
    const data = useQuery({ queryKey: ["users", page, pageSize, filters], queryFn: () => api(`/api/users?${new URLSearchParams({ page: String(page), pageSize: String(pageSize), username: filters.username, uid: filters.uid, nickname: filters.nickname, botRid: filters.botRid })}`), enabled: !!me.data, retry: false });
    const mutation = useMutation({ mutationFn: (payload) => api("/api/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }), onSuccess: async (result) => {
      setAction(null);
      setSelected(null);
      setMessage("");
      setCredit({ cash_trx: "", cash_usdt: "", max_monitor_wallet: "" });
      setFeedback(result.message);
      await client.invalidateQueries({ queryKey: ["users"] });
    } });
    if (me.isPending) return /* @__PURE__ */ jsx("div", { className: "flex min-h-screen items-center justify-center", children: /* @__PURE__ */ jsx(RefreshCw, { className: "size-4 animate-spin text-muted-foreground", "aria-label": "\u6B63\u5728\u52A0\u8F7D" }) });
    if (!me.data) return /* @__PURE__ */ jsx("main", { className: "flex min-h-screen items-center justify-center p-4", children: /* @__PURE__ */ jsxs("section", { className: "w-full max-w-sm space-y-4 rounded-xl bg-card p-6 shadow-sm", children: [
      /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 text-sm font-semibold", children: [
        /* @__PURE__ */ jsx(Users, { className: "size-4" }),
        "TGBotPress"
      ] }),
      /* @__PURE__ */ jsx("h1", { className: "text-base font-semibold", children: "\u767B\u5F55\u7BA1\u7406\u540E\u53F0" }),
      /* @__PURE__ */ jsx(Button, { asChild: true, className: "w-full", children: /* @__PURE__ */ jsxs("a", { href: "/api/auth/start?destination=users", children: [
        /* @__PURE__ */ jsx(KeyRound, { className: "size-4" }),
        "\u7BA1\u7406\u5458\u767B\u5F55"
      ] }) })
    ] }) });
    const total = data.data?.total || 0, pages = Math.max(1, Math.ceil(total / pageSize)), permissions = data.data?.permissions, telegramEnabled = data.data?.telegramEnabled || false;
    const close = () => {
      setAction(null);
      setSelected(null);
      setMessage("");
      mutation.reset();
    };
    const open = (next, row) => {
      setAction(next);
      setSelected(row || null);
      setMessage("");
      setCredit(row ? { cash_trx: "", cash_usdt: "", max_monitor_wallet: "" } : { cash_trx: "", cash_usdt: "", max_monitor_wallet: "" });
      if (next === "batchsendmessage" || next === "batchdelete") setBroadcastBot("");
    };
    const submit = () => {
      if (!action) return;
      const payload = { action };
      if (selected) payload.rid = selected.rid;
      if (action === "sendmessage") payload.message = message;
      if (action === "batchsendmessage") {
        payload.bot_rid = Number(broadcastBot);
        payload.message = message;
      }
      if (action === "rechargemanual") Object.assign(payload, credit);
      if (action === "batchdelete") payload.bot_rid = Number(broadcastBot);
      mutation.mutate(payload);
    };
    const apply = () => {
      setFilters({ ...draft, username: draft.username.trim(), uid: draft.uid.trim(), nickname: draft.nickname.trim() });
      setPage(1);
    };
    return /* @__PURE__ */ jsxs(AdminShell, { user: me.data, title: "\u7528\u6237\u5217\u8868", activeRoute: "admin.groupuser.user.index", onRefresh: () => data.refetch(), onLogout: () => logout.mutate(), children: [
      /* @__PURE__ */ jsxs("main", { className: "space-y-3 p-3 sm:p-4", children: [
        /* @__PURE__ */ jsxs("section", { className: "space-y-2 rounded-xl bg-card p-3", children: [
          /* @__PURE__ */ jsxs("form", { className: "grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4", onSubmit: (e) => {
            e.preventDefault();
            apply();
          }, children: [
            /* @__PURE__ */ jsx(Input, { value: draft.username, maxLength: 200, onChange: (e) => setDraft({ ...draft, username: e.target.value }), placeholder: "Telegram \u7528\u6237\u540D", className: "h-9 text-xs" }),
            /* @__PURE__ */ jsx(Input, { value: draft.uid, maxLength: 100, onChange: (e) => setDraft({ ...draft, uid: e.target.value }), placeholder: "\u7528\u6237 ID", className: "h-9 text-xs" }),
            /* @__PURE__ */ jsx(Input, { value: draft.nickname, maxLength: 200, onChange: (e) => setDraft({ ...draft, nickname: e.target.value }), placeholder: "\u7528\u6237\u6635\u79F0", className: "h-9 text-xs" }),
            /* @__PURE__ */ jsxs(Select, { value: draft.botRid, onValueChange: (v) => setDraft({ ...draft, botRid: v }), children: [
              /* @__PURE__ */ jsx(SelectTrigger, { className: "h-9 text-xs", children: /* @__PURE__ */ jsx(SelectValue, { placeholder: "\u5168\u90E8\u673A\u5668\u4EBA" }) }),
              /* @__PURE__ */ jsxs(SelectContent, { children: [
                /* @__PURE__ */ jsx(SelectItem, { value: "all", className: "text-xs", children: "\u5168\u90E8\u673A\u5668\u4EBA" }),
                options.data?.bots.map((bot) => /* @__PURE__ */ jsx(SelectItem, { value: String(bot.rid), className: "text-xs", children: bot.bot_firstname || bot.bot_username || `\u673A\u5668\u4EBA #${bot.rid}` }, bot.rid))
              ] })
            ] }),
            /* @__PURE__ */ jsxs("div", { className: "flex gap-2 sm:col-span-2 xl:col-span-4", children: [
              /* @__PURE__ */ jsxs(Button, { size: "sm", className: "h-9", children: [
                /* @__PURE__ */ jsx(Search, { className: "size-3.5" }),
                "\u641C\u7D22"
              ] }),
              /* @__PURE__ */ jsx(Button, { size: "sm", type: "button", variant: "outline", className: "h-9", onClick: () => {
                const empty = { username: "", uid: "", nickname: "", botRid: "all" };
                setDraft(empty);
                setFilters(empty);
                setPage(1);
              }, children: "\u91CD\u7F6E" }),
              /* @__PURE__ */ jsxs(Button, { size: "sm", type: "button", variant: "outline", className: "ml-auto h-9", disabled: data.isFetching, onClick: () => data.refetch(), children: [
                /* @__PURE__ */ jsx(RefreshCw, { className: `size-3.5 ${data.isFetching ? "animate-spin" : ""}` }),
                "\u5237\u65B0"
              ] })
            ] })
          ] }),
          (permissions?.["\u7FA4\u53D1\u6D88\u606F"] || permissions?.["\u6279\u91CF\u5220\u9664\u505C\u7528"]) && /* @__PURE__ */ jsxs("div", { className: "flex flex-wrap gap-2 border-t pt-2", children: [
            permissions?.["\u7FA4\u53D1\u6D88\u606F"] && /* @__PURE__ */ jsxs(Button, { size: "sm", className: "h-8", disabled: !telegramEnabled, onClick: () => open("batchsendmessage"), children: [
              /* @__PURE__ */ jsx(MessageSquare, { className: "size-3.5" }),
              "\u7FA4\u53D1\u6D88\u606F"
            ] }),
            permissions?.["\u6279\u91CF\u5220\u9664\u505C\u7528"] && /* @__PURE__ */ jsxs(Button, { size: "sm", variant: "outline", className: "h-8", onClick: () => open("batchdelete"), children: [
              /* @__PURE__ */ jsx(Ban, { className: "size-3.5" }),
              "\u6279\u91CF\u5220\u9664\u505C\u7528"
            ] }),
            permissions?.["\u7FA4\u53D1\u6D88\u606F"] && !telegramEnabled && /* @__PURE__ */ jsx("span", { className: "self-center text-[11px] text-muted-foreground", children: "\u5F00\u53D1\u73AF\u5883\u672A\u542F\u7528 Telegram \u5916\u53D1" })
          ] })
        ] }),
        /* @__PURE__ */ jsxs("section", { className: "overflow-hidden rounded-xl bg-card", children: [
          /* @__PURE__ */ jsxs("header", { className: "flex h-11 items-center justify-between border-b px-3", children: [
            /* @__PURE__ */ jsxs("h1", { className: "flex items-center gap-2 text-sm font-semibold", children: [
              /* @__PURE__ */ jsx(Users, { className: "size-4 text-muted-foreground" }),
              "\u7528\u6237\u5217\u8868"
            ] }),
            /* @__PURE__ */ jsxs("span", { className: "text-xs text-muted-foreground", children: [
              "\u5171 ",
              total,
              " \u6761"
            ] })
          ] }),
          data.error && /* @__PURE__ */ jsx("div", { role: "alert", className: "px-3 py-3 text-xs text-destructive", children: data.error instanceof ApiError ? data.error.message : "\u52A0\u8F7D\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5" }),
          mutation.error && /* @__PURE__ */ jsx("div", { role: "alert", className: "px-3 py-3 text-xs text-destructive", children: mutation.error.message }),
          /* @__PURE__ */ jsx("div", { className: "space-y-2 p-2 md:hidden", children: data.isPending ? /* @__PURE__ */ jsx("div", { className: "py-8 text-center text-xs text-muted-foreground", children: "\u52A0\u8F7D\u4E2D\u2026" }) : data.data?.rows.length ? data.data.rows.map((row) => /* @__PURE__ */ jsxs("article", { className: "space-y-3 rounded-lg border p-3", children: [
            /* @__PURE__ */ jsxs("header", { className: "flex items-start justify-between gap-3", children: [
              /* @__PURE__ */ jsxs("div", { className: "min-w-0", children: [
                /* @__PURE__ */ jsx("div", { className: "truncate text-sm font-medium", children: row.tg_nickname || row.tg_uid }),
                /* @__PURE__ */ jsxs("div", { className: "mt-1 truncate text-[11px] text-muted-foreground", children: [
                  row.tg_username ? `@${row.tg_username}` : "\u65E0\u7528\u6237\u540D",
                  " \xB7 ID ",
                  row.tg_uid
                ] }),
                /* @__PURE__ */ jsx("div", { className: "truncate text-[11px] text-muted-foreground", children: row.bot_firstname || row.bot_username || `\u673A\u5668\u4EBA #${row.bot_rid}` })
              ] }),
              /* @__PURE__ */ jsx("span", { className: `shrink-0 rounded-full px-2 py-1 text-[10px] ${row.status === 1 ? "bg-emerald-50 text-emerald-700" : row.status === 2 ? "bg-muted text-muted-foreground" : "bg-amber-50 text-amber-700"}`, children: row.status_label })
            ] }),
            /* @__PURE__ */ jsxs("dl", { className: "grid grid-cols-2 gap-x-3 gap-y-2 text-xs", children: [
              /* @__PURE__ */ jsxs("div", { children: [
                /* @__PURE__ */ jsx("dt", { className: "text-muted-foreground", children: "TRX \u4F59\u989D" }),
                /* @__PURE__ */ jsx("dd", { className: "font-mono", children: row.cash_trx })
              ] }),
              /* @__PURE__ */ jsxs("div", { children: [
                /* @__PURE__ */ jsx("dt", { className: "text-muted-foreground", children: "USDT \u4F59\u989D" }),
                /* @__PURE__ */ jsx("dd", { className: "font-mono", children: row.cash_usdt })
              ] }),
              /* @__PURE__ */ jsxs("div", { children: [
                /* @__PURE__ */ jsx("dt", { className: "text-muted-foreground", children: "\u989D\u5916\u76D1\u63A7" }),
                /* @__PURE__ */ jsx("dd", { children: row.max_monitor_wallet })
              ] }),
              /* @__PURE__ */ jsxs("div", { children: [
                /* @__PURE__ */ jsx("dt", { className: "text-muted-foreground", children: "\u5173\u6CE8\u65F6\u95F4" }),
                /* @__PURE__ */ jsx("dd", { children: row.first_time || "\u2014" })
              ] }),
              /* @__PURE__ */ jsxs("div", { children: [
                /* @__PURE__ */ jsx("dt", { className: "text-muted-foreground", children: "\u6700\u8FD1\u65F6\u95F4" }),
                /* @__PURE__ */ jsx("dd", { children: row.last_time || "\u2014" })
              ] }),
              /* @__PURE__ */ jsxs("div", { children: [
                /* @__PURE__ */ jsx("dt", { className: "text-muted-foreground", children: "\u505C\u7528\u65F6\u95F4" }),
                /* @__PURE__ */ jsx("dd", { children: row.stop_time || "\u2014" })
              ] }),
              /* @__PURE__ */ jsxs("div", { className: "col-span-2 min-w-0", children: [
                /* @__PURE__ */ jsx("dt", { className: "text-muted-foreground", children: "\u7ED1\u5B9A\u94B1\u5305" }),
                /* @__PURE__ */ jsx("dd", { className: "break-all font-mono text-[10px]", children: row.bind_trc_wallet_addr || "\u2014" })
              ] })
            ] }),
            permissions && (permissions["\u53D1\u9001\u6D88\u606F"] || permissions["\u7528\u6237\u5145\u503C"] || permissions["\u5220\u9664\u7528\u6237"]) && /* @__PURE__ */ jsxs("div", { className: "flex flex-wrap gap-2 border-t pt-2", children: [
              permissions["\u53D1\u9001\u6D88\u606F"] && /* @__PURE__ */ jsxs(Button, { size: "sm", variant: "outline", className: "h-8", disabled: row.status !== 1 || !telegramEnabled, onClick: () => open("sendmessage", row), children: [
                /* @__PURE__ */ jsx(MessageSquare, { className: "size-3.5" }),
                "\u6D88\u606F"
              ] }),
              permissions["\u7528\u6237\u5145\u503C"] && /* @__PURE__ */ jsxs(Button, { size: "sm", variant: "outline", className: "h-8", onClick: () => open("rechargemanual", row), children: [
                /* @__PURE__ */ jsx(Wallet, { className: "size-3.5" }),
                "\u5145\u503C"
              ] }),
              permissions["\u5220\u9664\u7528\u6237"] && /* @__PURE__ */ jsxs(Button, { size: "sm", variant: "outline", className: "h-8 border-destructive/30 text-destructive hover:bg-destructive/10", onClick: () => open("delete", row), children: [
                /* @__PURE__ */ jsx(Ban, { className: "size-3.5" }),
                "\u5220\u9664"
              ] })
            ] })
          ] }, row.rid)) : /* @__PURE__ */ jsx("div", { className: "py-8 text-center text-xs text-muted-foreground", children: "\u6682\u65E0\u8BB0\u5F55" }) }),
          /* @__PURE__ */ jsx("div", { className: "hidden overflow-x-auto md:block", children: /* @__PURE__ */ jsxs(Table, { className: "min-w-[1740px]", children: [
            /* @__PURE__ */ jsx(TableHeader, { children: /* @__PURE__ */ jsxs(TableRow, { children: [
              ["ID", "\u673A\u5668\u4EBA", "\u7528\u6237 ID", "\u7528\u6237\u540D", "\u7528\u6237\u6635\u79F0", "\u72B6\u6001", "TRX \u4F59\u989D", "USDT \u4F59\u989D", "\u989D\u5916\u76D1\u63A7", "\u7ED1\u5B9A\u94B1\u5305", "\u5173\u6CE8\u65F6\u95F4", "\u6700\u8FD1\u65F6\u95F4", "\u505C\u7528\u65F6\u95F4"].map((x) => /* @__PURE__ */ jsx(TableHead, { className: "h-9 px-3", children: x }, x)),
              permissions && (permissions["\u53D1\u9001\u6D88\u606F"] || permissions["\u7528\u6237\u5145\u503C"] || permissions["\u5220\u9664\u7528\u6237"]) && /* @__PURE__ */ jsx(TableHead, { className: "h-9 px-3 text-right", children: "\u64CD\u4F5C" })
            ] }) }),
            /* @__PURE__ */ jsx(TableBody, { children: data.isPending ? /* @__PURE__ */ jsx(TableRow, { children: /* @__PURE__ */ jsx(TableCell, { colSpan: permissions && (permissions["\u53D1\u9001\u6D88\u606F"] || permissions["\u7528\u6237\u5145\u503C"] || permissions["\u5220\u9664\u7528\u6237"]) ? 14 : 13, className: "h-20 text-center text-xs text-muted-foreground", children: "\u52A0\u8F7D\u4E2D\u2026" }) }) : data.data?.rows.length ? data.data.rows.map((row) => /* @__PURE__ */ jsxs(TableRow, { children: [
              /* @__PURE__ */ jsxs(TableCell, { className: "px-3 py-2 font-mono text-xs", children: [
                "#",
                row.rid
              ] }),
              /* @__PURE__ */ jsx(TableCell, { className: "max-w-36 truncate px-3 py-2 text-xs", children: row.bot_firstname || row.bot_username || `#${row.bot_rid}` }),
              /* @__PURE__ */ jsx(TableCell, { className: "px-3 py-2 font-mono text-xs", children: row.tg_uid }),
              /* @__PURE__ */ jsx(TableCell, { className: "px-3 py-2 text-xs", children: row.tg_username ? `@${row.tg_username}` : "\u2014" }),
              /* @__PURE__ */ jsx(TableCell, { className: "max-w-40 truncate px-3 py-2 text-xs", children: row.tg_nickname || "\u2014" }),
              /* @__PURE__ */ jsx(TableCell, { className: "px-3 py-2", children: /* @__PURE__ */ jsx("span", { className: `rounded-full px-2 py-1 text-[10px] ${row.status === 1 ? "bg-emerald-50 text-emerald-700" : row.status === 2 ? "bg-muted text-muted-foreground" : "bg-amber-50 text-amber-700"}`, children: row.status_label }) }),
              /* @__PURE__ */ jsx(TableCell, { className: "px-3 py-2 font-mono text-xs", children: row.cash_trx }),
              /* @__PURE__ */ jsx(TableCell, { className: "px-3 py-2 font-mono text-xs", children: row.cash_usdt }),
              /* @__PURE__ */ jsx(TableCell, { className: "px-3 py-2 text-xs", children: row.max_monitor_wallet }),
              /* @__PURE__ */ jsx(TableCell, { className: "max-w-48 truncate px-3 py-2 font-mono text-[10px]", title: row.bind_trc_wallet_addr || "", children: row.bind_trc_wallet_addr || "\u2014" }),
              /* @__PURE__ */ jsx(TableCell, { className: "whitespace-nowrap px-3 py-2 text-xs", children: row.first_time || "\u2014" }),
              /* @__PURE__ */ jsx(TableCell, { className: "whitespace-nowrap px-3 py-2 text-xs", children: row.last_time || "\u2014" }),
              /* @__PURE__ */ jsx(TableCell, { className: "whitespace-nowrap px-3 py-2 text-xs", children: row.stop_time || "\u2014" }),
              permissions && (permissions["\u53D1\u9001\u6D88\u606F"] || permissions["\u7528\u6237\u5145\u503C"] || permissions["\u5220\u9664\u7528\u6237"]) && /* @__PURE__ */ jsx(TableCell, { className: "px-3 py-2 text-right", children: /* @__PURE__ */ jsxs("div", { className: "flex justify-end gap-1", children: [
                permissions["\u53D1\u9001\u6D88\u606F"] && /* @__PURE__ */ jsxs(Button, { size: "sm", variant: "outline", className: "h-7 px-2 text-[11px]", disabled: row.status !== 1 || !telegramEnabled, onClick: () => open("sendmessage", row), children: [
                  /* @__PURE__ */ jsx(MessageSquare, { className: "mr-1 size-3" }),
                  "\u6D88\u606F"
                ] }),
                permissions["\u7528\u6237\u5145\u503C"] && /* @__PURE__ */ jsxs(Button, { size: "sm", variant: "outline", className: "h-7 px-2 text-[11px]", onClick: () => open("rechargemanual", row), children: [
                  /* @__PURE__ */ jsx(Wallet, { className: "mr-1 size-3" }),
                  "\u5145\u503C"
                ] }),
                permissions["\u5220\u9664\u7528\u6237"] && /* @__PURE__ */ jsxs(Button, { size: "sm", variant: "outline", className: "h-7 border-destructive/30 px-2 text-[11px] text-destructive hover:bg-destructive/10", onClick: () => open("delete", row), children: [
                  /* @__PURE__ */ jsx(Ban, { className: "mr-1 size-3" }),
                  "\u5220\u9664"
                ] })
              ] }) })
            ] }, row.rid)) : /* @__PURE__ */ jsx(TableRow, { children: /* @__PURE__ */ jsx(TableCell, { colSpan: permissions && (permissions["\u53D1\u9001\u6D88\u606F"] || permissions["\u7528\u6237\u5145\u503C"] || permissions["\u5220\u9664\u7528\u6237"]) ? 14 : 13, className: "h-20 text-center text-xs text-muted-foreground", children: "\u6682\u65E0\u8BB0\u5F55" }) }) })
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
      ] }),
      /* @__PURE__ */ jsx(Dialog, { open: !!action, onOpenChange: (v) => {
        if (!v) close();
      }, children: /* @__PURE__ */ jsxs(DialogContent, { "aria-describedby": void 0, className: "max-w-md gap-4", children: [
        /* @__PURE__ */ jsx(DialogHeader, { children: /* @__PURE__ */ jsx(DialogTitle, { className: "text-base", children: { sendmessage: "\u53D1\u9001\u6D88\u606F", batchsendmessage: "\u7FA4\u53D1\u6D88\u606F", rechargemanual: "\u7528\u6237\u5145\u503C", delete: "\u5220\u9664\u7528\u6237", batchdelete: "\u6279\u91CF\u5220\u9664\u505C\u7528" }[action || "delete"] }) }),
        selected && /* @__PURE__ */ jsxs("div", { className: "rounded-lg bg-muted px-3 py-2 text-xs", children: [
          selected.bot_firstname || selected.bot_username,
          " \xB7 ",
          selected.tg_nickname || selected.tg_username || selected.tg_uid,
          /* @__PURE__ */ jsxs("span", { className: "block font-mono text-[10px] text-muted-foreground", children: [
            "ID ",
            selected.tg_uid
          ] })
        ] }),
        (action === "batchsendmessage" || action === "batchdelete") && /* @__PURE__ */ jsxs(Select, { value: broadcastBot, onValueChange: setBroadcastBot, children: [
          /* @__PURE__ */ jsx(SelectTrigger, { className: "h-9 text-xs", children: /* @__PURE__ */ jsx(SelectValue, { placeholder: "\u9009\u62E9\u673A\u5668\u4EBA" }) }),
          /* @__PURE__ */ jsx(SelectContent, { children: options.data?.bots.map((bot) => /* @__PURE__ */ jsx(SelectItem, { value: String(bot.rid), className: "text-xs", children: bot.bot_firstname || bot.bot_username || `\u673A\u5668\u4EBA #${bot.rid}` }, bot.rid)) })
        ] }),
        (action === "sendmessage" || action === "batchsendmessage") && /* @__PURE__ */ jsx(Textarea, { rows: 5, maxLength: 4096, value: message, onChange: (e) => setMessage(e.target.value), placeholder: "\u6D88\u606F\u5185\u5BB9\uFF0C\u652F\u6301 Telegram HTML", className: "text-xs" }),
        action === "rechargemanual" && /* @__PURE__ */ jsx("div", { className: "space-y-3", children: [["cash_trx", "\u53EF\u7528 TRX \u4F59\u989D"], ["cash_usdt", "\u53EF\u7528 USDT \u4F59\u989D"], ["max_monitor_wallet", "\u989D\u5916\u76D1\u63A7\u5730\u5740\u6570\u91CF"]].map(([key, label]) => /* @__PURE__ */ jsxs("label", { className: "block space-y-1 text-xs", children: [
          /* @__PURE__ */ jsxs("span", { children: [
            label,
            " ",
            /* @__PURE__ */ jsxs("span", { className: "text-muted-foreground", children: [
              "\u5F53\u524D ",
              selected?.[key] ?? ""
            ] })
          ] }),
          /* @__PURE__ */ jsx(Input, { type: "number", min: "0", step: key === "max_monitor_wallet" ? "1" : "0.000001", value: credit[key], onChange: (e) => setCredit({ ...credit, [key]: e.target.value }), placeholder: "\u7559\u7A7A\u5219\u4E0D\u53D8", className: "h-9 text-xs" })
        ] }, key)) }),
        action === "delete" && /* @__PURE__ */ jsx("p", { className: "text-xs text-muted-foreground", children: "\u5220\u9664\u540E\u5C06\u79FB\u9664\u6B64\u7528\u6237\u8BB0\u5F55\u3002" }),
        action === "batchdelete" && /* @__PURE__ */ jsx("p", { className: "text-xs text-muted-foreground", children: "\u53EA\u5220\u9664\u6240\u9009\u673A\u5668\u4EBA\u7684\u5DF2\u505C\u7528\u548C\u4E0D\u5B58\u5728\u7528\u6237\u3002" }),
        action && ["sendmessage", "batchsendmessage"].includes(action) && !telegramEnabled && /* @__PURE__ */ jsx("p", { className: "text-xs text-amber-700", children: "\u5F00\u53D1\u73AF\u5883\u5DF2\u5173\u95ED Telegram \u5916\u53D1\u3002" }),
        mutation.error && /* @__PURE__ */ jsx("p", { role: "alert", className: "text-xs text-destructive", children: mutation.error.message }),
        /* @__PURE__ */ jsxs(DialogFooter, { children: [
          /* @__PURE__ */ jsx(Button, { size: "sm", variant: "outline", disabled: mutation.isPending, onClick: close, children: "\u53D6\u6D88" }),
          /* @__PURE__ */ jsx(Button, { size: "sm", variant: action === "delete" || action === "batchdelete" ? "destructive" : "default", disabled: mutation.isPending || action === "sendmessage" && !message.trim() || action === "batchsendmessage" && (!message.trim() || !broadcastBot || !telegramEnabled) || action === "batchdelete" && !broadcastBot || action === "sendmessage" && !telegramEnabled || action === "rechargemanual" && !Object.values(credit).some((v) => v.trim()), onClick: submit, children: mutation.isPending ? "\u5904\u7406\u4E2D" : action === "delete" || action === "batchdelete" ? "\u786E\u8BA4\u5220\u9664" : action === "rechargemanual" ? "\u786E\u8BA4\u5145\u503C" : action === "batchsendmessage" ? "\u786E\u8BA4\u7FA4\u53D1" : "\u53D1\u9001" })
        ] })
      ] }) }),
      /* @__PURE__ */ jsx(Dialog, { open: !!feedback, onOpenChange: (v) => {
        if (!v) setFeedback("");
      }, children: /* @__PURE__ */ jsxs(DialogContent, { "aria-describedby": void 0, className: "max-w-sm", children: [
        /* @__PURE__ */ jsx(DialogHeader, { children: /* @__PURE__ */ jsx(DialogTitle, { className: "text-base", children: feedback }) }),
        /* @__PURE__ */ jsx(DialogFooter, { children: /* @__PURE__ */ jsx(Button, { size: "sm", onClick: () => setFeedback(""), children: "\u786E\u5B9A" }) })
      ] }) })
    ] });
  }
  return UsersPage;
}
export {
  createUsersPage
};
