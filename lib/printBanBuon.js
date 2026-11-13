"use client";
import { docTien } from "@/lib/print";

// IN DON BAN BUON (xac nhan dat hang — chua can so khung) va BIEN BAN BAN GIAO XE cho khach buon.
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const money = (n) => new Intl.NumberFormat("vi-VN").format(Math.round(Number(n) || 0)) + " đ";
const ngay = (d) => (d ? new Date(d).toLocaleDateString("vi-VN") : "");
const coGiaFix = (l) => l.gia_ban !== "" && l.gia_ban !== null && l.gia_ban !== undefined;
const donGia = (l) => (coGiaFix(l) ? Number(l.gia_ban) || 0 : (Number(l.gia_niem_yet) || 0) - Math.round((Number(l.gia_niem_yet) || 0) * (Number(l.ck_pct) || 0) / 100));

const CSS = `
  *{margin:0;padding:0;box-sizing:border-box;font-family:'Segoe UI',Arial,sans-serif}
  body{padding:24px;max-width:820px;margin:0 auto;color:#111;font-size:13px;line-height:1.5}
  .hd{display:flex;justify-content:space-between;gap:12px;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:12px}
  .cty{font-size:15px;font-weight:800}.sub{font-size:11.5px;color:#444}
  h1{font-size:19px;text-align:center;margin:14px 0 2px;letter-spacing:.5px}
  .mid{text-align:center;font-size:12px;color:#444;margin-bottom:14px}
  h2{font-size:12.5px;text-transform:uppercase;margin:14px 0 6px;border-bottom:1px solid #bbb;padding-bottom:3px}
  table{width:100%;border-collapse:collapse}
  .kv td{padding:2.5px 0;vertical-align:top}.kv td:first-child{color:#555;width:26%}
  .bill td,.bill th{border:1px solid #999;padding:5px 7px;vertical-align:top}.bill th{background:#f0f0f0;text-align:left;font-size:11.5px}
  .r{text-align:right}.c{text-align:center}.b{font-weight:800}.mono{font-family:Consolas,monospace;font-size:12.5px}
  .chu{font-style:italic;margin-top:6px}.note{margin-top:8px}
  ol.dk{margin:4px 0 0 18px}ol.dk li{margin-bottom:2px}
  .ck{display:inline-block;width:12px;height:12px;border:1px solid #333;margin-right:6px;vertical-align:-1px}
  .sig{display:flex;justify-content:space-between;gap:10px;margin-top:30px;text-align:center}
  .sig div{flex:1}.sig .t{font-weight:700}.sig .s{font-size:11px;color:#555;margin-bottom:64px}
  .ft{text-align:center;font-size:11.5px;color:#555;margin-top:24px;border-top:1px dashed #aaa;padding-top:8px}
  @media print{body{padding:6px}.noprint{display:none}tr{page-break-inside:avoid}}
`;
const dau = (settings, phai) => `<div class="hd"><div>
    <div class="cty">${esc(settings.cty_ten || "HỆ THỐNG XE ĐIỆN MINH KỲ")}</div>
    <div class="sub">${esc(settings.cty_diachi || "")}</div>
    <div class="sub">${settings.cty_sdt ? "ĐT: " + esc(settings.cty_sdt) : ""}</div>
  </div><div class="sub" style="text-align:right">${phai}</div></div>`;
const moIn = (html, notify) => {
  const w = window.open("", "_blank");
  if (!w) return notify("Trình duyệt chặn cửa sổ mới — cho phép popup cho trang này rồi bấm In lại.", "err");
  w.document.write(html); w.document.close();
};
const nutIn = `<div class="noprint" style="text-align:center;margin-top:18px"><button onclick="window.print()" style="padding:10px 26px;font-size:14px;font-weight:700;cursor:pointer">🖨 In / Lưu PDF</button></div>`;
const layKhach = async (supabase, id) => { const { data } = await supabase.from("customers").select("code,name,phone,address").eq("id", id).maybeSingle(); return data || {}; };

