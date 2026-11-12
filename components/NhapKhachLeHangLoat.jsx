"use client";
import { useRef, useState } from "react";
import { downloadXLSX, readTableFile, errMsg } from "@/lib/format";

// NHAP KHACH LE SAU CUNG HANG LOAT cho cac xe dang ky gui tai khach buon.
// Buoc 1: tai file mau (da dien san Ma don, khach buon, xe, so khung cua cac xe dang ky gui).
// Buoc 2: dien thong tin khach le vao cac dong da ban, de trong dong chua ban -> chon file -> xem truoc -> nhap.
// Moi dong goi fn_luu_khach_le_cuoi (nhu nhap tay o Don ban) + fn_kb_ghi_khach_le_cuoi (tinh bu thue pin; giu nguyen KM da chon truoc do).
const COT = ["Mã đơn", "Khách buôn", "Tên xe", "Màu", "Số khung", "Loại pin xe", "Ngày xuất", "Họ tên khách lẻ", "SĐT khách lẻ", "Địa chỉ VNeID", "Email", "Hình thức pin (Kèm pin / Thuê pin)", "Số tiền hóa đơn"];
const chuan = (s) => String(s || "").trim().toLowerCase();
const soDT = (s) => { let d = String(s || "").replace(/\D/g, ""); if (d.length === 9) d = "0" + d; return d; };

