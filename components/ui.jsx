"use client";

export function Badge({ tone = "gray", children }) {
  const tones = {
    green: "bg-[#E5F6EE] text-[#0E7A4A]", amber: "bg-[#FDF1DF] text-[#A25F00]",
    red: "bg-[#FDE8EA] text-[#B01E2C]", blue: "bg-[#E7EFFD] text-[#1D4FB8]",
    gray: "bg-[#EEF1F4] text-[#5A6572]", purple: "bg-[#F1EAFB] text-[#6B39B8]",
  };
  return <span className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${tones[tone]}`}>{children}</span>;
}

export function stockBadge(qty, min) {
  if (qty <= 0) return <Badge tone="red">Hết hàng</Badge>;
  if (qty <= min) return <Badge tone="amber">Sắp hết</Badge>;
  return <Badge tone="green">Còn hàng</Badge>;
}

export function StockBattery({ qty, min }) {
  const segs = 5, cap = Math.max((min || 2) * 3, 10);
  const filled = qty <= 0 ? 0 : Math.max(1, Math.min(segs, Math.ceil((qty / cap) * segs)));
  const color = qty <= 0 ? "#DC2F3E" : qty <= min ? "#D97E00" : "#129D61";
  return (
    <span className="inline-flex items-center gap-[2px]" title={`Tồn ${qty}`}>
      {Array.from({ length: segs }).map((_, i) => (
        <span key={i} className="inline-block w-[5px] h-3 rounded-[1.5px]" style={{ background: i < filled ? color : "#E3E7EC" }} />
      ))}
    </span>
  );
}

export function Field({ label, required, hint, children }) {
  return (
    <div className="mb-3">
      <label className="lbl">{label}{required && <span className="text-danger"> *</span>}</label>
      {children}
      {hint && <div className="text-xs mt-1 text-[#5A6572]">{hint}</div>}
    </div>
  );
}

export function KPI({ label, value, sub, tone }) {
  const colors = { green: "text-[#0E7A4A]", red: "text-[#B01E2C]", amber: "text-[#A25F00]", blue: "text-brand", dark: "text-navy-800" };
  return (
    <div className="card flex-1 min-w-[140px] !p-4">
      <div className="text-xs font-semibold text-[#5A6572]">{label}</div>
      <div className={`text-2xl font-extrabold tabular-nums mt-1 ${colors[tone] || "text-navy-800"}`}>{value}</div>
      {sub && <div className="text-xs text-[#8A93A0]">{sub}</div>}
    </div>
  );
}

export function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] px-5 py-3 rounded-xl text-sm font-semibold text-white shadow-2xl max-w-[90vw] ${toast.tone === "err" ? "bg-[#B01E2C]" : "bg-navy-900"}`}>
      {toast.msg}
    </div>
  );
}

export function VehiclePicker({ vehicles, value, onChange }) {
  return (
    <select className="inp" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— Chọn xe từ danh mục —</option>
      {vehicles.map((v) => <option key={v.id} value={v.id}>{v.brand} · {v.name} · {v.color}</option>)}
    </select>
  );
}

export function LocPicker({ locations, value, onChange, exclude }) {
  return (
    <select className="inp" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— Chọn kho / cửa hàng —</option>
      {locations.filter((l) => l.code !== exclude && l.status === "Hoạt động").map((l) => (
        <option key={l.code} value={l.code}>[{l.region}] {l.name}</option>
      ))}
    </select>
  );
}

// ===== V2: Combobox tim kiem xe (thay dropdown dai) =====
import { useMemo, useRef, useEffect as useEff, useState as useSt } from "react";

export function SearchPicker({ items, value, onChange, placeholder = "Gõ để tìm…", getLabel, getKey }) {
  const [q, setQ] = useSt("");
  const [open, setOpen] = useSt(false);
  const ref = useRef(null);
  const sel = items.find((i) => getKey(i) === value);
  const list = useMemo(() => {
    const s = q.toLowerCase();
    return items.filter((i) => getLabel(i).toLowerCase().includes(s)).slice(0, 40);
  }, [q, items]);
  useEff(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <input className="inp" value={open ? q : (sel ? getLabel(sel) : "")}
        placeholder={placeholder}
        onFocus={() => { setOpen(true); setQ(""); }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} />
      {value && !open && (
        <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8A93A0] hover:text-danger text-sm"
          onClick={() => { onChange(""); setQ(""); }}>✕</button>
      )}
      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-64 overflow-y-auto bg-white border border-[#D5DBE3] rounded-xl shadow-xl">
          {list.map((i) => (
            <div key={getKey(i)} className="px-3 py-2 text-sm cursor-pointer hover:bg-[#EEF3FE]"
              onClick={() => { onChange(getKey(i)); setOpen(false); setQ(""); }}>
              {getLabel(i)}
            </div>
          ))}
          {list.length === 0 && <div className="px-3 py-2 text-sm text-[#8A93A0]">Không tìm thấy — thử từ khóa khác</div>}
        </div>
      )}
    </div>
  );
}

