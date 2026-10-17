"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, Pager, pageSlice, useSortable, Th, MultiCheck, LocSearch } from "@/components/ui";
import { QuickDates } from "@/components/FinFilters";
import { fmtDate, errMsg, downloadXLSX } from "@/lib/format";
import { LOAI_DV, NHOM_SC, LSC_STATUS } from "@/lib/lsc";
import XeFormModal from "@/components/XeFormModal";

export default function LenhSuaChua() {
  const { supabase, brands, vehicles, locations, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const router = useRouter();
  const sort = useSortable();
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(true);
  const [fTT, setFTT] = useState([]);
  const [fNhom, setFNhom] = useState([]);
  const [fKtv, setFKtv] = useState([]);
  const [fUt, setFUt] = useState("");
  const [fLoai, setFLoai] = useState([]);
  const [d1, setD1] = useState(""); const [d2, setD2] = useState("");
  const [q1, setQ1] = useState(""); const [q2, setQ2] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  // popup tao lenh
  const [popup, setPopup] = useState(false);
  const [xq, setXq] = useState("");
  const [hits, setHits] = useState([]);
  const [xe, setXe] = useState(null);
  const [loc, setLoc] = useState("");
  const [xeForm, setXeForm] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setBusy(true);
    const { data, error } = await supabase.from("v_lsc").select("*").order("created_at", { ascending: false }).limit(3000);
    if (error) notify(errMsg(error), "err");
    setRows(data || []); setBusy(false);
  };
  useEffect(() => { if (!loading) load(); }, [loading]);
  useEffect(() => {
    if (!popup || xe) return;
    const t = setTimeout(async () => {
      if (xq.trim().length < 2) { setHits([]); return; }
      const { data } = await supabase.rpc("fn_xe_tim", { p_q: xq, p_limit: 12 });
      setHits(data || []);
    }, 250);
    return () => clearTimeout(t);
  }, [xq, popup, xe]);

  if (loading || !profile) return <div className="card">Đang tải…</div>;
  const canTao = ["CEO", "MANAGER", "ADMIN", "TECHNICIAN"].includes(profile.role);
  const today = new Date().toLocaleDateString("sv-SE");

  const dong = () => { setPopup(false); setXq(""); setHits([]); setXe(null); };
  const tao = async () => {
    if (!xe) return notify("Chọn xe theo biển số / số khung.", "err");
    if (!loc) return notify("Chọn điểm dịch vụ.", "err");
    setCreating(true);
    const { data, error } = await supabase.rpc("fn_lsc_tao", { p: { vehicle_id: xe.id, location_code: loc } });
    setCreating(false);
    if (error) return notify(errMsg(error), "err");
    const r = Array.isArray(data) ? data[0] : data;
    notify(`Đã tạo lệnh sửa chữa ${r?.code || ""}.`);
    router.push(`/dich-vu/lenh-sua-chua/${r.id}`);
  };

  const ktvs = [...new Set(rows.map((r) => r.ktv_name).filter(Boolean))].sort();
  const kw = q.trim().toLowerCase();
  const kwNorm = q.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  const filtered = rows.filter((r) => {
    if (fTT.length && !fTT.includes(r.status)) return false;
    if (fNhom.length && !fNhom.includes(r.nhom_sua_chua)) return false;
    if (fLoai.length && !fLoai.includes(r.loai_dich_vu)) return false;
    if (fKtv.length && !fKtv.includes(r.ktv_name)) return false;
    if (fUt === "1" && !r.uu_tien) return false;
    if (fUt === "0" && r.uu_tien) return false;
    const ngay = (r.created_at || "").slice(0, 10);
    if (d1 && ngay < d1) return false; if (d2 && ngay > d2) return false;
    const qt = (r.quyet_toan_at || "").slice(0, 10);
    if (q1 && (!qt || qt < q1)) return false; if (q2 && (!qt || qt > q2)) return false;
    if (!kw) return true;
    return `${r.code} ${r.customer_name} ${r.customer_phone} ${r.sdt_lai_xe}`.toLowerCase().includes(kw) ||
      (kwNorm && `${r.plate}${r.frame_number}`.replace(/[^A-Za-z0-9]/g, "").toLowerCase().includes(kwNorm));
  });
  const sorted = sort.sortFn(filtered, { code: (r) => r.code, ngay: (r) => r.created_at, ktv: (r) => r.ktv_name, tt: (r) => r.status, loai: (r) => r.loai_dich_vu,
    bs: (r) => r.plate, nhom: (r) => r.nhom_sua_chua, gd: (r) => r.du_kien_giao_xe || "", ph: (r) => r.phat_hanh_at || "", qt: (r) => r.quyet_toan_at || "" });
  const coLoc = fTT.length || fNhom.length || fKtv.length || fLoai.length || fUt || d1 || d2 || q1 || q2 || q;
  const xoaLoc = () => { setFTT([]); setFNhom([]); setFKtv([]); setFLoai([]); setFUt(""); setD1(""); setD2(""); setQ1(""); setQ2(""); setQ(""); setPage(1); };

  const xuat = () => downloadXLSX(`lenh_sua_chua_${today}.xlsx`, [["Số LSC", "Ngày tạo", "KTV", "Trạng thái", "Loại dịch vụ", "Biển số", "Số khung", "Khách hàng", "SĐT", "Yêu cầu khách hàng", "Ưu tiên", "Nhóm sửa chữa", "Dự kiến giao xe", "Phát hành LSC", "Ngày quyết toán"],
    ...sorted.map((r) => [r.code, fmtDate(r.created_at), r.ktv_name, LSC_STATUS[r.status]?.label, r.loai_dich_vu, r.plate, r.frame_number, r.customer_name, r.customer_phone, r.yeu_cau, r.uu_tien ? "Có" : "", r.nhom_sua_chua,
      r.du_kien_giao_xe ? fmtDate(r.du_kien_giao_xe) : "", r.phat_hanh_at ? fmtDate(r.phat_hanh_at) : "", r.quyet_toan_at ? fmtDate(r.quyet_toan_at) : ""])]);

  const dem = (s) => rows.filter((r) => r.status === s).length;

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-extrabold text-lg mr-auto">Lệnh sửa chữa</div>
        <span className="text-[12px] text-[#5A6572]">Báo giá <b>{dem("BAO_GIA")}</b> · Phát hành <b>{dem("PHAT_HANH")}</b> · Hoàn thành TT <b>{dem("HOAN_THANH_TT")}</b></span>
        {canTao && <button className="btn-primary !text-xs" onClick={() => setPopup(true)}>Tạo lệnh sửa chữa +</button>}
      </div>

      <div className="card">
        <div className="flex gap-2 flex-wrap items-center mb-2">
          <MultiCheck label="Trạng thái: tất cả" value={fTT} onChange={(v) => { setFTT(v); setPage(1); }} options={Object.entries(LSC_STATUS).map(([k, v]) => ({ key: k, label: v.label }))} />
          <MultiCheck label="Loại dịch vụ: tất cả" value={fLoai} onChange={(v) => { setFLoai(v); setPage(1); }} options={LOAI_DV.map((x) => ({ key: x, label: x }))} />
          <MultiCheck label="Nhóm sửa chữa: tất cả" value={fNhom} onChange={(v) => { setFNhom(v); setPage(1); }} options={NHOM_SC.map((x) => ({ key: x, label: x }))} />
          <MultiCheck label="KTV: tất cả" value={fKtv} onChange={(v) => { setFKtv(v); setPage(1); }} options={ktvs.map((x) => ({ key: x, label: x }))} />
          <select className="inp !w-auto" value={fUt} onChange={(e) => { setFUt(e.target.value); setPage(1); }}>
            <option value="">Ưu tiên tiếp nhận: tất cả</option><option value="1">Có ưu tiên</option><option value="0">Không ưu tiên</option></select>
        </div>
        <div className="flex gap-2 flex-wrap items-center mb-2">
          <span className="text-[11.5px] font-semibold text-[#5A6572]">Ngày tạo:</span>
          <QuickDates from={d1} to={d2} setFrom={setD1} setTo={setD2} onChange={() => setPage(1)} />
          <input type="date" className="inp !w-auto" value={d1} onChange={(e) => { setD1(e.target.value); setPage(1); }} />
          <input type="date" className="inp !w-auto" value={d2} onChange={(e) => { setD2(e.target.value); setPage(1); }} />
          <span className="text-[11.5px] font-semibold text-[#5A6572] ml-2">Ngày quyết toán:</span>
          <input type="date" className="inp !w-auto" value={q1} onChange={(e) => { setQ1(e.target.value); setPage(1); }} />
          <input type="date" className="inp !w-auto" value={q2} onChange={(e) => { setQ2(e.target.value); setPage(1); }} />
        </div>
        <div className="flex gap-2 flex-wrap items-center mb-3">
          <input className="inp !w-80" placeholder="Nhập Mã LSC, biển số, số khung, tên khách, SĐT…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <button className="btn-ghost !text-xs" onClick={xoaLoc} disabled={!coLoc}>Xóa lọc ⛌</button>
          <button className="btn-ghost !text-xs" onClick={xuat}>Xuất Excel ⬇</button>
          <span className="ml-auto text-[12px] text-[#5A6572]">{sorted.length} lệnh</span>
        </div>

        <div className="tbl-scroll"><table className="w-full border-collapse tbl-card">
          <thead><tr>
            <Th label="Số LSC" k="code" sort={sort} /><Th label="Ngày tạo" k="ngay" sort={sort} /><Th label="KTV" k="ktv" sort={sort} /><Th label="Trạng thái" k="tt" sort={sort} />
            <Th label="Loại dịch vụ" k="loai" sort={sort} /><Th label="Biển số xe" k="bs" sort={sort} /><th className="th">Khách hàng</th><th className="th">Yêu cầu khách hàng</th>
            <th className="th">Ưu tiên</th><Th label="Nhóm sửa chữa" k="nhom" sort={sort} /><Th label="Dự kiến giao xe" k="gd" sort={sort} /><Th label="Phát hành LSC" k="ph" sort={sort} /><Th label="Ngày quyết toán" k="qt" sort={sort} />
          </tr></thead>
          <tbody>{pageSlice(sorted, page, pageSize).map((r) => (
            <tr key={r.id} className={`hover:bg-[#F8FAFC] ${r.status === "HUY" ? "text-[#8A93A0] bg-[#F7F8FA]" : ""}`}>
              <td data-label="Số LSC" className="td font-bold whitespace-nowrap"><Link href={`/dich-vu/lenh-sua-chua/${r.id}`} className="text-brand hover:underline">{r.code}</Link></td>
              <td data-label="Ngày tạo" className="td text-xs whitespace-nowrap">{fmtDate(r.created_at)}</td>
              <td data-label="KTV" className="td text-[13px]">{r.ktv_name || "—"}</td>
              <td data-label="Trạng thái" className="td"><Badge tone={LSC_STATUS[r.status]?.tone}>{LSC_STATUS[r.status]?.label}</Badge></td>
              <td data-label="Loại dịch vụ" className="td text-[13px]">{r.loai_dich_vu}</td>
              <td data-label="Biển số xe" className="td font-bold">{r.plate || <span className="text-[#C6CDD6]">—</span>}<div className="font-mono text-[10px] text-[#8A93A0] font-normal">{r.frame_number}</div></td>
              <td data-label="Khách hàng" className="td text-[13px]">{r.customer_name}<div className="text-[11px] text-[#8A93A0]">{r.sdt_lai_xe || r.customer_phone}</div></td>
              <td data-label="Yêu cầu" className="td text-[12.5px] max-w-[220px]"><div className="line-clamp-2">{r.yeu_cau || "—"}</div></td>
              <td data-label="Ưu tiên" className="td text-center">{r.uu_tien ? "🔥" : ""}</td>
              <td data-label="Nhóm sửa chữa" className="td text-[12px]">{r.nhom_sua_chua}</td>
              <td data-label="Dự kiến giao xe" className="td text-xs whitespace-nowrap">{r.du_kien_giao_xe ? fmtDate(r.du_kien_giao_xe) : "—"}</td>
              <td data-label="Phát hành LSC" className="td text-xs whitespace-nowrap">{r.phat_hanh_at ? fmtDate(r.phat_hanh_at) : "—"}</td>
              <td data-label="Ngày quyết toán" className="td text-xs whitespace-nowrap">{r.quyet_toan_at ? fmtDate(r.quyet_toan_at) : "—"}</td>
            </tr>
          ))}
          {sorted.length === 0 && <tr><td className="td" colSpan={13}>{busy ? "Đang tải…" : coLoc ? "Không có lệnh nào khớp bộ lọc." : "Chưa có lệnh sửa chữa. Bấm “Tạo lệnh sửa chữa +” để bắt đầu."}</td></tr>}
          </tbody>
        </table></div>
        <Pager total={sorted.length} page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} />
      </div>

      {popup && (
        <div className="fixed inset-0 z-[90] bg-black/50 flex items-start justify-center p-3 overflow-y-auto" onClick={dong}>
          <div className="bg-white rounded-2xl w-[560px] max-w-full p-4 my-10" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center mb-3"><div className="font-extrabold text-base">Tạo lệnh sửa chữa</div><button className="ml-auto text-[#8A93A0] text-lg" onClick={dong}>✕</button></div>
            <label className="lbl">Biển số xe / Số khung (VIN)</label>
            {xe ? (
              <div className="rounded-xl border border-[#D5DBE3] bg-[#F0FDF6] p-2.5 text-[13px]">
                <div className="flex items-center"><b className="text-[15px]">{xe.plate || "Chưa có biển số"}</b><span className="ml-2 font-mono text-[11.5px] text-[#5A6572]">{xe.frame_number}</span>
                  <button className="ml-auto text-sm text-[#8A93A0] hover:text-danger" onClick={() => { setXe(null); setXq(""); }}>Đổi xe</button></div>
                <div className="text-[#5A6572]">{[xe.brand, xe.model_name, xe.color].filter(Boolean).join(" · ")}</div>
                <div className="mt-1">Chủ xe: <b>{xe.customer_name}</b> · {xe.customer_phone}</div>
                {xe.warranty_end && <div className="text-[12px] mt-0.5">Bảo hành đến <b>{fmtDate(xe.warranty_end)}</b> {xe.warranty_end < today ? <Badge tone="red">Hết hạn</Badge> : <Badge tone="green">Còn hạn</Badge>}</div>}
              </div>
            ) : (
              <div className="relative">
                <input className="inp" autoFocus placeholder="Nhập biển số hoặc số khung để tìm kiếm…" value={xq} onChange={(e) => setXq(e.target.value)} />
                {xq.trim().length >= 2 && (
                  <div className="mt-1 border border-[#D5DBE3] rounded-xl overflow-hidden max-h-64 overflow-y-auto">
                    {hits.map((h) => (
                      <button key={h.id} className="w-full text-left px-3 py-2 border-b border-[#F2F4F7] hover:bg-[#F0FDF6]" onClick={() => setXe(h)}>
                        <b className="text-[13px]">{h.plate || "—"}</b> <span className="font-mono text-[11px] text-[#5A6572]">{h.frame_number}</span>
                        <div className="text-[11.5px] text-[#5A6572]">{[h.brand, h.model_name].filter(Boolean).join(" · ")} · {h.customer_name} · {h.customer_phone}</div>
                      </button>))}
                    {hits.length === 0 && <div className="px-3 py-2 text-xs text-[#8A93A0]">Không tìm thấy xe “{xq}” trong hệ thống.</div>}
                    <button className="w-full text-left px-3 py-2.5 hover:bg-[#EEF3FF] text-brand font-bold text-[13px]" onClick={() => setXeForm(true)}>+ Thêm xe / khách hàng mới “{xq}”</button>
                  </div>)}
                {xq.trim().length < 2 && <div className="text-[11.5px] text-[#8A93A0] mt-1">Xe lạ / khách lạ chưa có trong hệ thống: gõ biển số rồi chọn “+ Thêm xe / khách hàng mới”.</div>}
              </div>
            )}
            <label className="lbl mt-3">Điểm dịch vụ *</label>
            <LocSearch locations={locations} value={loc} onChange={setLoc} placeholder="Chọn điểm dịch vụ…" />
            <div className="flex gap-2 mt-4"><button className="btn-ghost flex-1" onClick={dong}>Hủy</button><button className="btn-primary flex-1" disabled={!xe || !loc || creating} onClick={tao}>{creating ? "Đang tạo…" : "Chấp nhận"}</button></div>
          </div>
        </div>
      )}
      {xeForm && <XeFormModal supabase={supabase} brands={brands} vehicles={vehicles} notify={notify} initial={null} defaultPlate={/\d/.test(xq) && xq.replace(/[^A-Za-z0-9]/g, "").length <= 11 ? xq : ""} defaultFrame={xq.replace(/[^A-Za-z0-9]/g, "").length > 11 ? xq : ""}
        onClose={() => setXeForm(false)} onSaved={async (id, ff) => { setXeForm(false); const { data } = await supabase.rpc("fn_xe_tim", { p_q: (ff?.plate || ff?.frame_number || xq), p_limit: 20 }); const f = (data || []).find((x) => x.id === id); if (f) setXe(f); }} />}
    </div>
  );
}
