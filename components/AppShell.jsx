"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { NAV, NAV_GROUPS, ROLES } from "@/lib/const";

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

  const signOut = async () => { await supabase.auth.signOut(); window.location.href = "/login"; };

  const ItemLink = ({ n, sub }) => (
    <Link href={n.href} onClick={() => setOpen(false)}
      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13.5px] font-semibold mb-0.5 ${sub ? "ml-3" : ""} ${isActive(n) ? "bg-brand text-white" : "hover:bg-navy-800"}`}>
      <span className="w-5 text-center opacity-90">{n.icon}</span>{n.label}
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
                  <span className="w-5 text-center opacity-90">{g.icon}</span>
                  <span className="flex-1 text-left">{g.label}</span>
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
          <div className="text-[17px] font-extrabold">{title}</div>
          <div className="ml-auto text-xs text-[#8A93A0]">{new Date().toLocaleDateString("vi-VN")}</div>
        </header>
        <div className="p-5 max-w-[1180px] mx-auto pb-16">{children}</div>
      </main>
    </div>
  );
}
