"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, KPI, MoneyInput } from "@/components/ui";
import Link from "next/link";
import { QuickDates } from "@/components/FinFilters";
import { fmtVND, fmtDate, fmtTime, errMsg } from "@/lib/format";

const iso = (d) => d.toLocaleDateString("sv-SE");

// Doi chieu don ban <-> so quy: don co thu (payments) ma quy khong co phieu, hoac nguoc lai
function LechDonQuy({ supabase, locations, notify }) {
  const t0 = iso(new Date());
  const [from, setFrom] = useState(iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [to, setTo] = useState(t0);
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_doi_soat_lech", { p_from: from, p_to: to });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    setRows(data || []);
  };
  const locName = (c) => locations.find((l) => l.code === c)?.name || c || "—";
  return (
    <div className="card">
      <div className="font-extrabold mb-1">🔎 Đối chiếu Đơn bán ↔ Sổ quỹ</div>
      <p className="text-[11.5px] text-[#8A93A0] mb-2">Liệt kê đơn có tiền thu ghi trên đơn nhưng số tiền trong sổ quỹ (thu − hoàn) không khớp: <b>thiếu phiếu thu</b> (đơn có thu, quỹ chưa có) hoặc <b>phiếu thừa</b> (quỹ có, đơn không ghi).</p>
      <div className="flex gap-2 flex-wrap items-center mb-2">
        <QuickDates from={from} to={to} setFrom={setFrom} setTo={setTo} />
        <input type="date" className="inp !w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" className="inp !w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
        <button className="btn-primary !text-xs" disabled={busy} onClick={run}>{busy ? "Đang quét…" : "Quét chênh lệch"}</button>
      </div>
      {rows && (rows.length === 0 ? <div className="text-sm text-[#0E7A4A] font-semibold">✓ Không có đơn nào lệch trong kỳ.</div> : (
        <div className="tbl-scroll"><table className="w-full border-collapse tbl-card">
          <thead><tr><th className="th">Mã đơn</th><th className="th">Ngày</th><th className="th">Khách</th><th className="th">Điểm bán</th><th className="th text-right">Thu trên đơn</th><th className="th text-right">Sổ quỹ (thu−hoàn)</th><th className="th text-right">Chênh</th><th className="th">Kết luận</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.sale_code} className="hover:bg-[#F8FAFC]">
              <td data-label="Mã đơn" className="td font-bold"><Link href={`/don-ban?q=${r.sale_code}`} className="text-brand hover:underline">{r.sale_code}</Link>{r.order_status && r.order_status !== "Hoàn thành" && <span className="ml-1 text-[10.5px] text-[#8A93A0]">({r.order_status})</span>}</td>
              <td data-label="Ngày" className="td text-xs">{r.sale_date ? fmtDate(r.sale_date) : "—"}</td>
              <td data-label="Khách" className="td text-[13px]">{r.customer_name || "—"}</td>
              <td data-label="Điểm bán" className="td text-xs">{locName(r.location_code)}</td>
              <td data-label="Thu trên đơn" className="td text-right">{fmtVND(r.tong_payments)}</td>
              <td data-label="Sổ quỹ" className="td text-right">{fmtVND(r.tong_quy)}</td>
              <td data-label="Chênh" className="td text-right font-bold text-danger">{fmtVND(r.chenh)}</td>
              <td data-label="Kết luận" className="td"><Badge tone={r.chenh > 0 ? "red" : "amber"}>{r.chenh > 0 ? "Thiếu phiếu thu" : "Phiếu thừa"}</Badge></td>
            </tr>
          ))}</tbody>
        </table></div>
      ))}
    </div>
  );
}

