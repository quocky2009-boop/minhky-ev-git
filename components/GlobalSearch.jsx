"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Tim kiem toan cuc: so khung / SDT / ten khach / ma don / ma phieu DV / bien so
export default function GlobalSearch() {
  const supabase = createClient();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState({ xe: [], khach: [], don: [], dv: [] });
  const boxRef = useRef(null);
  const timer = useRef(null);

  // Ctrl+K / Cmd+K de focus
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        boxRef.current?.querySelector("input")?.focus();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onClick = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const search = async (kw) => {
    const s = kw.trim();
    if (s.length < 2) { setRes({ xe: [], khach: [], don: [], dv: [] }); return; }
    setBusy(true);
    const like = `%${s}%`;
    const digits = s.replace(/\D/g, "");
    const [xe, khach, don, dv] = await Promise.all([
      supabase.from("vehicle_units").select("frame_number,vehicle_id,location_code,status").ilike("frame_number", like).limit(6),
      supabase.from("customers").select("id,code,name,phone,status")
        .or(digits.length >= 3 ? `phone.ilike.%${digits}%,name.ilike.${like},code.ilike.${like}` : `name.ilike.${like},code.ilike.${like}`).limit(6),
      supabase.from("sales_orders").select("id,code,customer_name,customer_phone,frame_number,sale_date,invoice_status")
        .or(`code.ilike.${like},customer_name.ilike.${like},frame_number.ilike.${like}${digits.length >= 3 ? `,customer_phone.ilike.%${digits}%` : ""}`).limit(6),
      supabase.from("dv_tickets").select("id,code,customer_name,customer_phone,frame_number,status")
        .or(`code.ilike.${like},customer_name.ilike.${like},frame_number.ilike.${like}${digits.length >= 3 ? `,customer_phone.ilike.%${digits}%` : ""}`).limit(5),
    ]);
    setRes({ xe: xe.data || [], khach: khach.data || [], don: don.data || [], dv: dv.data || [] });
    setBusy(false);
  };

  const onChange = (v) => {
    setQ(v); setOpen(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => search(v), 250);
  };

  const go = (href) => { setOpen(false); setQ(""); router.push(href); };
  const tong = res.xe.length + res.khach.length + res.don.length + res.dv.length;

  const Row = ({ icon, title, sub, tone, onClick }) => (
    <button onClick={onClick} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#F3F5F8] text-left">
      <span className="w-6 text-center">{icon}</span>
      <span className="mr-auto min-w-0">
        <span className="block text-[13px] font-semibold truncate">{title}</span>
        <span className="block text-[11px] text-[#8A93A0] truncate">{sub}</span>
      </span>
      {tone && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#EEF1F4] text-[#5A6572] whitespace-nowrap">{tone}</span>}
    </button>
  );

  return (
    <div ref={boxRef} className="relative flex-1 max-w-md">
      <div className="relative">
        <input
          className="inp !py-2 !pl-8 !text-[13px] w-full"
          placeholder="Tìm số khung, SĐT, tên khách, mã đơn…  (Ctrl+K)"
          value={q}
          onFocus={() => setOpen(true)}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8A93A0] text-sm">🔎</span>
        {q && <button className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8A93A0] hover:text-danger text-sm" onClick={() => { setQ(""); setRes({ xe: [], khach: [], don: [], dv: [] }); }}>✕</button>}
      </div>

      {open && q.trim().length >= 2 && (
        <div className="absolute top-full mt-1 left-0 right-0 bg-white rounded-xl border border-[#E3E8EF] shadow-lg max-h-[70vh] overflow-y-auto z-50">
          {busy && <div className="px-3 py-2 text-[12px] text-[#8A93A0]">Đang tìm…</div>}
          {!busy && tong === 0 && <div className="px-3 py-3 text-[13px] text-[#8A93A0]">Không tìm thấy kết quả cho "{q}".</div>}

          {res.xe.length > 0 && (
            <>
              <div className="px-3 pt-2 pb-1 text-[10.5px] font-bold uppercase text-[#8A93A0]">Xe theo số khung</div>
              {res.xe.map((x) => (
                <Row key={x.frame_number} icon="🛵" title={x.frame_number} sub={`${x.vehicle_id} · ${x.location_code}`}
                  tone={{ TON_KHO: "Tồn kho", DA_BAN: "Đã bán", GIU_CHO: "Giữ chỗ", DANG_CHUYEN: "Đang chuyển" }[x.status] || x.status}
                  onClick={() => go(`/danh-muc-xe?tab=sokhung&sk=${x.frame_number}`)} />
              ))}
            </>
          )}

          {res.khach.length > 0 && (
            <>
              <div className="px-3 pt-2 pb-1 text-[10.5px] font-bold uppercase text-[#8A93A0]">Khách hàng</div>
              {res.khach.map((c) => (
                <Row key={c.id} icon="👤" title={c.name} sub={`${c.code} · ${c.phone}`} tone={c.status}
                  onClick={() => go(`/khach-hang?q=${encodeURIComponent(c.phone || c.name)}`)} />
              ))}
            </>
          )}

          {res.don.length > 0 && (
            <>
              <div className="px-3 pt-2 pb-1 text-[10.5px] font-bold uppercase text-[#8A93A0]">Đơn bán</div>
              {res.don.map((o) => (
                <Row key={o.id} icon="₫" title={`${o.code} · ${o.customer_name}`} sub={`${o.sale_date} · SK ${o.frame_number}`}
                  tone={o.invoice_status === "Đã xuất HĐ" ? "Hoàn thành" : "Chờ HĐ"}
                  onClick={() => go(`/don-ban?q=${encodeURIComponent(o.code)}`)} />
              ))}
            </>
          )}

          {res.dv.length > 0 && (
            <>
              <div className="px-3 pt-2 pb-1 text-[10.5px] font-bold uppercase text-[#8A93A0]">Phiếu dịch vụ</div>
              {res.dv.map((t) => (
                <Row key={t.id} icon="🔧" title={`${t.code} · ${t.customer_name}`} sub={t.frame_number || t.customer_phone} tone={t.status}
                  onClick={() => go(`/dich-vu?q=${encodeURIComponent(t.code)}`)} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