// 1) DON BAN BUON — in duoc ngay khi chot don, chua can ghep so khung
export async function printDonBuon({ supabase, lo, vehicles, locations, settings, notify }) {
  const h = lo.h; const kh = await layKhach(supabase, h.customer_id);
  const vOf = (id) => vehicles.find((v) => v.id === id) || {};
  const l = locations.find((x) => x.code === h.location_code);
  const daGiao = (id) => lo.orders.filter((o) => o.don_buon_dong_id === id && !["Đã hủy", "Đã trả hàng"].includes(o.status)).length;
  const rows = lo.dong.map((d) => { const gn = Number(d.gia_niem_yet) || 0; const dg = donGia(d); return { d, v: vOf(d.vehicle_id), gn, dg, ck: gn - dg, g: daGiao(d.id) }; });
  const T = rows.reduce((t, r) => ({ sl: t.sl + r.d.qty, g: t.g + r.g, ny: t.ny + r.gn * r.d.qty, ck: t.ck + r.ck * r.d.qty, tt: t.tt + r.dg * r.d.qty }), { sl: 0, g: 0, ny: 0, ck: 0, tt: 0 });
  const phaiTra = Number(h.phai_tra) || T.tt; const lech = phaiTra - T.tt;
  const tts = (lo.tt || []).filter((t) => !t.is_reversed);
  const html = `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><title>${esc(h.code)}</title><style>${CSS}</style></head><body>
    ${dau(settings, `Số đơn: <b>${esc(h.code)}</b><br/>Ngày chốt: ${ngay(h.ngay_chot)}${l ? `<br/>Cửa hàng: ${esc(l.name)}` : ""}`)}
    <h1>ĐƠN BÁN BUÔN</h1>
    <div class="mid">(Xác nhận đặt hàng — số khung ghi nhận khi giao xe, theo Biên bản bàn giao)</div>
    <h2>Bên mua (khách buôn)</h2>
    <table class="kv">
      <tr><td>Tên khách buôn</td><td><b>${esc(h.customer_name || kh.name)}</b>${kh.code ? ` <span class="sub">(${esc(kh.code)})</span>` : ""}</td></tr>
      ${kh.phone ? `<tr><td>Số điện thoại</td><td>${esc(kh.phone)}</td></tr>` : ""}
      ${kh.address ? `<tr><td>Địa chỉ</td><td>${esc(kh.address)}</td></tr>` : ""}
    </table>
    <h2>Xe đặt mua</h2>
    <table class="bill">
      <tr><th class="c" style="width:30px">STT</th><th>Tên xe · màu</th><th class="c" style="width:36px">SL</th><th class="r">Giá niêm yết</th><th class="c" style="width:48px">CK %</th><th class="r">Tiền CK/xe</th><th class="r">Giá bán/xe</th><th class="r">Thành tiền</th></tr>
      ${rows.map((r, i) => `<tr><td class="c">${i + 1}</td><td><b>${esc(r.v.name || r.d.vehicle_id)}</b>${r.v.color ? " · " + esc(r.v.color) : ""}${r.v.brand ? `<div class="sub">${esc(r.v.brand)}</div>` : ""}</td>
        <td class="c">${r.d.qty}</td><td class="r">${money(r.gn)}</td><td class="c">${r.gn > 0 ? (Math.round(r.ck / r.gn * 1000) / 10).toLocaleString("vi-VN") + "%" : ""}</td>
        <td class="r">${money(r.ck)}</td><td class="r">${money(r.dg)}</td><td class="r b">${money(r.dg * r.d.qty)}</td></tr>`).join("")}
      <tr><td colspan="2" class="r b">TỔNG CỘNG</td><td class="c b">${T.sl}</td><td class="r">${money(T.ny)}</td><td></td><td class="r">${money(T.ck)}</td><td></td><td class="r b">${money(T.tt)}</td></tr>
      ${lech !== 0 ? `<tr><td colspan="7" class="r">Điều chỉnh trên các xe đã giao (giảm giá thêm, bù thuê pin…)</td><td class="r">${lech > 0 ? "+" : "−"}${money(Math.abs(lech))}</td></tr>` : ""}
      <tr><td colspan="7" class="r b">KHÁCH BUÔN CẦN TRẢ</td><td class="r b">${money(phaiTra)}</td></tr>
      <tr><td colspan="7" class="r">Đã thanh toán</td><td class="r">${money(h.da_tra)}</td></tr>
      <tr><td colspan="7" class="r b">Còn phải trả</td><td class="r b">${money(Math.max(Number(h.con_phai_tra) || 0, 0))}</td></tr>
    </table>
    <div class="chu">Bằng chữ (khách buôn cần trả): <b>${docTien(Math.round(phaiTra))}</b></div>
    <div class="note">Tình trạng giao xe: đã giao <b>${T.g}/${T.sl}</b> xe.</div>
    ${tts.length ? `<h2>Các khoản đã thanh toán</h2><table class="bill"><tr><th style="width:110px">Ngày</th><th>Hình thức</th><th>Ghi chú</th><th class="r" style="width:130px">Số tiền</th></tr>
      ${tts.map((t) => `<tr><td>${ngay(t.created_at)}</td><td>${esc(t.loai === "CAN_TRU" ? "Cấn trừ công nợ khách buôn" : t.method || "")}${t.cash_txn_code ? ` <span class="sub">(${esc(t.cash_txn_code)})</span>` : ""}</td><td>${esc(t.note || "")}</td><td class="r">${money(t.amount)}</td></tr>`).join("")}</table>` : ""}
    ${h.note ? `<div class="note"><b>Ghi chú:</b> ${esc(h.note)}</div>` : ""}
    <div class="sig">
      <div><div class="t">BÊN MUA (KHÁCH BUÔN)</div><div class="s">(Ký, ghi rõ họ tên)</div><div>${esc(h.customer_name || "")}</div></div>
      <div><div class="t">NHÂN VIÊN LẬP ĐƠN</div><div class="s">(Ký, ghi rõ họ tên)</div><div>${esc(h.seller_name || h.created_by_name || "")}</div></div>
      <div><div class="t">BÊN BÁN</div><div class="s">(Ký, đóng dấu)</div><div></div></div>
    </div>
    <div class="ft">${esc(settings.phieu_footer || "Cảm ơn Quý khách đã tin tưởng Minh Kỳ EV.")}</div>
    ${nutIn}
  </body></html>`;
  moIn(html, notify);
}

