import { jsx, jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, ChevronLeft, ChevronRight, KeyRound, RefreshCw, Search, Wallet } from "lucide-react";
function createRechargeTradesPage(host) {
  const { AdminShell, Button, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, api, ApiError } = host;
  function RechargeTrades() {
    const client = useQueryClient();
    const me = useQuery({ queryKey: ["me"], queryFn: () => api("/api/me"), retry: false, staleTime: 6e4 });
    const logout = useMutation({ mutationFn: () => api("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), onSuccess: () => {
      client.clear();
      window.location.assign("/console/home");
    } });
    const [filters, setFilters] = useState({ txHash: "", fromAddress: "", toAddress: "" }), [draft, setDraft] = useState(filters), [page, setPage] = useState(1), [pageSize, setPageSize] = useState(15), [selected, setSelected] = useState(null), [feedback, setFeedback] = useState("");
    const query = useQuery({ queryKey: ["recharge-trades", page, pageSize, filters], queryFn: () => api(`/api/recharge-trades?${new URLSearchParams({ page: String(page), pageSize: String(pageSize), ...filters })}`), enabled: !!me.data, retry: false });
    const mutation = useMutation({ mutationFn: (rid) => api("/api/recharge-trades", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "stoporder", rid }) }), onSuccess: async (result) => {
      setSelected(null);
      setFeedback(result.message);
      await client.invalidateQueries({ queryKey: ["recharge-trades"] });
    } });
    if (me.isPending) return /* @__PURE__ */ jsx("div", { className: "flex min-h-screen items-center justify-center", children: /* @__PURE__ */ jsx(RefreshCw, { className: "size-4 animate-spin text-muted-foreground", "aria-label": "\u6B63\u5728\u52A0\u8F7D" }) });
    if (!me.data) return /* @__PURE__ */ jsx("main", { className: "flex min-h-screen items-center justify-center p-4", children: /* @__PURE__ */ jsxs("section", { className: "w-full max-w-sm space-y-4 rounded-xl bg-card p-6 shadow-sm", children: [
      /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 text-sm font-semibold", children: [
        /* @__PURE__ */ jsx(Wallet, { className: "size-4" }),
        "TGBotPress"
      ] }),
      /* @__PURE__ */ jsx("h1", { className: "text-base font-semibold", children: "\u767B\u5F55\u7BA1\u7406\u540E\u53F0" }),
      /* @__PURE__ */ jsx(Button, { asChild: true, className: "w-full", children: /* @__PURE__ */ jsxs("a", { href: "/api/auth/start?destination=rechargeTrades", children: [
        /* @__PURE__ */ jsx(KeyRound, { className: "size-4" }),
        "\u7BA1\u7406\u5458\u767B\u5F55"
      ] }) })
    ] }) });
    const total = query.data?.total || 0, pages = Math.max(1, Math.ceil(total / pageSize));
    const apply = () => {
      setFilters({ ...draft, txHash: draft.txHash.trim(), fromAddress: draft.fromAddress.trim(), toAddress: draft.toAddress.trim() });
      setPage(1);
    };
    return /* @__PURE__ */ jsxs(AdminShell, { user: me.data, title: "\u5145\u503C\u4EA4\u6613", activeRoute: "admin.groupuser.rechargetrade.index", onRefresh: () => query.refetch(), onLogout: () => logout.mutate(), children: [
      /* @__PURE__ */ jsxs("main", { className: "space-y-3 p-3 sm:p-4", children: [
        /* @__PURE__ */ jsxs("section", { className: "flex flex-wrap items-center gap-2 rounded-xl bg-card p-3", children: [
          /* @__PURE__ */ jsxs("form", { className: "grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-3", onSubmit: (e) => {
            e.preventDefault();
            apply();
          }, children: [
            /* @__PURE__ */ jsx(Input, { value: draft.txHash, maxLength: 100, onChange: (e) => setDraft({ ...draft, txHash: e.target.value }), placeholder: "\u4EA4\u6613 Hash", className: "h-9 text-xs" }),
            /* @__PURE__ */ jsx(Input, { value: draft.fromAddress, maxLength: 200, onChange: (e) => setDraft({ ...draft, fromAddress: e.target.value }), placeholder: "\u53D1\u9001\u94B1\u5305\u5730\u5740", className: "h-9 text-xs" }),
            /* @__PURE__ */ jsx(Input, { value: draft.toAddress, maxLength: 200, onChange: (e) => setDraft({ ...draft, toAddress: e.target.value }), placeholder: "\u63A5\u6536\u94B1\u5305\u5730\u5740", className: "h-9 text-xs" }),
            /* @__PURE__ */ jsxs("div", { className: "flex gap-2 sm:col-span-3", children: [
              /* @__PURE__ */ jsxs(Button, { size: "sm", className: "h-9", children: [
                /* @__PURE__ */ jsx(Search, { className: "size-3.5" }),
                "\u641C\u7D22"
              ] }),
              /* @__PURE__ */ jsx(Button, { size: "sm", type: "button", variant: "outline", className: "h-9", onClick: () => {
                const empty = { txHash: "", fromAddress: "", toAddress: "" };
                setDraft(empty);
                setFilters(empty);
                setPage(1);
              }, children: "\u91CD\u7F6E" })
            ] })
          ] }),
          /* @__PURE__ */ jsx(Button, { variant: "outline", size: "icon", className: "size-9", "aria-label": "\u5237\u65B0", disabled: query.isFetching, onClick: () => query.refetch(), children: /* @__PURE__ */ jsx(RefreshCw, { className: `size-3.5 ${query.isFetching ? "animate-spin" : ""}` }) })
        ] }),
        /* @__PURE__ */ jsxs("section", { className: "overflow-hidden rounded-xl bg-card", children: [
          /* @__PURE__ */ jsxs("header", { className: "flex h-11 items-center justify-between border-b px-3", children: [
            /* @__PURE__ */ jsxs("h1", { className: "flex items-center gap-2 text-sm font-semibold", children: [
              /* @__PURE__ */ jsx(Wallet, { className: "size-4 text-muted-foreground" }),
              "\u5145\u503C\u4EA4\u6613"
            ] }),
            /* @__PURE__ */ jsxs("span", { className: "text-xs text-muted-foreground", children: [
              "\u5171 ",
              total,
              " \u6761"
            ] })
          ] }),
          query.error && /* @__PURE__ */ jsx("div", { role: "alert", className: "px-3 py-3 text-xs text-destructive", children: query.error instanceof ApiError ? query.error.message : "\u52A0\u8F7D\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5" }),
          mutation.error && /* @__PURE__ */ jsx("div", { role: "alert", className: "px-3 py-3 text-xs text-destructive", children: mutation.error.message }),
          /* @__PURE__ */ jsx("div", { className: "space-y-2 p-2 md:hidden", children: query.isPending ? /* @__PURE__ */ jsx("div", { className: "py-8 text-center text-xs text-muted-foreground", children: "\u52A0\u8F7D\u4E2D\u2026" }) : query.data?.rows.length ? query.data.rows.map((row) => /* @__PURE__ */ jsxs("article", { className: "space-y-3 rounded-lg border p-3", children: [
            /* @__PURE__ */ jsxs("header", { className: "flex items-start justify-between gap-3", children: [
              /* @__PURE__ */ jsxs("div", { className: "min-w-0", children: [
                /* @__PURE__ */ jsxs("div", { className: "truncate font-mono text-[11px]", children: [
                  "\u4EA4\u6613 #",
                  row.rid,
                  " \xB7 ",
                  row.tx_hash
                ] }),
                /* @__PURE__ */ jsxs("div", { className: "mt-1 text-sm font-medium", children: [
                  row.coin_name,
                  " ",
                  row.amount
                ] })
              ] }),
              /* @__PURE__ */ jsx("span", { className: `shrink-0 rounded-full px-2 py-1 text-[10px] ${row.process_status === 9 ? "bg-emerald-50 text-emerald-700" : row.process_status === 1 ? "bg-amber-50 text-amber-700" : "bg-muted text-foreground"}`, children: row.process_status_label })
            ] }),
            /* @__PURE__ */ jsxs("dl", { className: "grid grid-cols-2 gap-x-3 gap-y-2 text-xs", children: [
              /* @__PURE__ */ jsxs("div", { className: "col-span-2 min-w-0", children: [
                /* @__PURE__ */ jsx("dt", { className: "text-muted-foreground", children: "\u53D1\u9001\u94B1\u5305" }),
                /* @__PURE__ */ jsx("dd", { className: "break-all font-mono text-[10px]", children: row.transferfrom_address })
              ] }),
              /* @__PURE__ */ jsxs("div", { className: "col-span-2 min-w-0", children: [
                /* @__PURE__ */ jsx("dt", { className: "text-muted-foreground", children: "\u63A5\u6536\u94B1\u5305" }),
                /* @__PURE__ */ jsx("dd", { className: "break-all font-mono text-[10px]", children: row.transferto_address })
              ] }),
              /* @__PURE__ */ jsxs("div", { children: [
                /* @__PURE__ */ jsx("dt", { className: "text-muted-foreground", children: "\u4EA4\u6613\u65F6\u95F4" }),
                /* @__PURE__ */ jsx("dd", { children: row.timestamp })
              ] }),
              /* @__PURE__ */ jsxs("div", { children: [
                /* @__PURE__ */ jsx("dt", { className: "text-muted-foreground", children: "\u62C9\u53D6\u65F6\u95F4" }),
                /* @__PURE__ */ jsx("dd", { children: row.get_time || "\u2014" })
              ] }),
              /* @__PURE__ */ jsxs("div", { children: [
                /* @__PURE__ */ jsx("dt", { className: "text-muted-foreground", children: "\u5904\u7406\u65F6\u95F4" }),
                /* @__PURE__ */ jsx("dd", { children: row.process_time || "\u2014" })
              ] }),
              /* @__PURE__ */ jsxs("div", { children: [
                /* @__PURE__ */ jsx("dt", { className: "text-muted-foreground", children: "\u5145\u503C\u8BA2\u5355" }),
                /* @__PURE__ */ jsx("dd", { className: "font-mono", children: row.recharge_order_rid ? `#${row.recharge_order_rid}` : "\u2014" })
              ] }),
              /* @__PURE__ */ jsxs("div", { className: "col-span-2", children: [
                /* @__PURE__ */ jsx("dt", { className: "text-muted-foreground", children: "\u5904\u7406\u5907\u6CE8" }),
                /* @__PURE__ */ jsx("dd", { className: "break-words", children: row.process_comments || "\u2014" })
              ] })
            ] }),
            query.data.canStop && /* @__PURE__ */ jsx("div", { className: "border-t pt-2", children: /* @__PURE__ */ jsxs(Button, { size: "sm", variant: "outline", className: "h-8 border-destructive/30 text-destructive hover:bg-destructive/10", disabled: !row.canStop, onClick: () => setSelected(row), children: [
              /* @__PURE__ */ jsx(Ban, { className: "size-3.5" }),
              "\u7981\u6B62"
            ] }) })
          ] }, row.rid)) : /* @__PURE__ */ jsx("div", { className: "py-8 text-center text-xs text-muted-foreground", children: "\u6682\u65E0\u5145\u503C\u4EA4\u6613" }) }),
          /* @__PURE__ */ jsx("div", { className: "hidden overflow-x-auto md:block", children: /* @__PURE__ */ jsxs(Table, { className: "min-w-[1400px]", children: [
            /* @__PURE__ */ jsx(TableHeader, { children: /* @__PURE__ */ jsxs(TableRow, { children: [
              ["ID", "\u4EA4\u6613 Hash", "\u53D1\u9001\u94B1\u5305\u5730\u5740", "\u63A5\u6536\u94B1\u5305\u5730\u5740", "\u8F6C\u5165\u5E01\u540D", "\u8F6C\u5165\u6570\u989D", "\u4EA4\u6613\u65F6\u95F4", "\u62C9\u53D6\u65F6\u95F4", "\u5904\u7406\u72B6\u6001", "\u5904\u7406\u65F6\u95F4", "\u5904\u7406\u5907\u6CE8", "\u5145\u503C\u8BA2\u5355"].map((x) => /* @__PURE__ */ jsx(TableHead, { className: "h-9 px-3", children: x }, x)),
              query.data?.canStop && /* @__PURE__ */ jsx(TableHead, { className: "h-9 px-3 text-right", children: "\u64CD\u4F5C" })
            ] }) }),
            /* @__PURE__ */ jsx(TableBody, { children: query.isPending ? /* @__PURE__ */ jsx(TableRow, { children: /* @__PURE__ */ jsx(TableCell, { colSpan: 12, className: "h-20 text-center text-xs text-muted-foreground", children: "\u52A0\u8F7D\u4E2D\u2026" }) }) : query.data?.rows.length ? query.data.rows.map((row) => /* @__PURE__ */ jsxs(TableRow, { children: [
              /* @__PURE__ */ jsxs(TableCell, { className: "px-3 py-2 font-mono text-xs", children: [
                "#",
                row.rid
              ] }),
              /* @__PURE__ */ jsx(TableCell, { className: "max-w-48 truncate px-3 py-2 font-mono text-[10px]", title: row.tx_hash, children: row.tx_hash }),
              /* @__PURE__ */ jsx(TableCell, { className: "max-w-48 truncate px-3 py-2 font-mono text-[10px]", title: row.transferfrom_address, children: row.transferfrom_address }),
              /* @__PURE__ */ jsx(TableCell, { className: "max-w-48 truncate px-3 py-2 font-mono text-[10px]", title: row.transferto_address, children: row.transferto_address }),
              /* @__PURE__ */ jsx(TableCell, { className: "px-3 py-2 text-xs", children: row.coin_name }),
              /* @__PURE__ */ jsx(TableCell, { className: "px-3 py-2 font-mono text-xs", children: row.amount }),
              /* @__PURE__ */ jsx(TableCell, { className: "whitespace-nowrap px-3 py-2 text-xs", children: row.timestamp }),
              /* @__PURE__ */ jsx(TableCell, { className: "whitespace-nowrap px-3 py-2 text-xs", children: row.get_time || "\u2014" }),
              /* @__PURE__ */ jsx(TableCell, { className: "px-3 py-2", children: /* @__PURE__ */ jsx("span", { className: `rounded-full px-2 py-1 text-[10px] ${row.process_status === 9 ? "bg-emerald-50 text-emerald-700" : row.process_status === 1 ? "bg-amber-50 text-amber-700" : row.process_status === 2 ? "bg-muted text-muted-foreground" : "bg-muted text-foreground"}`, children: row.process_status_label }) }),
              /* @__PURE__ */ jsx(TableCell, { className: "whitespace-nowrap px-3 py-2 text-xs", children: row.process_time || "\u2014" }),
              /* @__PURE__ */ jsx(TableCell, { className: "max-w-44 truncate px-3 py-2 text-xs", title: row.process_comments || "", children: row.process_comments || "\u2014" }),
              /* @__PURE__ */ jsx(TableCell, { className: "px-3 py-2 font-mono text-xs", children: row.recharge_order_rid ? `#${row.recharge_order_rid}` : "\u2014" }),
              query.data?.canStop && /* @__PURE__ */ jsx(TableCell, { className: "px-3 py-2 text-right", children: /* @__PURE__ */ jsxs(Button, { size: "sm", variant: "outline", className: "h-7 border-destructive/30 px-2 text-[11px] text-destructive hover:bg-destructive/10", disabled: !row.canStop, onClick: () => setSelected(row), children: [
                /* @__PURE__ */ jsx(Ban, { className: "mr-1 size-3" }),
                "\u7981\u6B62"
              ] }) })
            ] }, row.rid)) : /* @__PURE__ */ jsx(TableRow, { children: /* @__PURE__ */ jsx(TableCell, { colSpan: query.data?.canStop ? 13 : 12, className: "h-20 text-center text-xs text-muted-foreground", children: "\u6682\u65E0\u8BB0\u5F55" }) }) })
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
              /* @__PURE__ */ jsx(Button, { variant: "outline", size: "icon", className: "size-8", "aria-label": "\u4E0A\u4E00\u9875", disabled: page <= 1 || query.isFetching, onClick: () => setPage((v) => v - 1), children: /* @__PURE__ */ jsx(ChevronLeft, { className: "size-3.5" }) }),
              /* @__PURE__ */ jsx(Button, { variant: "outline", size: "icon", className: "size-8", "aria-label": "\u4E0B\u4E00\u9875", disabled: page >= pages || query.isFetching, onClick: () => setPage((v) => v + 1), children: /* @__PURE__ */ jsx(ChevronRight, { className: "size-3.5" }) })
            ] })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ jsx(Dialog, { open: !!selected, onOpenChange: (open) => {
        if (!open) setSelected(null);
      }, children: /* @__PURE__ */ jsxs(DialogContent, { "aria-describedby": void 0, className: "max-w-md gap-4", children: [
        /* @__PURE__ */ jsx(DialogHeader, { children: /* @__PURE__ */ jsx(DialogTitle, { className: "text-base", children: "\u7981\u6B62\u5145\u503C" }) }),
        selected && /* @__PURE__ */ jsxs("div", { className: "space-y-2 rounded-lg bg-muted p-3 text-xs", children: [
          /* @__PURE__ */ jsxs("div", { children: [
            "\u4EA4\u6613 Hash ",
            /* @__PURE__ */ jsx("span", { className: "block break-all font-mono", children: selected.tx_hash })
          ] }),
          /* @__PURE__ */ jsxs("div", { children: [
            "\u53D1\u9001\u5730\u5740 ",
            /* @__PURE__ */ jsx("span", { className: "block break-all font-mono", children: selected.transferfrom_address })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "flex gap-5", children: [
            /* @__PURE__ */ jsxs("span", { children: [
              selected.coin_name,
              " ",
              selected.amount
            ] }),
            /* @__PURE__ */ jsx("span", { children: selected.timestamp })
          ] }),
          /* @__PURE__ */ jsxs("div", { children: [
            "\u5F53\u524D\u72B6\u6001\uFF1A",
            selected.process_status_label
          ] })
        ] }),
        mutation.error && /* @__PURE__ */ jsx("p", { role: "alert", className: "text-xs text-destructive", children: mutation.error.message }),
        /* @__PURE__ */ jsxs(DialogFooter, { children: [
          /* @__PURE__ */ jsx(Button, { variant: "outline", size: "sm", disabled: mutation.isPending, onClick: () => setSelected(null), children: "\u53D6\u6D88" }),
          /* @__PURE__ */ jsx(Button, { variant: "destructive", size: "sm", disabled: mutation.isPending, onClick: () => selected && mutation.mutate(selected.rid), children: mutation.isPending ? "\u5904\u7406\u4E2D" : "\u786E\u8BA4\u7981\u6B62" })
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
  return RechargeTrades;
}
export {
  createRechargeTradesPage
};