export function VehicleSearch({ vehicles, value, onChange }) {
  return <SearchPicker items={vehicles} value={value} onChange={onChange}
    placeholder="Gõ tên xe / màu / mã để tìm…"
    getKey={(v) => v.id}
    getLabel={(v) => `${v.brand} · ${v.name} · ${v.color}`} />;
}

// ===== V2: Chon nhieu so khung (co tim kiem) =====
export function FramePicker({ units, selected, onToggle, emptyText = "Kho này chưa có xe sẵn sàng" }) {
  const [q, setQ] = useSt("");
  const list = units.filter((u) => u.frame_number.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="border border-[#D5DBE3] rounded-xl overflow-hidden">
      <input className="w-full px-3 py-2 text-sm border-b border-[#E6EAEF] focus:outline-none" placeholder="Tìm số khung…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="max-h-52 overflow-y-auto">
        {list.map((u) => (
          <label key={u.frame_number} className="flex items-center gap-2.5 px-3 py-2 text-sm border-b border-[#F2F4F7] last:border-0 cursor-pointer hover:bg-[#F8FAFC]">
            <input type="checkbox" checked={selected.includes(u.frame_number)} onChange={() => onToggle(u.frame_number)} />
            <span className="font-semibold">{u.frame_number}</span>
            {u.is_placeholder && <Badge tone="amber">SK tạm</Badge>}
            <span className="ml-auto text-[11px] text-[#8A93A0]">nhập {new Date(u.imported_at).toLocaleDateString("vi-VN")}</span>
          </label>
        ))}
        {list.length === 0 && <div className="px-3 py-3 text-sm text-[#8A93A0]">{emptyText}</div>}
      </div>
      <div className="px-3 py-1.5 text-[11px] bg-[#F8FAFC] text-[#5A6572]">Đã chọn: <b>{selected.length}</b> xe</div>
    </div>
  );
}

// ===== V3: Go tim Kho/Cua hang (thay dropdown) =====
export function LocSearch({ locations, value, onChange, exclude, placeholder = "Gõ để tìm kho / cửa hàng…" }) {
  const items = locations.filter((l) => l.code !== exclude && l.status === "Hoạt động");
  return <SearchPicker items={items} value={value} onChange={onChange} placeholder={placeholder}
    getKey={(l) => l.code} getLabel={(l) => `[${l.region}] ${l.name}`} />;
}

// ===== V3: Phan trang dung chung =====
export function pageClamp(page, total, ps) {
  return Math.min(Math.max(1, page), Math.max(1, Math.ceil(total / ps)));
}
export function pageSlice(arr, page, ps) {
  const cur = pageClamp(page, arr.length, ps);
  return arr.slice((cur - 1) * ps, cur * ps);
}
export function Pager({ total, page, setPage, pageSize, setPageSize }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const cur = pageClamp(page, total, pageSize);
  if (total === 0) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap mt-3 text-[13px]">
      <span className="text-[#5A6572]">Hiển thị</span>
      <select className="inp !w-auto !py-1 !text-xs" value={pageSize}
        onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
        {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      <span className="text-[#5A6572]">dòng/trang · tổng <b>{total}</b> dòng</span>
      <div className="ml-auto flex items-center gap-1">
        <button className="btn-ghost !px-2.5 !py-1 !text-xs" disabled={cur <= 1} onClick={() => setPage(1)}>«</button>
        <button className="btn-ghost !px-2.5 !py-1 !text-xs" disabled={cur <= 1} onClick={() => setPage(cur - 1)}>‹ Trước</button>
        <span className="px-2 font-bold tabular-nums">{cur}/{pages}</span>
        <button className="btn-ghost !px-2.5 !py-1 !text-xs" disabled={cur >= pages} onClick={() => setPage(cur + 1)}>Sau ›</button>
        <button className="btn-ghost !px-2.5 !py-1 !text-xs" disabled={cur >= pages} onClick={() => setPage(pages)}>»</button>
      </div>
    </div>
  );
}


// ===== SORT THEO COT (dung chung cho cac bang) =====
export function useSortable() {
  const [sortKey, setSortKey] = useSt("");
  const [sortDir, setSortDir] = useSt("asc");
  const toggle = (k) => {
    if (sortKey !== k) { setSortKey(k); setSortDir("asc"); }
    else if (sortDir === "asc") setSortDir("desc");
    else { setSortKey(""); setSortDir("asc"); }
  };
  const sortFn = (arr, getters) => {
    if (!sortKey || !getters[sortKey]) return arr;
    const g = getters[sortKey];
    return [...arr].sort((a, b) => {
      const x = g(a), y = g(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "vi", { numeric: true });
      return sortDir === "desc" ? -c : c;
    });
  };
  return { sortKey, sortDir, toggle, sortFn };
}

export function Th({ label, k, sort, className = "" }) {
  const active = sort.sortKey === k;
  return (
    <th className={`th cursor-pointer select-none whitespace-nowrap ${active ? "text-brand" : ""} ${className}`} title="Bấm để sắp xếp" onClick={() => sort.toggle(k)}>
      {label} <span className={`text-[9px] ${active ? "" : "text-[#C6CDD6]"}`}>{active ? (sort.sortDir === "asc" ? "▲" : "▼") : "⇅"}</span>
    </th>
  );
}
