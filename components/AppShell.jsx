"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { NAV, NAV_GROUPS, ROLES, TAB_GROUPS } from "@/lib/const";
import GlobalSearch from "@/components/GlobalSearch";
import GridEnhancer from "@/components/GridEnhancer";
import { coQuyenExcel, RE_NUT_XUAT, RE_NUT_NHAP } from "@/lib/excelPerm";

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
        supabase.from("repair_orders").select("id", { count: "exact", head: true }).in("status", ["BAO_GIA", "PHAT_HANH"]),
        supabase.from("deposits").select("id", { count: "exact", head: true }).eq("status", "DANG_GIU"),
        supabase.from("v_task_list").select("id", { count: "exact", head: true })
          .eq("assignee_id", profile.id)
          .not("status", "in", "(completed,cancelled,failed)"),
        supabase.from("v_task_list").select("id", { count: "exact", head: true }).eq("status", "pending_review"),
        supabase.from("co_hoi").select("id", { count: "exact", head: true })
          .eq("next_call_date", new Date().toLocaleDateString("sv-SE"))
          .not("stage", "in", "(Đã bán,Mất khách)"),
      ];
      const [don, dc, dv, coc, task, taskDuyet, coHoi] = await Promise.all(q.map((x) => x.then((r) => r.count || 0).catch(() => 0)));
      if (!huy) setBadges({ "/don-ban": don, "/dieu-chinh": dc, "/dich-vu/lenh-sua-chua": dv, "/dat-coc": coc,
        "/cong-viec": task, "/cong-viec/doi-nhom": taskDuyet, "/co-hoi": coHoi });
    };
    dem();
    const t = setInterval(dem, 60000);
    return () => { huy = true; clearInterval(t); };
  }, [pathname]);

  const signOut = async () => { await supabase.auth.signOut(); window.location.href = "/login"; };

  // Nap quyen theo vai tro de menu co the hien theo role_perms (ngoai hardcode roles)
  const [perms, setPerms] = useState({});
  useEffect(() => {
    let huy = false;
    (async () => {
      const { data } = await supabase.from("role_perms").select("perm,allowed").eq("role", profile.role);
      if (huy) return;
      const m = {}; (data || []).forEach((x) => { m[x.perm] = x.allowed; }); setPerms(m);
      window.__mkQuyen = { role: profile.role, perms: m };
      setQuyenOk((n) => n + 1);
    })();
    return () => { huy = true; };
  }, [profile.role]);
  // THE GON tren dien thoai: bang "tbl-card" chua khai bao thi tu dien nhan cot (lay tu tieu de bang),
  // tu chon cot dau lam dong tieu de va cot tien dam lam so noi bat. Cot da ghi data-label / data-m thi giu nguyen.
  useEffect(() => {
    const root = document.getElementById("mk-noi-dung");
    if (!root) return;
    let cho = null;
    const quet = () => {
      cho = null;
      root.querySelectorAll("table.tbl-card").forEach((tb) => {
        const ths = [...tb.querySelectorAll("thead tr:last-child th")];
        if (!ths.length || ths.some((th) => th.colSpan > 1)) return;
        const nhan = ths.map((th) => (th.textContent || "").replace(/[▲▼⇅]/g, "").trim());
        tb.querySelectorAll("tbody > tr:not([data-mk])").forEach((tr) => {
          const tds = [...tr.children];
          if (tds.length !== nhan.length || tds.some((td) => td.colSpan > 1)) return;
          tr.setAttribute("data-mk", "1");
          const coSan = tds.some((td) => td.hasAttribute("data-m"));
          tds.forEach((td, i) => { if (!td.hasAttribute("data-label") && nhan[i]) td.setAttribute("data-label", nhan[i]); });
          if (coSan) return;
          let coTitle = false, coEnd = false;
          tds.forEach((td, i) => {
            const l = nhan[i];
            if (/^(#|stt|tt)$/i.test(l)) return td.setAttribute("data-m", "hide");
            if (!l || td.getAttribute("data-label") === "") return;
            if (!coTitle) { coTitle = true; return td.setAttribute("data-m", "title"); }
            if (!coEnd && /(^|\s)(text-right|rt)(\s|$)/.test(td.className) && /font-(bold|extrabold)/.test(td.className)) { coEnd = true; td.setAttribute("data-m", "end"); }
          });
        });
      });
    };
    quet();
    const ob = new MutationObserver(() => { if (!cho) cho = setTimeout(quet, 80); });
    ob.observe(root, { childList: true, subtree: true });
    return () => { ob.disconnect(); if (cho) clearTimeout(cho); };
  }, [pathname]);
  // An nut xuat / nhap Excel khi vai tro khong duoc cap quyen (lop chan chinh nam o lib/format.js)
  const [quyenOk, setQuyenOk] = useState(0);
  useEffect(() => {
    if (!quyenOk || profile.role === "CEO") return;
    const anXuat = !coQuyenExcel("xuat", pathname), anNhap = !coQuyenExcel("nhap");
    const root = document.getElementById("mk-noi-dung");
    if (!root) return;
    const quet = () => {
      root.querySelectorAll("button, a").forEach((el) => {
        const t = (el.textContent || "").trim();
        if (!t || t.length > 60) return;
        const laMau = /mẫu/i.test(t);
        const an = (anXuat && !laMau && RE_NUT_XUAT.test(t)) || (anNhap && (RE_NUT_NHAP.test(t) || (laMau && /Tải file mẫu/i.test(t))));
        if (an && el.style.display !== "none") { el.style.display = "none"; el.setAttribute("data-an-excel", "1"); }
        else if (!an && el.getAttribute("data-an-excel")) { el.style.display = ""; el.removeAttribute("data-an-excel"); }
      });
    };
    quet();
    if (!anXuat && !anNhap) return;
    const ob = new MutationObserver(quet);
    ob.observe(root, { childList: true, subtree: true, characterData: true });
    return () => ob.disconnect();
  }, [quyenOk, pathname]);
  // Item hien khi: role nam trong roles HOAC (co perm gan va user duoc cap perm do)
  const canSee = (n) => {
    // CEO luon thay tat ca
    if (profile.role === "CEO") return true;
    // Neu co perm key: show neu role_perms cho phep (bat ke roles)
    if (n.perm && perms[n.perm]) return true;
    // Fallback theo roles co dinh
    return n.roles.includes(profile.role);
  };

  // Gop cac trang cung tabGroup thanh 1 muc menu (tro toi tab dau tien user duoc xem)
  const gopTab = (items) => {
    const out = []; const seen = {};
    items.forEach((n) => {
      if (!n.tabGroup) return out.push(n);
      if (seen[n.tabGroup]) return seen[n.tabGroup].tabs.push(n);
      const e = { ...n, label: TAB_GROUPS[n.tabGroup] || n.label, tabs: [n] };
      seen[n.tabGroup] = e; out.push(e);
    });
    return out;
  };
  const badgeOf = (n) => (n.tabs || [n]).reduce((a, x) => a + (badges[base(x.href)] || 0), 0);
  const activeOf = (n) => (n.tabs ? n.tabs.some(isActive) : isActive(n));
  // Tab cua trang dang mo (neu trang thuoc 1 nhom tab)
  const curNav = NAV.find((n) => n.tabGroup && pathname.startsWith(base(n.href)));
  const curTabs = curNav ? NAV.filter((n) => n.tabGroup === curNav.tabGroup && canSee(n)) : [];

  // Tim nhanh chuc nang + ghim "Hay dung" (luu theo tung nguoi tren may nay)
  const [mq, setMq] = useState("");
  const pinKey = `mk_menu_pins_${profile.id}`;
  const [pins, setPins] = useState([]);
  useEffect(() => { try { setPins(JSON.parse(localStorage.getItem(pinKey) || "[]")); } catch { setPins([]); } }, [pinKey]);
  const togglePin = (href) => setPins((prev) => {
    const next = prev.includes(href) ? prev.filter((x) => x !== href) : [...prev, href].slice(-8);
    try { localStorage.setItem(pinKey, JSON.stringify(next)); } catch {}
    return next;
  });
  const khongDau = (x) => String(x || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
  const visibleNav = NAV.filter(canSee);
  const kq = mq.trim() ? visibleNav.filter((n) => khongDau(`${n.label} ${TAB_GROUPS[n.tabGroup] || ""} ${NAV_GROUPS.find((g) => g.items.includes(n))?.label || ""}`).includes(khongDau(mq.trim()))) : [];
  const pinned = pins.map((h) => visibleNav.find((n) => n.href === h)).filter(Boolean);

  const ItemLink = ({ n, sub, pinable = true }) => (
    <div className={`group flex items-center rounded-lg mb-0.5 ${sub ? "ml-3" : ""} ${activeOf(n) ? "bg-brand text-white" : "hover:bg-navy-800"}`}>
      <Link href={n.href} onClick={() => { setOpen(false); setMq(""); }} className="flex-1 min-w-0 flex items-center gap-2.5 px-3 py-2.5 text-[13.5px] font-semibold">
        <span className="flex-1">{n.label}</span>
        {badgeOf(n) > 0 && (
          <span className={`min-w-[20px] h-5 px-1.5 rounded-full text-[10.5px] font-extrabold flex items-center justify-center ${activeOf(n) ? "bg-white text-brand" : "bg-danger text-white"}`}>
            {badgeOf(n) > 99 ? "99+" : badgeOf(n)}
          </span>
        )}
      </Link>
      {pinable && (
        <button type="button" onClick={() => togglePin(n.href)} title={pins.includes(n.href) ? "Bỏ ghim khỏi Hay dùng" : "Ghim vào Hay dùng"}
          className={`px-2 py-2.5 text-[13px] ${pins.includes(n.href) ? "text-[#FACC15]" : "opacity-0 group-hover:opacity-60 focus:opacity-100 md:opacity-0 max-md:opacity-40"}`}>{pins.includes(n.href) ? "★" : "☆"}</button>
      )}
    </div>
  );

  return (
    <div className="flex min-h-screen">
      <GridEnhancer userId={profile.id} />
      {open && <div className="fixed inset-0 bg-black/40 z-40 md:hidden" onClick={() => setOpen(false)} />}
      <aside className={`w-[232px] bg-navy-900 text-[#C8D3E0] flex flex-col shrink-0 fixed md:static z-50 h-screen md:h-auto transition-transform ${open ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}>
        <div className="px-4 py-5 border-b border-navy-700">
          <div className="text-lg font-extrabold text-white tracking-wide">MINH KỲ <span className="text-[#4ADE80]">EV</span></div>
          <div className="text-[11px] text-[#7E8FA3] mt-0.5">Quản lý hệ thống xe điện</div>
        </div>
        <div className="px-2 pt-2">
          <div className="relative">
            <input value={mq} onChange={(e) => setMq(e.target.value)} placeholder="Tìm chức năng…" autoComplete="off"
              className="w-full rounded-lg bg-navy-800 border border-navy-700 text-[13px] text-white placeholder-[#7E8FA3] pl-3 pr-7 py-2 outline-none focus:border-brand" />
            {mq && <button className="absolute right-2 top-1/2 -translate-y-1/2 text-[#7E8FA3] hover:text-white" onClick={() => setMq("")}>✕</button>}
          </div>
        </div>
        <nav className="flex-1 p-2 overflow-y-auto">
          {mq.trim() ? (
            <div>
              <div className="px-3 py-1.5 text-[11px] font-extrabold tracking-wide text-[#8FA0B5]">KẾT QUẢ ({kq.length})</div>
              {kq.map((n) => <ItemLink key={n.href} n={n} />)}
              {kq.length === 0 && <div className="px-3 py-2 text-[12.5px] text-[#7E8FA3]">Không thấy chức năng nào khớp “{mq}”.</div>}
            </div>
          ) : (<>
          {pinned.length > 0 && (
            <div className="mb-1.5 pb-1.5 border-b border-navy-700">
              <div className="px-3 py-1.5 text-[11px] font-extrabold tracking-wide text-[#FACC15]">★ HAY DÙNG</div>
              {pinned.map((n) => <ItemLink key={"pin" + n.href} n={n} />)}
            </div>)}
          {NAV_GROUPS.map((g, gi) => {
            const items = gopTab(g.items.filter(canSee));
            if (items.length === 0) return null;
            if (!g.label) return items.map((n) => <ItemLink key={n.href} n={n} />);
            const opened = openGroups.has(g.label);
            const hasActive = items.some(activeOf);
            return (
              <div key={g.label} className="mb-0.5">
                <button onClick={() => toggle(g.label)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[12px] font-extrabold tracking-wide ${hasActive && !opened ? "text-white bg-navy-800" : "text-[#8FA0B5]"} hover:bg-navy-800 hover:text-white`}>
                  <span className="flex-1 text-left">{g.label}</span>
                  {!opened && items.reduce((a, n) => a + badgeOf(n), 0) > 0 && (
                    <span className="min-w-[20px] h-5 px-1.5 rounded-full text-[10.5px] font-extrabold flex items-center justify-center bg-danger text-white">
                      {items.reduce((a, n) => a + badgeOf(n), 0)}
                    </span>
                  )}
                  <span className="text-[10px]">{opened ? "▾" : "▸"}</span>
                </button>
                {opened && <div className="mt-0.5">{items.map((n) => <ItemLink key={n.href} n={n} sub />)}</div>}
              </div>
            );
          })}
          </>)}
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
        <div id="mk-noi-dung" className="p-5 pb-24 md:pb-16">
          {curTabs.length > 1 && (
            <div className="flex gap-1 border-b border-[#E3E8EF] mb-4 overflow-x-auto">
              {curTabs.map((n) => (
                <Link key={n.href} href={n.href} className={`px-3.5 py-2 text-[13.5px] font-semibold border-b-2 -mb-px whitespace-nowrap flex items-center gap-1.5 ${isActive(n) ? "border-brand text-brand" : "border-transparent text-[#5A6572] hover:text-brand"}`}>
                  {n.label}
                  {badges[base(n.href)] > 0 && <span className="min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-extrabold flex items-center justify-center bg-danger text-white">{badges[base(n.href)]}</span>}
                </Link>))}
            </div>)}
          {children}
        </div>
      </main>
      {/* Thanh nut nhanh duoi day — chi hien tren dien thoai */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-[#E3E8EF] flex justify-around px-1 pt-1 pb-[max(4px,env(safe-area-inset-bottom))] print:hidden">
        {(profile.role === "TECHNICIAN"
          ? [["/dashboard", "🏠", "Tổng quan"], ["/dich-vu/lenh-sua-chua", "🛠", "Sửa chữa"], ["/phu-tung", "📦", "Phụ tùng"], ["/cong-viec", "✅", "Việc"]]
          : [["/dashboard", "🏠", "Tổng quan"], ["/don-ban", "🧾", "Đơn bán"], ["/tra-cuu", "🔎", "Tồn xe"], ["/cong-viec", "✅", "Việc"]]
        ).filter(([h]) => { const n = NAV.find((x) => x.href === h); return !n || canSee(n); }).map(([h, ic, lb]) => {
          const on = h === "/cong-viec" ? pathname === h : pathname.startsWith(h);
          const b = h === "/dich-vu/lenh-sua-chua" || h === "/cong-viec" || h === "/don-ban" ? badges[h] : 0;
          return (
            <Link key={h} href={h} className={`relative flex-1 flex flex-col items-center gap-0.5 py-1 rounded-lg text-[10.5px] font-semibold ${on ? "text-brand" : "text-[#5A6572]"}`}>
              <span className="text-[18px] leading-none">{ic}</span>{lb}
              {b > 0 && <span className="absolute top-0 right-[22%] min-w-[16px] h-4 px-1 rounded-full text-[9.5px] font-extrabold flex items-center justify-center bg-danger text-white">{b > 99 ? "99+" : b}</span>}
            </Link>);
        })}
        <button className="flex-1 flex flex-col items-center gap-0.5 py-1 rounded-lg text-[10.5px] font-semibold text-[#5A6572]" onClick={() => setOpen(true)}>
          <span className="text-[18px] leading-none">☰</span>Menu
        </button>
      </nav>
    </div>
  );
}