export default function DoiSoat() {
  const { supabase, locations, profile, loading, regions } = useCatalog();
  const { toast, notify } = useToast();
  const [loc, setLoc] = useState("");
  const [ngay, setNgay] = useState(iso(new Date()));
  const [e, setE] = useState(null);
  const [lichSu, setLichSu] = useState([]);
  const [bienBan, setBienBan] = useState("");
  const [tienMat, setTienMat] = useState("");
  const [busy, setBusy] = useState(false);

  const loadLichSu = async () => {
    const { data } = await supabase.from("doi_soat_ngay").select("*").order("ngay", { ascending: false }).limit(30);
    setLichSu(data || []);
  };
  useEffect(() => { if (!loading) loadLichSu(); }, [loading]);

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;
  if (!["CEO", "MANAGER", "ADMIN"].includes(profile.role)) return <div className="card">Bạn không có quyền xem đối soát.</div>;

  const locName = (c) => locations.find((l) => l.code === c)?.name || c;
  const nhan = (x) => x.khu_vuc ? `Khu vực ${x.khu_vuc}` : locName(x.location_code);
  const soDiem = (r) => locations.filter((l) => l.region === r && l.status !== "Đã xóa").length;

  const tinh = async () => {
    if (!loc) return notify("Chọn khu vực.", "err");
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_doi_soat_tinh", { p_loc: loc, p_date: ngay });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    setE(data); setBienBan(data?.bien_ban_note || ""); setTienMat(data?.tien_mat_thuc_te ?? "");
    loadLichSu();
  };

  const chot = async (vai) => {
    setBusy(true);
    const { error } = await supabase.rpc("fn_doi_soat_chot", {
      p_loc: loc, p_date: ngay, p_vai: vai,
      p_tien_mat_thuc_te: tienMat === "" ? null : Number(tienMat),
      p_bien_ban: bienBan,
    });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(vai === "thu" ? "Người thu đã xác nhận." : "Cửa hàng trưởng đã xác nhận.");
    tinh();
  };


  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="font-extrabold text-lg">Đối soát cuối ngày — Bán xe & Dịch vụ</div>

      <div className="card">
        <div className="flex gap-2 flex-wrap items-end">
          <div className="!w-72"><label className="lbl">Khu vực (gồm tất cả điểm cửa hàng thuộc khu vực)</label>
            <select className="inp" value={loc} onChange={(ev) => { setLoc(ev.target.value); setE(null); }}>
              <option value="">— Chọn khu vực —</option>
              {regions.map((r) => <option key={r} value={"KV:" + r}>{r} ({soDiem(r)} điểm)</option>)}
            </select></div>
          <div><label className="lbl">Ngày</label><input type="date" className="inp !w-40" value={ngay} onChange={(e2) => setNgay(e2.target.value)} /></div>
          <button className="btn-primary" disabled={busy || !loc} onClick={tinh}>{busy ? "Đang tính…" : "🔄 Tính số liệu ngày"}</button>
        </div>
        <p className="text-[11px] text-[#8A93A0] mt-2">Số liệu tự tính (tổng hợp mọi điểm trong khu vực) từ đơn bán xe, phiếu dịch vụ, tiền cọc và sổ quỹ trong ngày — không nhập tay. Cần <b>2 người xác nhận</b> mới chốt được.</p>
      </div>

      {e && (
        <>
          <div className="card">
            <div className="font-extrabold mb-2">🛵 Bán xe</div>
            <div className="flex gap-3 flex-wrap">
              <KPI label="Số đơn" value={e.so_don_ban} tone="dark" />
              <KPI label="Doanh thu" value={fmtVND(e.dt_ban_xe)} tone="blue" />
              <KPI label="Đã thu" value={fmtVND(e.thu_ban_xe)} tone="green" />
              <KPI label="Còn nợ" value={fmtVND(Math.max(0, e.dt_ban_xe - e.thu_ban_xe))} tone={e.dt_ban_xe - e.thu_ban_xe > 0 ? "amber" : "green"} />
            </div>
          </div>

          <div className="card">
            <div className="font-extrabold mb-2">🔧 Dịch vụ</div>
            <div className="flex gap-3 flex-wrap">
              <KPI label="Số phiếu giao" value={e.so_phieu_dv} tone="dark" />
              <KPI label="Doanh thu" value={fmtVND(e.dt_dich_vu)} tone="blue" />
              <KPI label="Đã thu" value={fmtVND(e.thu_dich_vu)} tone="green" />
              <KPI label="Xe còn lưu" value={e.xe_luu} tone={e.xe_luu ? "amber" : "dark"} />
            </div>
          </div>

          <div className="card">
            <div className="font-extrabold mb-2">💰 Dòng tiền trong ngày</div>
            <div className="flex gap-3 flex-wrap mb-3">
              <KPI label="Thu tiền mặt" value={fmtVND(e.thu_tien_mat)} tone="amber" />
              <KPI label="Thu chuyển khoản" value={fmtVND(e.thu_chuyen_khoan)} tone="blue" />
              <KPI label="Tiền cọc" value={fmtVND(e.thu_coc)} tone="purple" />
              <KPI label="Chi trong ngày" value={fmtVND(e.chi_trong_ngay)} tone="red" />
              <KPI label="Công nợ duyệt" value={fmtVND(e.cong_no)} tone="dark" />
            </div>

            <div className="text-[13px] bg-[#F8FAFC] rounded-xl p-3">
              <div className="font-semibold mb-1">Công thức đối soát:</div>
              <div className="text-[11.5px] text-[#5A6572] mb-1">So <b>chứng từ thu trong ngày</b> (phiếu thanh toán đơn bán, thu dịch vụ, tiền cọc) với <b>sổ quỹ</b> (tiền mặt + chuyển khoản đã ghi) của khu vực. Chuyển khoản được tính theo điểm của đơn/phiếu tạo ra khoản thu (tài khoản ngân hàng thuộc pháp nhân, không gắn điểm). Trả góp chờ giải ngân chưa tính vì chưa vào quỹ.</div>
              <div>Chứng từ thu <b>{fmtVND(e.thu_tien_mat + e.thu_chuyen_khoan + e.lech)}</b> • Sổ quỹ: Tiền mặt <b>{fmtVND(e.thu_tien_mat)}</b> + Chuyển khoản <b>{fmtVND(e.thu_chuyen_khoan)}</b>
                {" "}{e.lech === 0 ? <span className="text-[#0E7A4A] font-bold">✓ khớp</span> : <span className="text-danger font-bold">⚠ lệch {fmtVND(e.lech)}</span>}</div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 mt-3">
              <div>
                <label className="lbl">Tiền mặt thực tế đếm được (không bắt buộc)</label>
                <MoneyInput value={tienMat} onChange={setTienMat} placeholder={String(e.thu_tien_mat)} />
                {tienMat !== "" && Number(tienMat) !== e.thu_tien_mat && (
                  <div className="text-[11px] mt-1 font-bold text-danger">
                    Lệch {fmtVND(Number(tienMat) - e.thu_tien_mat)} so với sổ
                  </div>
                )}
              </div>
              <div>
                <label className={`lbl ${e.lech !== 0 ? "text-danger" : ""}`}>Biên bản chênh lệch {e.lech !== 0 && "(bắt buộc khi lệch)"}</label>
                <textarea className="inp !h-16" value={bienBan} onChange={(e2) => setBienBan(e2.target.value)} placeholder="Nguyên nhân, ai chịu trách nhiệm, hướng xử lý…" />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <div className="font-extrabold mr-auto">Xác nhận chốt ngày {fmtDate(e.ngay)} · {nhan(e)}</div>
              <Badge tone={e.status === "DA_CHOT" ? "green" : "amber"}>{e.status === "DA_CHOT" ? "Đã chốt" : "Đang mở"}</Badge>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <div className="p-2.5 rounded-xl border border-[#E3E8EF]">
                <div className="text-xs text-[#8A93A0]">Người thu tiền xác nhận</div>
                {e.confirmed_thu_at
                  ? <div className="text-sm font-semibold text-[#0E7A4A]">✓ {e.confirmed_thu_name} · {fmtTime(e.confirmed_thu_at)}</div>
                  : <button className="btn-ok !text-xs mt-1" disabled={busy || e.status === "DA_CHOT"} onClick={() => chot("thu")}>Tôi xác nhận (người thu)</button>}
              </div>
              <div className="p-2.5 rounded-xl border border-[#E3E8EF]">
                <div className="text-xs text-[#8A93A0]">Cửa hàng trưởng xác nhận</div>
                {e.confirmed_cht_at
                  ? <div className="text-sm font-semibold text-[#0E7A4A]">✓ {e.confirmed_cht_name} · {fmtTime(e.confirmed_cht_at)}</div>
                  : <button className="btn-ok !text-xs mt-1" disabled={busy || e.status === "DA_CHOT"} onClick={() => chot("cht")}>Tôi xác nhận (CHT)</button>}
              </div>
            </div>
            {e.status === "DA_CHOT" && <div className="text-[12px] text-[#0E7A4A] font-semibold mt-2">✓ Đã chốt — biên bản đã gửi về Discord.</div>}
          </div>
        </>
      )}

      <LechDonQuy supabase={supabase} locations={locations} notify={notify} />

      <div className="card">
        <div className="font-extrabold mb-2">Lịch sử đối soát ({lichSu.length})</div>
        {lichSu.length === 0 ? <div className="text-sm text-[#8A93A0]">Chưa có ngày nào được tính.</div> : (
          <div className="tbl-scroll"><table className="w-full border-collapse tbl-card">
            <thead><tr><th className="th">Ngày</th><th className="th">Khu vực / điểm</th><th className="th">Bán xe</th><th className="th">Dịch vụ</th><th className="th">Tiền mặt</th><th className="th">CK</th><th className="th">Lệch</th><th className="th">Trạng thái</th></tr></thead>
            <tbody>{lichSu.map((x) => (
              <tr key={x.id} className={x.lech !== 0 ? "bg-[#FFF6F6]" : "hover:bg-[#F8FAFC]"}>
                <td data-label="Ngày" className="td whitespace-nowrap">{fmtDate(x.ngay)}</td>
                <td data-label="Khu vực / điểm" className="td text-xs">{nhan(x)}</td>
                <td data-label="Bán xe" className="td">{x.so_don_ban} đơn · {fmtVND(x.dt_ban_xe)}</td>
                <td data-label="Dịch vụ" className="td">{x.so_phieu_dv} phiếu · {fmtVND(x.dt_dich_vu)}</td>
                <td data-label="Tiền mặt" className="td">{fmtVND(x.thu_tien_mat)}</td>
                <td data-label="CK" className="td">{fmtVND(x.thu_chuyen_khoan)}</td>
                <td data-label="Lệch" className="td"><b className={x.lech === 0 ? "text-[#0E7A4A]" : "text-danger"}>{fmtVND(x.lech)}</b></td>
                <td data-label="Trạng thái" className="td"><Badge tone={x.status === "DA_CHOT" ? "green" : "amber"}>{x.status === "DA_CHOT" ? "Đã chốt" : "Đang mở"}</Badge></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
