"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, KPI, MultiCheck } from "@/components/ui";
import { QuickDates } from "@/components/FinFilters";
import { fmtVND, fmtDate, errMsg, downloadXLSX } from "@/lib/format";
import { LSC_STATUS } from "@/lib/lsc";

const iso = (d) => d.toLocaleDateString("sv-SE");

export default function BaoCaoLSC() {
  const { supabase, locations, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const t = new Date();
  const [from, setFrom] = useState(iso(new Date(t.getFullYear(), t.getMonth(), 1)));
  const [to, setTo] = useState(iso(t));
  const [fLoc, setFLoc] = useState([]);
  const [rows, setRows] = useState([]);
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    const { data, error } = await supabase.from("v_lsc").select("*").gte("created_at", from + "T00:00:00+07:00").lte("created_at", to + "T23:59:59+07:00").limit(5000);
    if (error) { setBusy(false); return notify(errMsg(error), "err"); }
    setRows(data || []);
    const ids = (data || []).map((x) => x.id);
    let ls = [];
    for (let i = 0; i < ids.length; i += 300) {
      const { data: part } = await supabase.from("repair_order_lines").select("ro_id,line_type,ma,name,qty,thanh_tien,phan_loai_tt").in("ro_id", ids.slice(i, i + 300));
      ls = ls.concat(part || []);
    }
    setLines(ls); setBusy(false);
  };
  useEffect(() => { if (!loading) load(); }, [loading, from, to]);

  if (loading || !profile) return <div className="card">Đang tải…</div>;
  if (!["CEO", "MANAGER", "ADMIN"].includes(profile.role)) return <div className="card">Báo cáo này dành cho BGĐ / Quản lý / Kế toán.</div>;

  const today = iso(new Date());
  const rs = rows.filter((r) => !fLoc.length || fLoc.includes(r.location_code));
  const ok = rs.filter((r) => r.status !== "HUY");
  const idset = new Set(ok.map((r) => r.id));
  const ls = lines.filter((l) => idset.has(l.ro_id));
  const sum = (a, f) => a.reduce((s, x) => s + (Number(f(x)) || 0), 0);
  const doanhThu = sum(ok, (r) => r.tong_khach_tra), hang = sum(ok, (r) => r.tong_hang_tra), noiBo = sum(ok, (r) => r.tong_noi_bo), daThu = sum(ok, (r) => r.da_thu);
  const quaHan = ok.filter((r) => r.du_kien_giao_xe && r.du_kien_giao_xe < today && r.status !== "HOAN_THANH_TT");
  const nhom = (arr, key, val) => { const m = {}; arr.forEach((x) => { const k = key(x) || "—"; m[k] = m[k] || { n: 0, v: 0 }; m[k].n += 1; m[k].v += Number(val(x)) || 0; }); return Object.entries(m).sort((a, b) => b[1].v - a[1].v); };
  const theoLoai = nhom(ok, (r) => r.loai_dich_vu, (r) => r.tong_tien);
  const theoKtv = nhom(ok, (r) => r.ktv_name || "Chưa phân công", (r) => r.tong_tien);
  const theoDiem = nhom(ok, (r) => r.location_name || r.location_code, (r) => r.tong_tien);
  const topLine = (type) => { const m = {}; ls.filter((l) => l.line_type === type).forEach((l) => { const k = `${l.ma} · ${l.name}`; m[k] = m[k] || { n: 0, v: 0 }; m[k].n += Number(l.qty) || 0; m[k].v += Number(l.thanh_tien) || 0; }); return Object.entries(m).sort((a, b) => b[1].v - a[1].v).slice(0, 10); };

  const bang = (title, arr, ncol = "Số lệnh") => (
    <div className="card"><div className="font-extrabold mb-2">{title}</div>
      <table className="w-full border-collapse text-[12.5px]"><thead><tr><th className="th">Nhóm</th><th className="th text-right">{ncol}</th><th className="th text-right">Giá trị</th></tr></thead>
        <tbody>{arr.map(([k, v]) => <tr key={k}><td className="td">{k}</td><td className="td text-right">{Math.round(v.n * 100) / 100}</td><td className="td text-right font-bold">{fmtVND(v.v)}</td></tr>)}{arr.length === 0 && <tr><td className="td text-[#8A93A0]" colSpan={3}>Chưa có dữ liệu.</td></tr>}</tbody></table></div>);

  const xuat = () => downloadXLSX(`bao_cao_lsc_${from}_${to}.xlsx`, [["Số LSC", "Ngày tạo", "Điểm", "Trạng thái", "Loại dịch vụ", "KTV", "Biển số", "Khách", "Tổng chi phí", "Khách trả", "Hãng chịu", "Nội bộ", "Đã thu", "Dự kiến giao"],
    ...rs.map((r) => [r.code, fmtDate(r.created_at), r.location_name, LSC_STATUS[r.status]?.label, r.loai_dich_vu, r.ktv_name, r.plate, r.customer_name, r.tong_tien, r.tong_khach_tra, r.tong_hang_tra, r.tong_noi_bo, r.da_thu, r.du_kien_giao_xe ? fmtDate(r.du_kien_giao_xe) : ""])]);

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-extrabold text-lg mr-auto">Báo cáo Lệnh sửa chữa</div>
        <button className="btn-ghost !text-xs" onClick={xuat}>⬇ Xuất Excel</button>
      </div>
      <div className="card flex gap-2 flex-wrap items-center">
        <QuickDates from={from} to={to} setFrom={setFrom} setTo={setTo} />
        <input type="date" className="inp !w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" className="inp !w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
        <MultiCheck label="Điểm dịch vụ: tất cả" value={fLoc} onChange={setFLoc} options={locations.filter((l) => l.status === "Hoạt động").map((l) => ({ key: l.code, label: l.name }))} />
        {busy && <span className="text-xs text-[#8A93A0]">Đang tải…</span>}
      </div>
      <div className="flex gap-3 flex-wrap">
        <KPI label="Số lệnh (không tính hủy)" value={ok.length} sub={`${rs.length - ok.length} lệnh hủy`} tone="dark" />
        <KPI label="Doanh thu khách trả" value={fmtVND(doanhThu)} tone="blue" />
        <KPI label="Hãng chịu (bảo hành)" value={fmtVND(hang)} tone="green" />
        <KPI label="Nội bộ" value={fmtVND(noiBo)} tone="dark" />
        <KPI label="Đã thu" value={fmtVND(daThu)} tone="green" />
        <KPI label="Còn phải thu" value={fmtVND(Math.max(doanhThu - daThu, 0))} tone={doanhThu - daThu > 0 ? "red" : "dark"} />
      </div>
      <div className="grid gap-4 md:grid-cols-3">{bang("Theo loại dịch vụ", theoLoai)}{bang("Theo KTV", theoKtv)}{bang("Theo điểm dịch vụ", theoDiem)}</div>
      <div className="grid gap-4 md:grid-cols-2">{bang("Top 10 công việc (theo giá trị)", topLine("CONG"), "Số lần")}{bang("Top 10 phụ tùng (theo giá trị)", topLine("PHU_TUNG"), "Số lượng")}</div>
      <div className="card">
        <div className="font-extrabold mb-2">Lệnh quá hạn giao xe ({quaHan.length})</div>
        <table className="w-full border-collapse text-[12.5px]"><thead><tr><th className="th">Lệnh</th><th className="th">Biển số</th><th className="th">Khách</th><th className="th">Trạng thái</th><th className="th">Dự kiến giao</th><th className="th">KTV</th></tr></thead>
          <tbody>{quaHan.map((r) => <tr key={r.id}><td className="td font-bold"><Link href={`/dich-vu/lenh-sua-chua/${r.id}`} className="text-brand hover:underline">{r.code}</Link></td><td className="td">{r.plate}</td><td className="td">{r.customer_name}</td><td className="td"><Badge tone={LSC_STATUS[r.status]?.tone}>{LSC_STATUS[r.status]?.label}</Badge></td><td className="td text-danger font-bold">{fmtDate(r.du_kien_giao_xe)}</td><td className="td">{r.ktv_name || "—"}</td></tr>)}
            {quaHan.length === 0 && <tr><td className="td text-[#8A93A0]" colSpan={6}>Không có lệnh nào quá hạn giao xe.</td></tr>}</tbody></table>
      </div>
    </div>
  );
}
