"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, KPI, LocSearch } from "@/components/ui";
import { fmtVND, fmtDate, fmtTime, errMsg } from "@/lib/format";

const iso = (d) => d.toLocaleDateString("sv-SE");

export default function EOD() {
  const { supabase, locations, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [loc, setLoc] = useState("");
  const [ngay, setNgay] = useState(iso(new Date()));
  const [eod, setEod] = useState(null);
  const [lichSu, setLichSu] = useState([]);
  const [bienBan, setBienBan] = useState("");
  const [busy, setBusy] = useState(false);

  const loadLichSu = async () => {
    const { data } = await supabase.from("dv_eod").select("*").order("eod_date", { ascending: false }).limit(30);
    setLichSu(data || []);
  };
  useEffect(() => { if (!loading) loadLichSu(); }, [loading]);

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;

  const tinh = async () => {
    if (!loc) return notify("Chọn điểm dịch vụ.", "err");
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_dv_eod_tinh", { p_loc: loc, p_date: ngay });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    setEod(data); setBienBan(data?.bien_ban_note || "");
    loadLichSu();
  };

  const chot = async (vai) => {
    if (eod?.lech !== 0 && !bienBan.trim() && !eod?.bien_ban_note) {
      return notify("Có lệch — bắt buộc ghi biên bản chênh lệch trước khi chốt.", "err");
    }
    setBusy(true);
    const { error } = await supabase.rpc("fn_dv_eod_chot", { p_loc: loc, p_date: ngay, p_vai: vai, p_bien_ban: bienBan });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(vai === "thu" ? "Người thu đã xác nhận." : "Cửa hàng trưởng đã xác nhận.");
    tinh();
  };

  const locName = (c) => locations.find((l) => l.code === c)?.name || c;

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="font-extrabold text-lg">Đối soát cuối ngày (EOD) — Dịch vụ</div>

      <div className="card">
        <div className="flex gap-2 flex-wrap items-end">
          <div className="!w-64"><label className="lbl">Điểm dịch vụ</label><LocSearch locations={locations} value={loc} onChange={setLoc} placeholder="Chọn điểm…" /></div>
          <div><label className="lbl">Ngày</label><input type="date" className="inp !w-40" value={ngay} onChange={(e) => setNgay(e.target.value)} /></div>
          <button className="btn-primary" disabled={busy || !loc} onClick={tinh}>{busy ? "Đang tính…" : "🔄 Tính số liệu ngày"}</button>
        </div>
        <p className="text-[11px] text-[#8A93A0] mt-2">Số liệu tự tính từ phiếu dịch vụ đã giao và phiếu thu trong ngày — không nhập tay. Cần <b>2 người xác nhận</b> (người thu + cửa hàng trưởng) mới chốt được ngày.</p>
      </div>

      {eod && (
        <>
          <div className="flex gap-3 flex-wrap">
            <KPI label="Phiếu đã giao" value={eod.so_phieu_dong} tone="dark" />
            <KPI label="Phải thu" value={fmtVND(eod.phai_thu)} tone="blue" />
            <KPI label="Thu chuyển khoản" value={fmtVND(eod.thu_ck)} tone="green" />
            <KPI label="Thu tiền mặt" value={fmtVND(eod.thu_tm)} tone="green" />
            <KPI label="Công nợ duyệt" value={fmtVND(eod.cong_no)} tone="purple" />
            <KPI label="Chênh lệch" value={fmtVND(eod.lech)} tone={eod.lech === 0 ? "green" : "red"} />
            <KPI label="Xe còn lưu" value={eod.xe_luu} tone={eod.xe_luu ? "amber" : "dark"} />
          </div>

          <div className="card">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <div className="font-extrabold mr-auto">Biên bản ngày {fmtDate(eod.eod_date)} · {locName(eod.location_code)}</div>
              <Badge tone={eod.status === "DA_CHOT" ? "green" : "amber"}>{eod.status === "DA_CHOT" ? "Đã chốt" : "Đang mở"}</Badge>
            </div>

            <div className="text-[13px] bg-[#F8FAFC] rounded-xl p-3 mb-3">
              <div className="font-semibold mb-1">Công thức chốt ngày:</div>
              <div>Phải thu <b>{fmtVND(eod.phai_thu)}</b> = CK <b>{fmtVND(eod.thu_ck)}</b> + Tiền mặt <b>{fmtVND(eod.thu_tm)}</b> + Công nợ <b>{fmtVND(eod.cong_no)}</b> {eod.lech === 0 ? <span className="text-[#0E7A4A] font-bold">✓ khớp</span> : <span className="text-danger font-bold">⚠ lệch {fmtVND(eod.lech)}</span>}</div>
            </div>

            {eod.lech !== 0 && (
              <div className="mb-3">
                <label className="lbl text-danger">Biên bản chênh lệch (BM-DV-07) — bắt buộc khi có lệch</label>
                <textarea className="inp !h-20" value={bienBan} onChange={(e) => setBienBan(e.target.value)} placeholder="Nguyên nhân lệch, ai chịu trách nhiệm, hướng xử lý…" />
              </div>
            )}

            <div className="grid gap-2 md:grid-cols-2 mb-3">
              <div className="p-2.5 rounded-xl border border-[#E3E8EF]">
                <div className="text-xs text-[#8A93A0]">Người thu tiền xác nhận</div>
                {eod.confirmed_thu_at ? (
                  <div className="text-sm font-semibold text-[#0E7A4A]">✓ {eod.confirmed_thu_name} · {fmtTime(eod.confirmed_thu_at)}</div>
                ) : (
                  <button className="btn-ok !text-xs mt-1" disabled={busy || eod.status === "DA_CHOT"} onClick={() => chot("thu")}>Tôi xác nhận (người thu)</button>
                )}
              </div>
              <div className="p-2.5 rounded-xl border border-[#E3E8EF]">
                <div className="text-xs text-[#8A93A0]">Cửa hàng trưởng xác nhận</div>
                {eod.confirmed_cht_at ? (
                  <div className="text-sm font-semibold text-[#0E7A4A]">✓ {eod.confirmed_cht_name} · {fmtTime(eod.confirmed_cht_at)}</div>
                ) : (
                  <button className="btn-ok !text-xs mt-1" disabled={busy || eod.status === "DA_CHOT"} onClick={() => chot("cht")}>Tôi xác nhận (CHT)</button>
                )}
              </div>
            </div>
            {eod.bien_ban_note && <div className="text-[13px] p-2.5 rounded-xl bg-[#FFF6E5]"><b>Biên bản:</b> {eod.bien_ban_note}</div>}
            {eod.status === "DA_CHOT" && <div className="text-[12px] text-[#0E7A4A] font-semibold mt-2">✓ Ngày đã chốt — biên bản đã gửi về Discord.</div>}
          </div>
        </>
      )}

      <div className="card">
        <div className="font-extrabold mb-2">Lịch sử chốt ngày ({lichSu.length})</div>
        {lichSu.length === 0 ? <div className="text-sm text-[#8A93A0]">Chưa có ngày nào được tính.</div> : (
          <div className="overflow-x-auto"><table className="w-full border-collapse">
            <thead><tr><th className="th">Ngày</th><th className="th">Điểm</th><th className="th">Phiếu</th><th className="th">Phải thu</th><th className="th">CK</th><th className="th">Tiền mặt</th><th className="th">Công nợ</th><th className="th">Lệch</th><th className="th">Trạng thái</th></tr></thead>
            <tbody>{lichSu.map((e) => (
              <tr key={e.id} className={e.lech !== 0 ? "bg-[#FFF6F6]" : "hover:bg-[#F8FAFC]"}>
                <td className="td whitespace-nowrap">{fmtDate(e.eod_date)}</td>
                <td className="td text-xs">{locName(e.location_code)}</td>
                <td className="td text-center">{e.so_phieu_dong}</td>
                <td className="td">{fmtVND(e.phai_thu)}</td>
                <td className="td">{fmtVND(e.thu_ck)}</td>
                <td className="td">{fmtVND(e.thu_tm)}</td>
                <td className="td">{fmtVND(e.cong_no)}</td>
                <td className="td"><b className={e.lech === 0 ? "text-[#0E7A4A]" : "text-danger"}>{fmtVND(e.lech)}</b></td>
                <td className="td"><Badge tone={e.status === "DA_CHOT" ? "green" : "amber"}>{e.status === "DA_CHOT" ? "Đã chốt" : "Đang mở"}</Badge></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
