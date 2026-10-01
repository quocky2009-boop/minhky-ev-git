import { fmtVND } from "@/lib/format";

const KIND_LABELS = { GIAM_GIA: "Giảm giá", QUY_DOI_TIEN_MAT: "Quy đổi tiền mặt", HO_TRO_SAU_BAN: "Hỗ trợ sau bán" };

const giaTri = (k) => (k.value_type === "percent" ? `${Number(k.value)}%` : fmtVND(k.value));

// Bang gia + chi tiet CTKM + dia chi xuat HD cua don tao tu Wizard (co price_snapshot).
// Don cu (khong co snapshot) chi hien dia chi HD neu co.
export default function BangGiaDon({ o }) {
  const s = o?.price_snapshot;
  const ex = o?.extra || {};
  const diaChi = [ex.hd_dia_chi, ex.hd_phuong_xa, ex.hd_tinh_tp].filter(Boolean).join(", ");
  if (!s && !diaChi) return null;
  return (
    <div className="card !p-3 mb-3">
      {s && (
        <>
          <div className="font-extrabold text-[13px] mb-2">💰 Bảng giá & khuyến mại</div>
          <div className="rounded-xl border border-[#E3E8EF] overflow-hidden text-[13px]">
            <div className="flex justify-between px-3 py-2 border-b border-dashed border-[#E3E8EF]"><span className="text-[#5A6572]">Giá niêm yết</span><b>{fmtVND(s.gia_xe)}</b></div>
            {(s.khuyen_mai || []).map((k) => (
              <div key={k.id} className="px-3 py-1.5 border-b border-dashed border-[#F0F2F5] text-[12px]">
                <div className="flex justify-between gap-2">
                  <span className="text-[#5A6572]">🏷 {k.name}</span>
                  <span className={k.amount > 0 ? "text-danger font-semibold whitespace-nowrap" : "text-[#8A93A0]"}>{k.amount > 0 ? `-${fmtVND(k.amount)}` : "—"}</span>
                </div>
                <div className="text-[10.5px] text-[#8A93A0]">{KIND_LABELS[k.kind] || k.kind}{k.kind !== "HO_TRO_SAU_BAN" && k.value != null ? ` · mức ${giaTri(k)}` : ""}</div>
              </div>
            ))}
            {(s.khuyen_mai || []).length === 0 && <div className="px-3 py-1.5 border-b border-dashed border-[#F0F2F5] text-[12px] text-[#8A93A0]">Không áp dụng khuyến mại.</div>}
            <div className="flex justify-between px-3 py-2 border-b border-dashed border-[#E3E8EF]"><span className="text-[#5A6572]">Tổng ưu đãi</span><b className="text-danger">-{fmtVND(s.tong_uu_dai)}</b></div>
            <div className="flex justify-between px-3 py-2 border-b border-dashed border-[#E3E8EF] bg-[#EAF2FF]"><span className="font-bold">Giá cần thanh toán</span><b className="text-brand">{fmtVND(s.gia_can_thanh_toan)}</b></div>
            <div className="flex justify-between px-3 py-2"><span className="text-[#5A6572]">Tổng tiền xuất hóa đơn</span><b>{fmtVND(o.invoice_total ?? s.tong_xuat_hd)}</b></div>
          </div>
        </>
      )}
      {diaChi && (
        <div className={s ? "mt-2.5 text-[13px]" : "text-[13px]"}>
          <div className="text-[11px] text-[#8A93A0] uppercase font-semibold tracking-wide">Địa chỉ xuất hóa đơn</div>
          {diaChi}
        </div>
      )}
    </div>
  );
}