// 2) BIEN BAN BAN GIAO XE — cac xe da giao (da co so khung). ngayGiao: "" = tat ca xe da giao, hoac yyyy-mm-dd = chi dot giao ngay do
export async function printBienBanGiaoXe({ supabase, lo, vehicles, locations, settings, notify, ngayGiao = "" }) {
  const h = lo.h;
  const ds = lo.orders.filter((o) => !["Đã hủy", "Đã trả hàng"].includes(o.status) && (!ngayGiao || o.sale_date === ngayGiao))
    .sort((a, b) => String(a.sale_date).localeCompare(String(b.sale_date)) || a.id - b.id);
  if (!ds.length) return notify("Chưa có xe nào đã giao để in biên bản.", "err");
  const kh = await layKhach(supabase, h.customer_id);
  const frames = ds.map((o) => o.frame_number).filter(Boolean);
  const may = {};
  if (frames.length) { const { data } = await supabase.from("vehicle_units").select("frame_number,engine_number").in("frame_number", frames); (data || []).forEach((u) => { may[u.frame_number] = u.engine_number || ""; }); }
  const vOf = (id) => vehicles.find((v) => v.id === id) || {};
  const lName = (c) => locations.find((x) => x.code === c)?.name || c || "";
  const ngays = [...new Set(ds.map((o) => o.sale_date))];
  const theoXe = Object.values(ds.reduce((m, o) => { const v = vOf(o.vehicle_id); const k = o.vehicle_id; m[k] = m[k] || { ten: `${v.name || o.vehicle_id}${v.color ? " " + v.color : ""}`, n: 0 }; m[k].n += Number(o.quantity) || 1; return m; }, {}));
  const tongXe = ds.reduce((s, o) => s + (Number(o.quantity) || 1), 0);
  const html = `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><title>BBGX ${esc(h.code)}</title><style>${CSS}</style></head><body>
    ${dau(settings, `Theo đơn bán buôn: <b>${esc(h.code)}</b><br/>Ngày giao: ${ngays.map(ngay).join(", ")}<br/>Ngày in: ${new Date().toLocaleDateString("vi-VN")}`)}
    <h1>BIÊN BẢN BÀN GIAO XE</h1>
    <div class="mid">(Giao xe cho khách buôn / đại lý)</div>
    <h2>Bên giao</h2>
    <table class="kv">
      <tr><td>Đơn vị</td><td><b>${esc(settings.cty_ten || "HỆ THỐNG XE ĐIỆN MINH KỲ")}</b></td></tr>
      ${settings.cty_diachi ? `<tr><td>Địa chỉ</td><td>${esc(settings.cty_diachi)}</td></tr>` : ""}
      <tr><td>Người giao</td><td>${esc(h.seller_name || h.created_by_name || "")}</td></tr>
    </table>
    <h2>Bên nhận (khách buôn)</h2>
    <table class="kv">
      <tr><td>Tên khách buôn</td><td><b>${esc(h.customer_name || kh.name)}</b>${kh.code ? ` <span class="sub">(${esc(kh.code)})</span>` : ""}</td></tr>
      ${kh.phone ? `<tr><td>Số điện thoại</td><td>${esc(kh.phone)}</td></tr>` : ""}
      ${kh.address ? `<tr><td>Địa chỉ</td><td>${esc(kh.address)}</td></tr>` : ""}
      <tr><td>Người nhận xe</td><td>......................................................&nbsp;&nbsp; SĐT: ..............................</td></tr>
    </table>
    <h2>Danh sách xe bàn giao (${tongXe} xe)</h2>
    <table class="bill">
      <tr><th class="c" style="width:30px">STT</th><th>Tên xe · màu</th><th>Số khung</th><th>Số máy</th><th style="width:74px">Ngày giao</th><th>Kho xuất</th><th style="width:90px">Ghi chú</th></tr>
      ${ds.map((o, i) => { const v = vOf(o.vehicle_id); return `<tr><td class="c">${i + 1}</td><td><b>${esc(v.name || o.vehicle_id)}</b>${v.color ? " · " + esc(v.color) : ""}</td>
        <td class="mono"><b>${esc(o.frame_number || "")}</b></td><td class="mono">${esc(may[o.frame_number] || "")}</td><td>${ngay(o.sale_date)}</td><td>${esc(lName(o.location_code))}</td><td></td></tr>`; }).join("")}
    </table>
    <div class="note"><b>Tổng hợp:</b> ${theoXe.map((x) => `${esc(x.ten)} × ${x.n}`).join(" · ")} — <b>tổng ${tongXe} xe</b>.</div>
    <h2>Giấy tờ, phụ kiện kèm theo mỗi xe</h2>
    <div><span class="ck"></span>Phiếu kiểm tra chất lượng xuất xưởng &nbsp;&nbsp; <span class="ck"></span>Sổ bảo hành / hướng dẫn sử dụng &nbsp;&nbsp; <span class="ck"></span>Chìa khóa: ...... bộ/xe</div>
    <div style="margin-top:3px"><span class="ck"></span>Bộ sạc theo xe &nbsp;&nbsp; <span class="ck"></span>Gương, phụ kiện theo xe &nbsp;&nbsp; <span class="ck"></span>Khác: ..........................................................</div>
    <h2>Xác nhận</h2>
    <ol class="dk">
      <li>Bên nhận đã kiểm tra và nhận đủ số lượng xe, đúng chủng loại, màu sắc và số khung ghi trong biên bản này.</li>
      <li>Xe mới 100%, nguyên vẹn, không trầy xước, móp méo; đủ giấy tờ và phụ kiện đã đánh dấu ở trên.</li>
      <li>Kể từ thời điểm ký nhận, Bên nhận chịu trách nhiệm bảo quản xe. Khi bán xe cho khách lẻ, Bên nhận thông báo thông tin khách lẻ cho Bên giao để xuất hóa đơn và kích hoạt bảo hành.</li>
    </ol>
    <div class="note">Ghi chú khác: ..............................................................................................................................</div>
    <div class="sig">
      <div><div class="t">BÊN NHẬN</div><div class="s">(Ký, ghi rõ họ tên)</div><div></div></div>
      <div><div class="t">BÊN GIAO</div><div class="s">(Ký, ghi rõ họ tên)</div><div>${esc(h.seller_name || h.created_by_name || "")}</div></div>
      <div><div class="t">THỦ KHO / LÁI XE GIAO</div><div class="s">(Ký, ghi rõ họ tên)</div><div></div></div>
    </div>
    <div class="ft">Biên bản lập thành 02 bản, mỗi bên giữ 01 bản có giá trị như nhau.</div>
    ${nutIn}
  </body></html>`;
  moIn(html, notify);
}