export default function NhapKhachLeHangLoat({ supabase, ds, notify, onDone, onClose }) {
  // ds: danh sach xe dang ky gui (da kem v = thong tin xe) theo bo loc cua trang
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [kq, setKq] = useState(null);
  const fileRef = useRef(null);

  const taiMau = () => downloadXLSX("mau_nhap_khach_le_hang_loat.xlsx", [COT,
    ...[...ds].sort((a, b) => String(a.customer_name).localeCompare(String(b.customer_name)) || String(a.sale_date).localeCompare(String(b.sale_date)))
      .map((x) => [x.code, x.customer_name, x.v.name || x.vehicle_id, x.v.color || "", x.frame_number || "", x.v.model_pin || "", x.sale_date, "", "", "", "", "", ""])], "Khach_le");

  const docFile = async (file) => {
    setKq(null);
    let t;
    try { t = await readTableFile(file); } catch (ex) { return notify("Không đọc được file: " + (ex.message || ex), "err"); }
    if (t.length < 2) return notify("File trống hoặc sai định dạng.", "err");
    const h = t[0].map(chuan);
    const ix = (...ten) => h.findIndex((x) => ten.some((k) => x.startsWith(k)));
    const c = { code: ix("mã đơn"), sk: ix("số khung"), ten: ix("họ tên"), sdt: ix("sđt", "số điện thoại"), dc: ix("địa chỉ"), email: ix("email"), pin: ix("hình thức pin"), hd: ix("số tiền hóa đơn", "số tiền hđ") };
    if ((c.code < 0 && c.sk < 0) || c.ten < 0 || c.sdt < 0 || c.dc < 0 || c.email < 0) return notify("File thiếu cột. Bấm “Tải file mẫu” để lấy đúng mẫu (cần: Mã đơn hoặc Số khung, Họ tên khách lẻ, SĐT khách lẻ, Địa chỉ VNeID, Email).", "err");
    const o_ = (r, i) => (i >= 0 ? String(r[i] || "").trim() : "");
    const daCo = new Set();
    const out = [];
    t.slice(1).forEach((r, i) => {
      const ten = o_(r, c.ten), sdt = o_(r, c.sdt), dc = o_(r, c.dc), email = o_(r, c.email);
      if (!ten && !sdt && !dc && !email) return; // dong chua ban -> bo qua
      const code = o_(r, c.code), sk = o_(r, c.sk);
      const x = ds.find((d) => (code && chuan(d.code) === chuan(code)) || (!code && sk && chuan(d.frame_number) === chuan(sk)));
      const pinRaw = chuan(o_(r, c.pin));
      const pin = pinRaw.startsWith("thuê") || pinRaw.startsWith("thue") ? "Thuê pin" : pinRaw.startsWith("kèm") || pinRaw.startsWith("kem") ? "Kèm pin" : "";
      const hd = o_(r, c.hd).replace(/[^\d]/g, "");
      const loi = [];
      if (!x) loi.push(code || sk ? "không tìm thấy xe đang ký gửi theo mã đơn / số khung này (đã có khách lẻ, đã hủy, hoặc ngoài bộ lọc)" : "thiếu Mã đơn / Số khung");
      else if (daCo.has(x.id)) loi.push("trùng với một dòng phía trên");
      if (!ten) loi.push("thiếu họ tên");
      if (soDT(sdt).length < 9) loi.push("SĐT không hợp lệ");
      if (!dc) loi.push("thiếu địa chỉ VNeID");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) loi.push(email ? "email không hợp lệ" : "thiếu email");
      if (x && x.v.model_pin === "Xe đổi pin" && !pin) loi.push("xe đổi pin: phải ghi Kèm pin hoặc Thuê pin");
      if (x) daCo.add(x.id);
      out.push({ dong: i + 2, x, code: x?.code || code, sk: x?.frame_number || sk, ten, sdt: soDT(sdt) || sdt, dc, email, pin: x && x.v.model_pin === "Xe đổi pin" ? pin : "", hd, loi });
    });
    if (!out.length) return notify("File chưa có dòng nào điền thông tin khách lẻ.", "err");
    setRows(out);
  };

  const hopLe = (rows || []).filter((r) => !r.loi.length);
  const nhap = async () => {
    setBusy(true);
    let ok = 0, buPin = 0; const loi = [];
    for (const r of hopLe) {
      const { error } = await supabase.rpc("fn_luu_khach_le_cuoi", { p: { id: r.x.id, name: r.ten, phone: r.sdt, address: r.dc, email: r.email, customer_type: "Khách lẻ của Đại lý", invoice_amount: r.hd || "", battery_option: r.pin || "" } });
      if (error) { loi.push(`Dòng ${r.dong} (${r.code}): ${errMsg(error)}`); continue; }
      ok++;
      // Ghi so khach buon: tinh bu thue pin; giu nguyen cac khuyen mai da chon truoc do tren don
      const { data: dang } = await supabase.from("kb_so_cai").select("promotion_id").eq("sale_code", r.x.code).eq("loai", "KHUYEN_MAI").eq("huy", false);
      const { data: kb, error: e2 } = await supabase.rpc("fn_kb_ghi_khach_le_cuoi", { p_sale_code: r.x.code, p_promotion_ids: (dang || []).map((d) => d.promotion_id).filter(Boolean) });
      if (e2) loi.push(`Dòng ${r.dong} (${r.code}): đã lưu khách lẻ nhưng chưa ghi sổ khách buôn — ${errMsg(e2)}`);
      else buPin += Number(kb?.bu_pin) || 0;
    }
    setBusy(false); setKq({ ok, loi, buPin }); setRows(null);
    if (ok) onDone && onDone();
  };

  return (
    <div className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-white rounded-2xl w-[860px] max-w-full max-h-[90vh] overflow-y-auto p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-2"><div className="font-extrabold text-base mr-auto">Nhập khách lẻ sau cùng hàng loạt</div><button className="btn-ghost !px-3 !py-1.5 !text-xs" onClick={onClose}>✕</button></div>
        <ol className="text-[12.5px] text-[#3D4E6C] list-decimal pl-5 mb-3 flex flex-col gap-1">
          <li><b>Tải file mẫu</b> — đã điền sẵn {ds.length} xe đang ký gửi (theo bộ lọc đang chọn): mã đơn, khách buôn, xe, số khung.</li>
          <li>Điền <b>Họ tên, SĐT, Địa chỉ VNeID, Email</b> cho các xe đã bán. Xe đổi pin ghi thêm <b>Kèm pin / Thuê pin</b>. Xe chưa bán thì để trống cả dòng.</li>
          <li><b>Chọn file</b> đã điền → xem trước → bấm Nhập.</li>
        </ol>
        <div className="flex gap-2 flex-wrap mb-3">
          <button className="btn-ghost !text-xs" onClick={taiMau}>⬇ Tải file mẫu</button>
          <button className="btn-primary !text-xs" onClick={() => fileRef.current?.click()}>⬆ Chọn file đã điền</button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) docFile(f); }} />
        </div>
        <div className="text-[11.5px] text-[#8A93A0] mb-3">Bù tiền thuê pin cho khách buôn được tính tự động như khi nhập tay. <b>Khuyến mại hãng cộng sổ</b> không áp tự động khi nhập hàng loạt — đơn nào có thì mở đơn ở Đơn bán để chọn khuyến mại.</div>

        {rows && (
          <>
            <div className="text-[12.5px] mb-1.5"><b className="text-[#0E7A4A]">{hopLe.length}</b> dòng hợp lệ{rows.length > hopLe.length ? <> · <b className="text-danger">{rows.length - hopLe.length}</b> dòng lỗi (sẽ bỏ qua)</> : ""}</div>
            <div className="tbl-scroll max-h-[46vh] overflow-y-auto border border-[#E3E8EF] rounded-lg"><table className="w-full border-collapse text-[12px] tbl-card">
              <thead><tr><th className="th">Dòng</th><th className="th">Đơn · số khung</th><th className="th">Khách buôn · xe</th><th className="th">Khách lẻ</th><th className="th">Liên hệ</th><th className="th">Pin</th><th className="th">Kết quả kiểm tra</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.dong} className={r.loi.length ? "bg-[#FFF6F6]" : ""}>
                  <td data-m="hide" className="td text-[#8A93A0]">{r.dong}</td>
                  <td data-m="title" className="td"><b>{r.code || "—"}</b><div className="font-mono text-[10.5px] text-[#8A93A0]">{r.sk}</div></td>
                  <td data-m="nolabel full" className="td">{r.x ? <>{r.x.customer_name}<div className="text-[10.5px] text-[#8A93A0]">{r.x.v.name} {r.x.v.color}</div></> : "—"}</td>
                  <td data-label="Khách lẻ" className="td font-semibold">{r.ten}<div className="text-[10.5px] font-normal text-[#8A93A0]">{r.dc}</div></td>
                  <td data-label="Liên hệ" className="td">{r.sdt}<div className="text-[10.5px] text-[#8A93A0]">{r.email}</div></td>
                  <td data-label="Pin" data-m={r.pin ? undefined : "hide"} className="td">{r.pin}</td>
                  <td data-m="nolabel full" className="td">{r.loi.length ? <span className="text-danger">✗ {r.loi.join("; ")}</span> : <span className="text-[#0E7A4A]">✓ Hợp lệ</span>}</td>
                </tr>))}</tbody>
            </table></div>
            <div className="flex gap-2 mt-3"><button className="btn-ok" disabled={busy || !hopLe.length} onClick={nhap}>{busy ? "Đang nhập…" : `Nhập ${hopLe.length} khách lẻ`}</button><button className="btn-ghost" disabled={busy} onClick={() => setRows(null)}>Hủy</button></div>
          </>)}

        {kq && (
          <div className={`rounded-lg text-[13px] p-3 ${kq.loi.length ? "bg-[#FDF1DF] text-[#7A4A00]" : "bg-[#E5F6EE] text-[#0E7A4A]"}`}>
            ✓ Đã nhập <b>{kq.ok}</b> khách lẻ — các xe này đã rời danh sách ký gửi.{kq.buPin > 0 ? <> Bù thuê pin cộng sổ khách buôn: <b>{kq.buPin.toLocaleString("vi-VN")} đ</b>.</> : ""}
            {kq.loi.length > 0 && <ul className="list-disc pl-5 mt-1.5 text-danger text-[12px]">{kq.loi.map((l, i) => <li key={i}>{l}</li>)}</ul>}
          </div>)}
      </div>
    </div>
  );
}
