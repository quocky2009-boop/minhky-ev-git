"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { NAV, NAV_GROUPS, ROLES } from "@/lib/const";
import GlobalSearch from "@/components/GlobalSearch";

const base = (href) => href.split("?")[0];

export default function AppShell({ profile, children }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const supabase = createClient();

  // Nhom chua trang dang mo
  const groupOf = (path) => NAV_GROUPS.find((g) => g.label && g.items.some((n) => path.startsWith(base(n.href))))?.label;
  const [openGroups, setOpenGroups] = useState(() => new Set([groupOf(pathname)].filter(Boolean)));
  useEffect(() => {
    const g = groupOf(pathname);
    if (g) setOpenGroups((prev) => (prev.has(g) ? prev : new Set([...prev, g])));
  }, [pathname]);
  const toggle = (label) => setOpenGroups((prev) => {
    const s = new Set(prev); s.has(label) ? s.delete(label) : s.add(label); return s;
  });

  // Trang thai active (rieng Tai chinh phan biet theo tab)
  const curTab = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("tab") || "quy" : "quy";
  const isActive = (n) => pathname.startsWith(base(n.href)) && (!n.tab || n.tab === curTab);

  const title = NAV.find((n) => pathname.startsWith(base(n.href)) && (!n.tab || n.tab === curTab))?.label
    || NAV.find((n) => pathname.startsWith(base(n.href)))?.label || "";

  // Dem viec dang cho xu ly -> badge do tren menu
  const [badges, setBadges] = useState({});
  useEffect(() => {
    let huy = false;
    const dem = async () => {
      const q = [
        supabase.from("sales_orders").select("id", { count: "exact", head: true }).neq("invoice_status", "Đã xuất HĐ"),
        supabase.from("sale_adjust_requests").select("id", { count: "exact", head: true }).eq("status", "Chờ duyệt"),
        supabase.from("dv_tickets").select("id", { count: "exact", head: true }).not("status", "in", "(DA_GIAO,HUY)"),
        supabase.from("deposits").select("id", { count: "exact", head: true }).eq("status", "DANG_GIU"),
        supabase.from("v_task_list").select("id", { count: "exact", head: true })
          .not("status", "in", "(completed,cancelled)"),
        supabase.from("v_task_list").select("id", { count: "exact", head: true }).eq("status", "pending_review"),
      ];
      const [don, dc, dv, coc, task, taskDuyet] = await Promise.all(q.map((x) => x.then((r) => r.count || 0).catch(() => 0)));
      if (!huy) setBadges({ "/don-ban": don, "/dieu-chinh": dc, "/dich-vu": dv, "/dat-coc": coc,
        "/cong-viec": task, "/cong-viec/doi-nhom": taskDuyet });
    };
    dem();
    const t = setInterval(dem, 60000);
    return () => { huy = true; clearInterval(t); };
  }, [pathname]);

  const signOut = async () => { await supabase.auth.signOut(); window.location.href = "/login"; };

  const ItemLink = ({ n, sub }) => (
    <Link href={n.href} onClick={() => setOpen(false)}
      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13.5px] font-semibold mb-0.5 ${sub ? "ml-3" : ""} ${isActive(n) ? "bg-brand text-white" : "hover:bg-navy-800"}`}>
      <span className="flex-1">{n.label}</span>
      {badges[base(n.href)] > 0 && (
        <span className={`min-w-[20px] h-5 px-1.5 rounded-full text-[10.5px] font-extrabold flex items-center justify-center ${isActive(n) ? "bg-white text-brand" : "bg-danger text-white"}`}>
          {badges[base(n.href)] > 99 ? "99+" : badges[base(n.href)]}
        </span>
      )}
    </Link>
  );

  return (
    <div className="flex min-h-screen">
      {open && <div className="fixed inset-0 bg-black/40 z-40 md:hidden" onClick={() => setOpen(false)} />}
      <aside className={`w-[232px] bg-navy-900 text-[#C8D3E0] flex flex-col shrink-0 fixed md:static z-50 h-screen md:h-auto transition-transform ${open ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}>
        <div className="px-4 py-5 border-b border-navy-700">
          <div className="text-lg font-extrabold text-white tracking-wide">MINH KỲ <span className="text-[#4ADE80]">EV</span></div>
          <div className="text-[11px] text-[#7E8FA3] mt-0.5">Quản lý hệ thống xe điện</div>
        </div>
        <nav className="flex-1 p-2 overflow-y-auto">
          {NAV_GROUPS.map((g, gi) => {
            const items = g.items.filter((n) => n.roles.includes(profile.role));
            if (items.length === 0) return null;
            if (!g.label) return items.map((n) => <ItemLink key={n.href} n={n} />);
            const opened = openGroups.has(g.label);
            const hasActive = items.some((n) => pathname.startsWith(base(n.href)));
            return (
              <div key={g.label} className="mb-0.5">
                <button onClick={() => toggle(g.label)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[12px] font-extrabold tracking-wide ${hasActive && !opened ? "text-white bg-navy-800" : "text-[#8FA0B5]"} hover:bg-navy-800 hover:text-white`}>
                  <span className="flex-1 text-left">{g.label}</span>
                  {!opened && items.reduce((a, n) => a + (badges[base(n.href)] || 0), 0) > 0 && (
                    <span className="min-w-[20px] h-5 px-1.5 rounded-full text-[10.5px] font-extrabold flex items-center justify-center bg-danger text-white">
                      {items.reduce((a, n) => a + (badges[base(n.href)] || 0), 0)}
                    </span>
                  )}
                  <span className="text-[10px]">{opened ? "▾" : "▸"}</span>
                </button>
                {opened && <div className="mt-0.5">{items.map((n) => <ItemLink key={n.href} n={n} sub />)}</div>}
              </div>
            );
          })}
        </nav>
        <div className="p-3.5 border-t border-navy-700 flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-brand text-white flex items-center justify-center font-extrabold">{(profile.name || "?")[0].toUpperCase()}</div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-bold text-white truncate">{profile.name}</div>
            <div className="text-[11px] text-[#7E8FA3]">{ROLES[profile.role]}{profile.region ? ` · ${profile.region}` : ""}</div>
          </div>
          <button onClick={signOut} title="Đăng xuất" className="text-[#7E8FA3] hover:text-white">⎋</button>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <header className="bg-white border-b border-[#E6EAEF] px-5 py-3 flex items-center gap-3 sticky top-0 z-20">
          <button className="md:hidden border border-[#D5DBE3] rounded-lg px-2.5 py-1.5" onClick={() => setOpen(true)}>☰</button>
          <div className="text-[17px] font-extrabold whitespace-nowrap hidden sm:block">{title}</div>
          <GlobalSearch />
          <div className="text-xs text-[#8A93A0] whitespace-nowrap hidden md:block">{new Date().toLocaleDateString("vi-VN")}</div>
        </header>
        <div className="p-5 max-w-[1180px] mx-auto pb-16">{children}</div>
      </main>
    </div>
  );
}
