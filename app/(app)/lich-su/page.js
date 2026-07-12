"use client";
import { useEffect, useState } from "react";

const iso = (d) => d.toISOString().slice(0, 10);
function rangeOf(preset) {
  const now = new Date(); const to = iso(now);
  if (preset === "today") return [to, to];
  if (preset === "week") { const d = new Date(now); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return [iso(d), to]; }
  if (preset === "month") return [iso(new Date(now.getFullYear(), now.getMonth(), 1)), to];
  if (preset === "quarter") return [iso(new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)), to];
  if (preset === "year") return [iso(new Date(now.getFullYear(), 0, 1)), to];
  return [to, to];
}
const PRESETS = [["today","Hôm nay"],["week","Tuần này"],["month","Tháng này"],["quarter","Quý này"],["year","Năm nay"]];
import { useCatalog } from "@/lib/useData";
import { Badge, Pager, pageSlice } from "@/components/ui";
import { fmtTime } from "@/lib/format";

export default function LichSu() {
  const { supabase, vehicles, locations, loading } = useCatalog();
  const [txns, setTxns] = useState([]);
  const [type, setType] = useState(""); const [loc, setLoc] = useState(""); const [q, setQ] = useState("");
  const [preset, setPreset] = useState("month");
  const [from, setFrom] = useState(rangeOf("month")[0]);
  const [to, setTo] = useState(rangeOf("month")[1]);
  const [docSet, setDocSet] = useState(new Set()); // ma phieu tim duoc tu so khung
  const pickPreset = (k) => { setPreset(k); const [a, b] = rangeOf(k); setFrom(a); setTo(b); };
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("inventory_txns").select("*")
        .gte("created_at", from).lte("created_at", to + "T23:59:59")
        .order("created_at", { ascending: false }).limit(3000);
      setTxns(data || []);
    })();
  }, [from, to]);

  // Tim theo SO KHUNG: tra bang xe -> lay ma phieu nhap / phieu ban lien quan
  useEffect(() => {
    const kw = q.trim().toUpperCase();
    if (kw.length < 4) { setDocSet(new Set()); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.from("vehicle_units")
        .select("frame_number, import_doc, sale_code, transfer_code")
        .ilike("frame_number", `%${kw}%`).limit(100);
      const st = new Set();
      (data || []).forEach((u) => { [u.import_doc, u.sale_code, u.transfer_code].forEach((d) => d && st.add(d)); });
      setDocSet(st);
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  if (loading) return <div className="card">Đang tải dữ liệu…</div>;
  const locName = (c) => locations.find((l) => l.code === c)?.name || c || "—";
  const list = txns.filter((t) => {
    if (type && t.txn_type !== type) return false;
    if (loc && t.from_location !== loc && t.to_location !== loc) return false;
    const v = vehicles.find((x) => x.id === t.vehicle_id);
    const text = ((v ? v.name + v.color : "") + t.vehicle_id + (t.created_by_name || "") + (t.doc_code || "") + (t.note || "")).toLowerCase();
    if (q && !text.includes(q.toLowerCase()) && !docSet.has(t.doc_code)) return false;
    return true;
  });
  const tb = (t) => t === "Nhập hàng" ? <Badge tone="green">Nhập hàng</Badge> : t === "Bán hàng" ? <Badge tone="blue">Bán hàng</Badge> : t === "Điều chuyển" ? <Badge tone="purple">Điều chuyển</Badge> : <Badge tone="amber">{t}</Badge>;

  return (
    <div className="card">
      <div className="flex gap-1.5 mb-2 flex-wrap items-end">
        {PRESETS.map(([k, lb]) => (
          <button key={k} className={`btn !px-3 !py-2 !text-xs ${preset === k ? "bg-navy-900 text-white" : "bg-[#EEF1F4] text-[#3B4552]"}`} onClick={() => pickPreset(k)}>{lb}</button>
        ))}
        <div><label className="lbl">Từ ngày</label><input type="date" className="inp !w-auto" value={from} onChange={(e) => { setFrom(e.target.value); setPreset("custom"); }} /></div>
        <div><label className="lbl">Đến ngày</label><input type="date" className="inp !w-auto" value={to} onChange={(e) => { setTo(e.target.value); setPreset("custom"); }} /></div>
      </div>
      <div className="flex gap-2 mb-3 flex-wrap">
        <input className="inp !w-auto flex-[2] min-w-[220px]" placeholder="Tìm theo số khung, tên khách, xe, người thao tác, mã phiếu…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="inp !w-auto flex-1 min-w-[130px]" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Loại: tất cả</option><option>Nhập hàng</option><option>Bán hàng</option><option>Điều chuyển</option><option>Điều chỉnh</option><option>Kiểm kê</option>
        </select>
        <select className="inp !w-auto flex-1 min-w-[160px]" value={loc} onChange={(e) => setLoc(e.target.value)}>
          <option value="">Kho: tất cả</option>{locations.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
        </select>
      </div>
      <div className="text-xs text-[#8A93A0] mb-2.5">{list.length} giao dịch · Lịch sử không thể xóa/sửa — sai sót xử lý bằng giao dịch điều chỉnh mới.</div>
      <div className="overflow-x-auto"><table className="w-full border-collapse">
        <thead><tr><th className="th">Thời gian</th><th className="th">Loại</th><th className="th">Xe</th><th className="th">Kho</th><th className="th">SL</th><th className="th">Tồn trước → sau</th><th className="th">Người</th><th className="th">Phiếu / Ghi chú</th></tr></thead>
        <tbody>{pageSlice(list, page, pageSize).map((t) => {
          const v = vehicles.find((x) => x.id === t.vehicle_id);
          return (
            <tr key={t.id}>
              <td className="td whitespace-nowrap">{fmtTime(t.created_at)}</td>
              <td className="td">{tb(t.txn_type)}</td>
              <td className="td">{v ? `${v.name} ${v.color}` : t.vehicle_id}</td>
              <td className="td">{t.from_location && t.to_location ? `${locName(t.from_location)} → ${locName(t.to_location)}` : locName(t.from_location || t.to_location)}</td>
              <td className="td"><b className={t.qty < 0 ? "text-danger" : "text-[#0E7A4A]"}>{t.qty > 0 ? "+" : ""}{t.qty}</b></td>
              <td className="td">{t.stock_before} → <b>{t.stock_after}</b></td>
              <td className="td">{t.created_by_name}</td>
              <td className="td"><b>{t.doc_code}</b>{t.note && <div className="text-[11px] text-[#8A93A0]">{t.note}</div>}</td>
            </tr>
          );
        })}</tbody>
      </table></div>
      <Pager total={list.length} page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} />
    </div>
  );
}
