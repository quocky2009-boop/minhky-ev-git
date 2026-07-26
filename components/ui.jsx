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
import Scanner from "@/components/Scanner";

export function SearchPicker({ items, value, onChange, placeholder = "Gõ để tìm…", getLabel, getKey }) {
  const [q, setQ] = useSt("");
  const [open, setOpen] = useSt(false);
  const ref = useRef(null);
  const sel = items.find((i) => getKey(i) === value);
  const list = useMemo(() => {
    // Khop theo tung tu: moi tu deu phai xuat hien (khong can lien mach).
    // Nho vay "Amio S2 Đỏ" van khop label "VinFast · Amio S2 · Đỏ".
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return items.filter((i) => {
      const lbl = getLabel(i).toLowerCase();
      return terms.every((t) => lbl.includes(t));
    }).slice(0, 40);
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

// ===== Combo tu do: chon tu goi y co san HOAC go gia tri moi =====
// options: danh sach chuoi goi y (vd tat ca ten xe da co). Nguoi dung go
// se loc theo tung tu; van luu duoc gia tri moi neu khong chon goi y nao.
export function ComboFree({ value, onChange, options = [], placeholder = "", allowNew = true }) {
  const [q, setQ] = useSt("");
  const [open, setOpen] = useSt(false);
  const [typing, setTyping] = useSt(false);
  const ref = useRef(null);
  useEff(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setTyping(false); } };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const kw = q.toLowerCase().split(/\s+/).filter(Boolean);
  const uniq = Array.from(new Set(options.filter(Boolean).map((x) => String(x).trim()))).sort((a, b) => a.localeCompare(b, "vi"));
  const hits = uniq.filter((o) => { const l = o.toLowerCase(); return kw.every((t) => l.includes(t)); }).slice(0, 40);
  const daCo = uniq.some((o) => o.toLowerCase() === q.trim().toLowerCase());
  return (
    <div className="relative" ref={ref}>
      <input className="inp" value={typing ? q : (value || "")}
        placeholder={placeholder}
        onFocus={() => { setOpen(true); setTyping(true); setQ(value || ""); }}
        onChange={(e) => { setQ(e.target.value); onChange(e.target.value); setOpen(true); setTyping(true); }} />
      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-64 overflow-y-auto bg-white border border-[#D5DBE3] rounded-xl shadow-xl">
          {allowNew && q.trim() && !daCo && (
            <div className="px-3 py-2 text-sm cursor-pointer hover:bg-[#EEF3FF] text-brand font-bold border-b border-[#F2F4F7]"
              onClick={() => { onChange(q.trim()); setOpen(false); setTyping(false); }}>
              + Dùng giá trị mới: “{q.trim()}”
            </div>
          )}
          {hits.map((o) => (
            <div key={o} className="px-3 py-2 text-sm cursor-pointer hover:bg-[#EEF3FE]"
              onClick={() => { onChange(o); setQ(o); setOpen(false); setTyping(false); }}>
              {o}
            </div>
          ))}
          {hits.length === 0 && !q.trim() && <div className="px-3 py-2 text-sm text-[#8A93A0]">Gõ để tìm hoặc tạo mới…</div>}
          {hits.length === 0 && q.trim() && !allowNew && <div className="px-3 py-2 text-sm text-[#8A93A0]">Không có gợi ý khớp.</div>}
        </div>
      )}
    </div>
  );
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

// ===== Go tim Khach hang (mã / tên / SDT) + tao moi =====
export function CustomerSearch({ customers, value, onPick, onCreate }) {
  const [q, setQ] = useSt("");
  const [open, setOpen] = useSt(false);
  const cur = customers.find((c) => String(c.id) === String(value));
  const kw = q.trim().toLowerCase();
  const hits = kw.length >= 1 ? customers.filter((c) =>
    (c.code + " " + c.name + " " + c.phone).toLowerCase().includes(kw)).slice(0, 12) : [];
  if (cur) {
    return (
      <div className="flex items-center gap-2 border border-[#D5DBE3] rounded-xl px-3 py-2.5 bg-[#F0FDF6]">
        <div className="flex-1 min-w-0"><b>{cur.name}</b> <span className="text-xs text-[#5A6572]">· {cur.code} · {cur.phone}</span></div>
        <button className="text-[#8A93A0] hover:text-danger text-sm" onClick={() => { onPick(null); setQ(""); }}>Đổi khách</button>
      </div>
    );
  }
  return (
    <div className="relative">
      <input className="inp" placeholder="Gõ mã KH / tên / SĐT để tìm khách cũ…" value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
      {open && kw.length >= 1 && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-[#D5DBE3] rounded-xl shadow-lg overflow-hidden max-h-64 overflow-y-auto">
          {hits.map((c) => (
            <button key={c.id} className="w-full flex items-center gap-2 px-3 py-2.5 text-left border-b border-[#F2F4F7] last:border-0 hover:bg-[#F0FDF6]"
              onClick={() => { onPick(c); setOpen(false); setQ(""); }}>
              <b className="text-[13px]">{c.name}</b>
              <span className="text-xs text-[#5A6572]">{c.code} · {c.phone}</span>
              {c.status === "Đã mua" && <Badge tone="green">Đã mua</Badge>}
            </button>
          ))}
          <button className="w-full text-left px-3 py-2.5 hover:bg-[#EEF3FF] text-brand font-bold text-[13px]"
            onClick={() => { onCreate(q.trim()); setOpen(false); setQ(""); }}>+ Tạo khách mới{q.trim() ? ` "${q.trim()}"` : ""}</button>
        </div>
      )}
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

// ===== CHON NHIEU HANG (dung chung cho moi danh sach) =====
// Su dung:
//   const sel = useSelection();
//   <ThCheck sel={sel} rows={cacHangDangHienThi} idOf={(r)=>r.id} />   // header
//   <TdCheck sel={sel} id={r.id} />                                    // moi hang
//   sel.selected -> Set cac id; sel.count; sel.clear(); sel.ids()
export function useSelection() {
  const [selected, setSelected] = useSt(() => new Set());
  const toggle = (id) => setSelected((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const toggleAll = (ids) => setSelected((prev) => {
    const all = ids.every((id) => prev.has(id));
    if (all) { const s = new Set(prev); ids.forEach((id) => s.delete(id)); return s; }
    return new Set([...prev, ...ids]);
  });
  const clear = () => setSelected(new Set());
  const has = (id) => selected.has(id);
  return { selected, has, toggle, toggleAll, clear, count: selected.size, ids: () => [...selected] };
}

export function ThCheck({ sel, rows, idOf }) {
  const ids = rows.map(idOf);
  const allChecked = ids.length > 0 && ids.every((id) => sel.has(id));
  const someChecked = ids.some((id) => sel.has(id));
  return (
    <th className="th w-9 text-center">
      <input type="checkbox" className="cursor-pointer w-4 h-4 align-middle" checked={allChecked}
        ref={(el) => { if (el) el.indeterminate = !allChecked && someChecked; }}
        onChange={() => sel.toggleAll(ids)} title="Chọn tất cả trên trang" />
    </th>
  );
}

export function TdCheck({ sel, id }) {
  return (
    <td data-label="" className="td text-center" onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" className="cursor-pointer w-4 h-4 align-middle" checked={sel.has(id)} onChange={() => sel.toggle(id)} />
    </td>
  );
}

// Thanh cong cu hien khi da chon it nhat 1 hang. children la cac nut thao tac.
export function SelectionBar({ sel, children }) {
  if (sel.count === 0) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap mb-2 px-3 py-2 rounded-xl bg-[#EAF2FF] border border-[#CFE0FB]">
      <span className="text-[13px] font-bold text-brand">Đã chọn {sel.count}</span>
      <div className="flex gap-1.5 flex-wrap">{children}</div>
      <button className="btn-ghost !text-xs ml-auto" onClick={sel.clear}>Bỏ chọn</button>
    </div>
  );
}

// ===== O NHAP TIEN: tu them dau cham phan cach khi go =====
// Dung nhu <input>: value la SO (number/string so), onChange tra ve SO
export function MoneyInput({ value, onChange, className = "", placeholder = "", ...rest }) {
  const fmt = (v) => {
    const n = String(v ?? "").replace(/\D/g, "");
    return n ? Number(n).toLocaleString("vi-VN") : "";
  };
  const [txt, setTxt] = useSt(fmt(value));
  useEff(() => {
    const cur = String(txt).replace(/\D/g, "");
    if (String(value ?? "") !== cur) setTxt(fmt(value));
  }, [value]);
  return (
    <div className="relative">
      <input
        type="text" inputMode="numeric" placeholder={placeholder}
        className={`inp !pr-8 ${className}`}
        value={txt}
        onChange={(e) => {
          const raw = e.target.value.replace(/\D/g, "");
          setTxt(raw ? Number(raw).toLocaleString("vi-VN") : "");
          onChange?.(raw ? Number(raw) : "");
        }}
        {...rest}
      />
      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-[#8A93A0] pointer-events-none">đ</span>
    </div>
  );
}

// ===== O TIM SO KHUNG: go tim + quet QR =====
export function FrameSearch({ supabase, value, onPick, onlyStatus = null, placeholder = "Gõ số khung hoặc quét…" }) {
  const [q, setQ] = useSt(value || "");
  const [hits, setHits] = useSt([]);
  const [open, setOpen] = useSt(false);
  const [scan, setScan] = useSt(false);

  useEff(() => { setQ(value || ""); }, [value]);

  const tim = async (kw) => {
    if (!kw || kw.length < 3) { setHits([]); return; }
    let qy = supabase.from("vehicle_units").select("frame_number,vehicle_id,location_code,status")
      .ilike("frame_number", `%${kw}%`).limit(8);
    if (onlyStatus) qy = qy.in("status", onlyStatus);
    const { data } = await qy;
    setHits(data || []); setOpen(true);
  };

  return (
    <div className="relative">
      <div className="flex gap-1.5">
        <input className="inp font-mono" placeholder={placeholder} value={q}
          onChange={(e) => { const v = e.target.value.toUpperCase(); setQ(v); onPick?.(v, null); tim(v); }}
          onFocus={() => q.length >= 3 && setOpen(true)} />
        <button type="button" className="btn-ghost !px-3 whitespace-nowrap" onClick={() => setScan(true)}>📷 Quét</button>
      </div>
      {open && hits.length > 0 && (
        <div className="absolute z-40 top-full mt-1 left-0 right-0 bg-white rounded-xl border border-[#E3E8EF] shadow-lg max-h-64 overflow-y-auto">
          {hits.map((u) => (
            <button key={u.frame_number} type="button" className="w-full text-left px-3 py-2 hover:bg-[#F3F5F8]"
              onClick={() => { setQ(u.frame_number); onPick?.(u.frame_number, u); setOpen(false); }}>
              <div className="font-mono text-[13px] font-bold">{u.frame_number}</div>
              <div className="text-[11px] text-[#8A93A0]">{u.vehicle_id} · {u.location_code} · {
                { TON_KHO: "Tồn kho", GIU_CHO: "Đang giữ chỗ", DA_BAN: "Đã bán", DANG_CHUYEN: "Đang chuyển" }[u.status] || u.status}</div>
            </button>
          ))}
        </div>
      )}
      {scan && (
        <Scanner
          onAdd={(code) => {
            const v = String(code).toUpperCase().trim();
            setQ(v); onPick?.(v, null); tim(v); setScan(false);
          }}
          onClose={() => setScan(false)}
        />
      )}
    </div>
  );
}
