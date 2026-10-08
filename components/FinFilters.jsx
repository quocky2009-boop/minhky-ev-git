"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";

const iso = (d) => d.toLocaleDateString("sv-SE");
export const num = (v) => Number(String(v ?? "").replace(/\D/g, "")) || 0;

// Khoang so tien: chi 'tu' => >= tu; chi 'den' => <= den; ca hai => trong khoang
export const trongKhoang = (v, min, max) => {
  const a = String(min ?? "").trim() ? num(min) : null, b = String(max ?? "").trim() ? num(max) : null;
  const x = Number(v) || 0;
  return (a === null || x >= a) && (b === null || x <= b);
};

// Loc ngay nhanh: Hom nay / Hom qua / Tuan nay / Thang nay / Thang truoc
export function QuickDates({ from, to, setFrom, setTo, onChange }) {
  const set = (a, b) => { setFrom(a); setTo(b); onChange && onChange(); };
  const now = new Date();
  const d0 = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const t = d0(now);
  const monday = new Date(t); monday.setDate(t.getDate() - ((t.getDay() + 6) % 7));
  const presets = [
    ["Hôm nay", iso(t), iso(t)],
    ["Hôm qua", iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1)), iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1))],
    ["Tuần này", iso(monday), iso(t)],
    ["Tháng này", iso(new Date(t.getFullYear(), t.getMonth(), 1)), iso(t)],
    ["Tháng trước", iso(new Date(t.getFullYear(), t.getMonth() - 1, 1)), iso(new Date(t.getFullYear(), t.getMonth(), 0))],
  ];
  return (
    <div className="flex gap-1 flex-wrap">
      {presets.map(([l, a, b]) => (
        <button key={l} type="button" onClick={() => set(a, b)}
          className={`px-2 py-1 rounded-md text-[11.5px] font-semibold border ${from === a && to === b ? "bg-brand text-white border-brand" : "bg-white border-[#E3E8EF] text-[#5A6572] hover:bg-[#F3F6FB]"}`}>{l}</button>
      ))}
    </div>
  );
}

// Tim theo so tien (doi chieu sao ke): tu ... den
export function AmountFilter({ min, max, setMin, setMax, onChange }) {
  const fmt = (v) => { const n = num(v); return String(v ?? "").trim() === "" ? "" : n.toLocaleString("vi-VN"); };
  return (
    <div className="flex items-center gap-1">
      <input className="inp !w-32 !py-1.5 !text-xs" inputMode="numeric" placeholder="Số tiền từ" value={fmt(min)} onChange={(e) => { setMin(e.target.value.replace(/\D/g, "")); onChange && onChange(); }} />
      <span className="text-xs text-[#8A93A0]">–</span>
      <input className="inp !w-32 !py-1.5 !text-xs" inputMode="numeric" placeholder="đến" value={fmt(max)} onChange={(e) => { setMax(e.target.value.replace(/\D/g, "")); onChange && onChange(); }} />
    </div>
  );
}

// Bo loc da luu + tu nho bo loc lan truoc (khong luu khoang ngay). state: object cac gia tri loc; apply(obj): dat lai.
export function SavedFilters({ k, state, apply }) {
  const key = `fin_loc:${k}`;
  const [list, setList] = useState([]);
  const [pick, setPick] = useState("");
  const ready = useRef(false);
  const rd = (s) => { try { return JSON.parse(localStorage.getItem(s) || "null"); } catch { return null; } };
  const wr = (s, v) => { try { localStorage.setItem(s, JSON.stringify(v)); } catch {} };
  useEffect(() => {
    setList(rd(key + ":list") || []);
    const last = rd(key + ":last");
    if (last) apply(last);
    ready.current = true;
    // eslint-disable-next-line
  }, []);
  const sj = JSON.stringify(state);
  useEffect(() => { if (ready.current) wr(key + ":last", state); /* eslint-disable-next-line */ }, [sj]);
  const luu = () => {
    const name = prompt("Đặt tên cho bộ lọc này (VD: Quỹ ngân hàng Hàm Yên):");
    if (!name || !name.trim()) return;
    const n = [...list.filter((x) => x.name !== name.trim()), { name: name.trim(), state }];
    setList(n); wr(key + ":list", n); setPick(name.trim());
  };
  const xoa = () => { if (!pick) return; const n = list.filter((x) => x.name !== pick); setList(n); wr(key + ":list", n); setPick(""); };
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <select className="inp !w-auto !py-1.5 !text-xs" value={pick} onChange={(e) => { setPick(e.target.value); const f = list.find((x) => x.name === e.target.value); if (f) apply(f.state); }}>
        <option value="">⭐ Bộ lọc đã lưu…</option>
        {list.map((x) => <option key={x.name}>{x.name}</option>)}
      </select>
      <button type="button" className="btn-ghost !text-xs !py-1" onClick={luu}>💾 Lưu bộ lọc</button>
      {pick && <button type="button" className="btn-ghost !text-xs !py-1 hover:!text-danger" onClick={xoa}>🗑</button>}
    </div>
  );
}

// Link chung tu goc -> don ban / phieu dich vu
export function RefLink({ code }) {
  if (!code) return <span>—</span>;
  const c = String(code);
  const m = c.match(/^(BH-\d+-\d+)/i);
  const href = m ? `/don-ban?q=${encodeURIComponent(m[1])}` : /^(PTDV|DV)/i.test(c) ? `/dich-vu?q=${encodeURIComponent(c)}` : null;
  return href ? <Link href={href} className="text-brand hover:underline">{c}</Link> : <span>{c}</span>;
}

// Dong tong theo bo loc
export function TongLoc({ children }) {
  return <div className="flex gap-x-4 gap-y-1 flex-wrap items-center text-[12.5px] px-3 py-2 mb-2 rounded-lg bg-[#F3F6FB] border border-[#E3E8EF]">{children}</div>;
}
