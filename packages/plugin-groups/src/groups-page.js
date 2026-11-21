import { jsx, jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, ChevronLeft, ChevronRight, KeyRound, MessageSquare, RefreshCw, Search, Users } from "lucide-react";
function createGroupsPage(host) {
  const { AdminShell, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Textarea, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, api, ApiError } = host;
  function Groups() {
    const client = useQueryClient(), me = useQuery({ queryKey: ["me"], queryFn: () => api("/api/me"), retry: false, staleTime: 6e4 });
    const logout = useMutation({ mutationFn: () => api("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), onSuccess: () => {
      client.clear();
      window.location.assign("/console/home");
    } });
    const [draft, setDraft] = useState(""), [search, setSearch] = useState(""), [botRid, setBotRid] = useState("all"), [page, setPage] = useState(1), [pageSize, setPageSize] = useState(15), [action, setAction] = useState(null), [selected, setSelected] = useState(null), [message, setMessage] = useState(""), [feedback, setFeedback] = useState("");
    const options = useQuery({ queryKey: ["groups", "options"], queryFn: () => api("/api/groups?action=options"), enabled: !!me.data, retry: false });
    const data = useQuery({ queryKey: ["groups", page, pageSize, search, botRid], queryFn: () => api(`/api/groups?${new URLSearchParams({ page: String(page), pageSize: String(pageSize), search, botRid })}`), enabled: !!me.data, retry: false });
    const mutation = useMutation({ mutationFn: () => api("/api/groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, rid: selected?.rid, ...action === "sendmessage" ? { message } : {} }) }), onSuccess: async (result) => {
      setAction(null);
      setSelected(null);
      setMessage("");
      setFeedback(result.message);
      await client.invalidateQueries({ queryKey: ["groups"] });
    } });
    if (me.isPending) return /* @__PURE__ */ jsx("div", { className: "flex min-h-screen items-center justify-center", children: /* @__PURE__ */ jsx(RefreshCw, { className: "size-4 animate-spin text-muted-foreground", "aria-label": "\u6B63\u5728\u52A0\u8F7D" }) });
    if (!me.data) return /* @__PURE__ */ jsx("main", { className: "flex min-h-screen items-center justify-center p-4", children: /* @__PURE__ */ jsxs("section", { className: "w-full max-w-sm space-y-4 rounded-xl bg-card p-6 shadow-sm", children: [
      /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 text-sm font-semibold", children: [
        /* @__PURE__ */ jsx(Users, { className: "size-4" }),
        "TGBotPress"
      ] }),
      /* @__PURE__ */ jsx("h1", { className: "text-base font-semibold", children: "\u767B\u5F55\u7BA1\u7406\u540E\u53F0" }),
      /* @__PURE__ */ jsx(Button, { asChild: true, className: "w-full", children: /* @__PURE__ */ jsxs("a", { href: "/api/auth/start?destination=groups", children: [
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
    return /* @__PURE__ */ jsxs(AdminShell, { user: me.data, title: "\u7FA4\u7EC4\u5217\u8868", activeRoute: "admin.groupuser.group.index", onRefresh: () => data.refetch(), onLogout: () => logout.mutate(), children: [
      /* @__PURE__ */ jsxs("main", { className: "space-y-3 p-3 sm:p-4", children: [
        /* @__PURE__ */ jsxs("section", { className: "flex flex-wrap items-center gap-2 rounded-xl bg-card p-3", children: [
          /* @__PURE__ */ jsxs("form", { className: "flex min-w-0 flex-1 gap-2", onSubmit: (e) => {
            e.preventDefault();
            setSearch(draft.trim());
            setPage(1);
          }, children: [
            /* @__PURE__ */ jsxs("div", { className: "relative min-w-0 flex-1", children: [
              /* @__PURE__ */ jsx(Search, { className: "absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" }),
              /* @__PURE__ */ jsx(Input, { value: draft, onChange: (e) => setDraft(e.target.value), maxLength: 200, placeholder: "\u641C\u7D22\u7FA4\u7EC4\u7528\u6237\u540D", className: "h-9 pl-8 text-xs" }),
              /* @__PURE__ */ jsx("span", { className: "sr-only", children: "\u652F\u6301 @\u7528\u6237\u540D \u6216 t.me \u94FE\u63A5" })
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
              /* @__PURE__ */ jsx(Users, { className: "size-4 text-muted-foreground" }),
              "\u7FA4\u7EC4\u5217\u8868"
            ] }),
            /* @__PURE__ */ jsxs("span", { className: "text-xs text-muted-foreground", children: [
              "\u5171 ",
              total,
              " \u6761"
            ] })
          ] }),
          data.error && /* @__PURE__ */ jsx("div", { role: "alert", className: "px-3 py-3 text-xs text-destructive", children: data.error instanceof ApiError ? data.error.message : "\u52A0\u8F7D\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5" }),
          mutation.error && /* @__PURE__ */ jsx("div", { role: "alert", className: "px-3 py-3 text-xs text-destructive", children: mutation.error.message }),
          /* @__PURE__ */ jsx("div", { className: "hidden overflow-x-auto md:block", children: /* @__PURE__ */ jsxs(Table, { className: "min-w-[1400px]", children: [
            /* @__PURE__ */ jsx(TableHeader, { children: /* @__PURE__ */ jsxs(TableRow, { children: [
              ["\u7FA4\u7EC4", "\u673A\u5668\u4EBA", "\u7FA4\u7EC4 ID", "\u7C7B\u578B", "\u6743\u9650", "\u72B6\u6001", "\u5173\u6CE8\u4EBA\u6570", "\u9996\u6B21\u53D1\u73B0", "\u6700\u8FD1\u6D3B\u52A8", "\u505C\u7528\u65F6\u95F4"].map((x) => /* @__PURE__ */ jsx(TableHead, { className: "h-9 px-3", children: x }, x)),
              (permissions?.send || permissions?.delete) && /* @__PURE__ */ jsx(TableHead, { className: "h-9 px-3 text-right", children: "\u64CD\u4F5C" })
            ] }) }),
            /* @__PURE__ */ jsx(TableBody, { children: data.isPending ? /* @__PURE__ */ jsx(TableRow, { children: /* @__PURE__ */ jsx(TableCell, { colSpan: permissions?.send || permissions?.delete ? 11 : 10, className: "h-20 text-center text-xs text-muted-foreground", children: "\u52A0\u8F7D\u4E2D\u2026" }) }) : data.data?.rows.length ? data.data.rows.map((row) => /* @__PURE__ */ jsxs(TableRow, { children: [
              /* @__PURE__ */ jsxs(TableCell, { className: "max-w-56 truncate px-3 py-2 text-xs", title: row.tg_groupnickname || row.tg_groupusername || "", children: [
                /* @__PURE__ */ jsx("span", { className: "font-medium", children: row.tg_groupnickname || row.tg_groupusername || row.tg_groupid }),
                /* @__PURE__ */ jsx("span", { className: "block font-mono text-[10px] text-muted-foreground", children: row.tg_groupusername ? `@${row.tg_groupusername}` : row.tg_groupid })
              ] }),
              /* @__PURE__ */ jsx(TableCell, { className: "max-w-36 truncate px-3 py-2 text-xs", children: row.bot_firstname || row.bot_username || `#${row.bot_rid}` }),
              /* @__PURE__ */ jsx(TableCell, { className: "px-3 py-2 font-mono text-[11px]", children: row.tg_groupid }),
              /* @__PURE__ */ jsx(TableCell, { className: "px-3 py-2 text-xs", children: row.group_type }),
              /* @__PURE__ */ jsx(TableCell, { className: "px-3 py-2 text-xs", children: row.is_admin_label }),
              /* @__PURE__ */ jsx(TableCell, { className: "px-3 py-2", children: /* @__PURE__ */ jsx("span", { className: `rounded-full px-2 py-1 text-[10px] ${row.status === 1 ? "bg-emerald-50 text-emerald-700" : row.status === 2 ? "bg-muted text-muted-foreground" : "bg-amber-50 text-amber-700"}`, children: row.status_label }) }),
              /* @__PURE__ */ jsx(TableCell, { className: "px-3 py-2 text-xs", children: row.follow_count }),
              /* @__PURE__ */ jsx(TableCell, { className: "whitespace-nowrap px-3 py-2 text-xs", children: row.first_time || "\u2014" }),
              /* @__PURE__ */ jsx(TableCell, { className: "whitespace-nowrap px-3 py-2 text-xs", children: row.last_time || "\u2014" }),
              /* @__PURE__ */ jsx(TableCell, { className: "whitespace-nowrap px-3 py-2 text-xs", children: row.stop_time || "\u2014" }),
              permissions && (permissions.send || permissions.delete) && /* @__PURE__ */ jsx(TableCell, { className: "px-3 py-2 text-right", children: /* @__PURE__ */ jsxs("div", { className: "flex justify-end gap-1", children: [
                permissions.send && /* @__PURE__ */ jsxs(Button, { size: "sm", variant: "outline", className: "h-7 px-2 text-[11px]", disabled: row.status !== 1 || !telegramEnabled, onClick: () => {
                  setSelected(row);
                  setAction("sendmessage");
                }, children: [
                  /* @__PURE__ */ jsx(MessageSquare, { className: "mr-1 size-3" }),
                  "\u53D1\u9001\u6D88\u606F"
                ] }),
                permissions.delete && /* @__PURE__ */ jsxs(Button, { size: "sm", variant: "outline", className: "h-7 border-destructive/30 px-2 text-[11px] text-destructive hover:bg-destructive/10", onClick: () => {
                  setSelected(row);
                  setAction("delete");
                }, children: [
                  /* @__PURE__ */ jsx(Ban, { className: "mr-1 size-3" }),
                  "\u5220\u9664"
                ] })
              ] }) })
            ] }, row.rid)) : /* @__PURE__ */ jsx(TableRow, { children: /* @__PURE__ */ jsx(TableCell, { colSpan: permissions?.send || permissions?.delete ? 11 : 10, className: "h-20 text-center text-xs text-muted-foreground", children: "\u6682\u65E0\u8BB0\u5F55" }) }) })
          ] }) }),
          /* @__PURE__ */ jsx("div", { className: "divide-y md:hidden", children: data.isPending ? /* @__PURE__ */ jsx("p", { className: "p-6 text-center text-xs text-muted-foreground", children: "\u52A0\u8F7D\u4E2D\u2026" }) : data.data?.rows.length ? data.data.rows.map((row) => /* @__PURE__ */ jsxs("article", { className: "space-y-3 p-3", children: [
            /* @__PURE__ */ jsxs("div", { className: "flex min-w-0 items-start justify-between gap-3", children: [
              /* @__PURE__ */ jsxs("div", { className: "min-w-0", children: [
                /* @__PURE__ */ jsx("p", { className: "truncate text-sm font-medium", children: row.tg_groupnickname || row.tg_groupusername || row.tg_groupid }),
                /* @__PURE__ */ jsx("p", { className: "mt-0.5 truncate text-xs text-muted-foreground", children: row.tg_groupusername ? `@${row.tg_groupusername}` : row.tg_groupid })
              ] }),
              /* @__PURE__ */ jsx("span", { className: `shrink-0 rounded-full px-2 py-1 text-[10px] ${row.status === 1 ? "bg-emerald-50 text-emerald-700" : row.status === 2 ? "bg-muted text-muted-foreground" : "bg-amber-50 text-amber-700"}`, children: row.status_label })
            ] }),
            /* @__PURE__ */ jsxs("div", { className: "grid grid-cols-2 gap-x-4 gap-y-2 text-xs", children: [
              /* @__PURE__ */ jsxs("div", { className: "min-w-0", children: [
                /* @__PURE__ */ jsx("p", { className: "text-muted-foreground", children: "\u673A\u5668\u4EBA" }),
                /* @__PURE__ */ jsx("p", { className: "mt-0.5 truncate", children: row.bot_firstname || row.bot_username || `#${row.bot_rid}` })
              ] }),
              /* @__PURE__ */ jsxs("div", { children: [
                /* @__PURE__ */ jsx("p", { className: "text-muted-foreground", children: "\u7FA4\u7EC4 ID" }),
                /* @__PURE__ */ jsx("p", { className: "mt-0.5 truncate font-mono", children: row.tg_groupid })
              ] }),
              /* @__PURE__ */ jsxs("div", { children: [
                /* @__PURE__ */ jsx("p", { className: "text-muted-foreground", children: "\u7C7B\u578B \xB7 \u6743\u9650" }),
                /* @__PURE__ */ jsxs("p", { className: "mt-0.5", children: [
                  row.group_type,
                  " \xB7 ",
                  row.is_admin_label
                ] })
              ] }),
              /* @__PURE__ */ jsxs("div", { children: [
                /* @__PURE__ */ jsx("p", { className: "text-muted-foreground", children: "\u5173\u6CE8\u4EBA\u6570" }),
                /* @__PURE__ */ jsx("p", { className: "mt-0.5", children: row.follow_count })
              ] }),
              /* @__PURE__ */ jsxs("div", { children: [
                /* @__PURE__ */ jsx("p", { className: "text-muted-foreground", children: "\u9996\u6B21\u53D1\u73B0" }),
                /* @__PURE__ */ jsx("p", { className: "mt-0.5", children: row.first_time || "\u2014" })
              ] }),
              /* @__PURE__ */ jsxs("div", { children: [
                /* @__PURE__ */ jsx("p", { className: "text-muted-foreground", children: "\u6700\u8FD1\u6D3B\u52A8" }),
                /* @__PURE__ */ jsx("p", { className: "mt-0.5", children: row.last_time || "\u2014" })
              ] }),
              row.stop_time && /* @__PURE__ */ jsxs("div", { className: "col-span-2", children: [
                /* @__PURE__ */ jsx("p", { className: "text-muted-foreground", children: "\u505C\u7528\u65F6\u95F4" }),
                /* @__PURE__ */ jsx("p", { className: "mt-0.5", children: row.stop_time })
              ] })
            ] }),
            permissions && (permissions.send || permissions.delete) && /* @__PURE__ */ jsxs("div", { className: "flex flex-wrap gap-2 border-t pt-3", children: [
              permissions.send && /* @__PURE__ */ jsxs(Button, { size: "sm", variant: "outline", className: "h-8", disabled: row.status !== 1 || !telegramEnabled, onClick: () => {
                setSelected(row);
                setAction("sendmessage");
              }, children: [
                /* @__PURE__ */ jsx(MessageSquare, { className: "mr-1.5 size-3.5" }),
                "\u53D1\u9001\u6D88\u606F"
              ] }),
              permissions.delete && /* @__PURE__ */ jsxs(Button, { size: "sm", variant: "outline", className: "h-8 border-destructive/30 text-destructive hover:bg-destructive/10", onClick: () => {
                setSelected(row);
                setAction("delete");
              }, children: [
                /* @__PURE__ */ jsx(Ban, { className: "mr-1.5 size-3.5" }),
                "\u5220\u9664\u7FA4\u7EC4"
              ] })
            ] })
          ] }, row.rid)) : /* @__PURE__ */ jsx("p", { className: "p-6 text-center text-xs text-muted-foreground", children: "\u6682\u65E0\u8BB0\u5F55" }) }),
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
      /* @__PURE__ */ jsx(Dialog, { open: !!action, onOpenChange: (open) => {
        if (!open) close();
      }, children: /* @__PURE__ */ jsxs(DialogContent, { "aria-describedby": void 0, className: "max-w-md gap-4", children: [
        /* @__PURE__ */ jsx(DialogHeader, { children: /* @__PURE__ */ jsx(DialogTitle, { className: "text-base", children: action === "sendmessage" ? "\u53D1\u9001\u6D88\u606F" : "\u5220\u9664\u7FA4\u7EC4" }) }),
        selected && /* @__PURE__ */ jsxs("div", { className: "rounded-lg bg-muted px-3 py-2 text-xs", children: [
          selected.tg_groupnickname || selected.tg_groupusername || selected.tg_groupid,
          " \xB7 ",
          selected.bot_firstname || selected.bot_username || `\u673A\u5668\u4EBA #${selected.bot_rid}`
        ] }),
        action === "sendmessage" && /* @__PURE__ */ jsx(Textarea, { rows: 5, maxLength: 4096, value: message, onChange: (e) => setMessage(e.target.value), placeholder: "\u8F93\u5165\u6D88\u606F\u5185\u5BB9\uFF0C\u652F\u6301 Telegram HTML", className: "text-xs" }),
        action === "delete" && /* @__PURE__ */ jsx("p", { className: "text-xs text-muted-foreground", children: "\u5220\u9664\u7FA4\u7EC4\u8BB0\u5F55\u540E\u65E0\u6CD5\u4ECE\u6B64\u5217\u8868\u6062\u590D\u3002" }),
        mutation.error && /* @__PURE__ */ jsx("p", { role: "alert", className: "text-xs text-destructive", children: mutation.error.message }),
        /* @__PURE__ */ jsxs(DialogFooter, { children: [
          /* @__PURE__ */ jsx(Button, { size: "sm", variant: "outline", disabled: mutation.isPending, onClick: close, children: "\u53D6\u6D88" }),
          /* @__PURE__ */ jsx(Button, { size: "sm", variant: action === "delete" ? "destructive" : "default", disabled: mutation.isPending || action === "sendmessage" && !message.trim(), onClick: () => mutation.mutate(), children: mutation.isPending ? "\u5904\u7406\u4E2D" : action === "delete" ? "\u786E\u8BA4\u5220\u9664" : "\u53D1\u9001" })
        ] })
      ] }) }),
      /* @__PURE__ */ jsx(Dialog, { open: !!feedback, onOpenChange: (open) => {
        if (!open) setFeedback("");
      }, children: /* @__PURE__ */ jsxs(DialogContent, { "aria-describedby": void 0, className: "max-w-sm", children: [
        /* @__PURE__ */ jsx(DialogHeader, { children: /* @__PURE__ */ jsx(DialogTitle, { className: "text-base", children: feedback }) }),
        /* @__PURE__ */ jsx(DialogFooter, { children: /* @__PURE__ */ jsx(Button, { size: "sm", onClick: () => setFeedback(""), children: "\u786E\u5B9A" }) })
      ] }) })
    ] });
  }
  return Groups;
}
export {
  createGroupsPage
};
