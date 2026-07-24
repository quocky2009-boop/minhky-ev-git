"use client";
import { docTien } from "@/lib/print";

// In BIÊN NHẬN ĐẶT CỌC XE — khổ A5, 2 liên (cửa hàng + khách)
export function printBienNhanCoc({ coc, vehicles, locations, settings }) {
  const v = vehicles.find((x) => x.id === coc.vehicle_id);
  const loc = locations.find((l) => l.code === coc.location_code);
  const money = (n) => Number(n || 0).toLocaleString("vi-VN") + " đ";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const d = new Date(coc.created_at);
  const ngay = `ngày ${d.getDate()} tháng ${d.getMonth() + 1} năm ${d.getFullYear()}`;
  const hanGiu = new Date(coc.hold_until).toLocaleDateString("vi-VN");

  const cty = settings?.cty_ten || "HỆ THỐNG XE ĐIỆN MINH KỲ";
  const diachi = settings?.cty_diachi || "";
  const sdt = settings?.cty_sdt || "";

  const lien = (ten) => `
  <section class="page">
    <div class="head">
      <div class="cty">${esc(cty)}</div>
      ${diachi ? `<div class="sub">${esc(diachi)}</div>` : ""}
      ${sdt ? `<div class="sub">ĐT: ${esc(sdt)}</div>` : ""}
      <h1>BIÊN NHẬN ĐẶT CỌC XE</h1>
      <div class="ma">Số phiếu: <b>${esc(coc.code)}</b> · ${ngay}</div>
      <div class="lien">(${ten})</div>
    </div>

    <table class="info">
      <tr><td class="k">Khách hàng</td><td class="v"><b>${esc(coc.customer_name)}</b></td></tr>
      <tr><td class="k">Điện thoại</td><td class="v">${esc(coc.customer_phone)}</td></tr>
      <tr><td class="k">Xe đặt cọc</td><td class="v"><b>${esc(v ? `${v.brand} ${v.name} · ${v.color}` : coc.vehicle_id)}</b></td></tr>
      <tr><td class="k">Số khung</td><td class="v mono"><b>${esc(coc.frame_number)}</b></td></tr>
      <tr><td class="k">Nơi giữ xe</td><td class="v">${esc(loc?.name || coc.location_code)}</td></tr>
      <tr><td class="k">Giữ xe đến ngày</td><td class="v"><b>${hanGiu}</b></td></tr>
      ${coc.note ? `<tr><td class="k">Ghi chú</td><td class="v">${esc(coc.note)}</td></tr>` : ""}
    </table>

    <div class="tien">
      <div class="row"><span>Số tiền đặt cọc</span><b class="big">${money(coc.amount)}</b></div>
      <div class="chu">Bằng chữ: <i>${esc(docTien(coc.amount))}</i></div>
    </div>

    <div class="dieu">
      <div class="dt">Điều khoản:</div>
      <ol>
        <li>Cửa hàng giữ xe có số khung nêu trên cho khách đến hết ngày <b>${hanGiu}</b>.</li>
        <li>Quá thời hạn trên mà khách không đến nhận xe, cửa hàng có quyền bán xe cho khách khác.</li>
        <li>Tiền cọc được trừ vào tiền mua xe khi khách hoàn tất thủ tục nhận xe.</li>
        <li>Trường hợp khách đổi ý không mua, tiền cọc xử lý theo thỏa thuận hai bên.</li>
      </ol>
    </div>

    <div class="sign">
      <div><div class="st">KHÁCH HÀNG</div><div class="sn">(ký, ghi rõ họ tên)</div></div>
      <div><div class="st">NGƯỜI NHẬN CỌC</div><div class="sn">(ký, ghi rõ họ tên)</div><div class="nv">${esc(coc.created_by_name || "")}</div></div>
    </div>
  </section>`;

  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8">
  <title>Biên nhận cọc ${esc(coc.code)}</title>
  <style>
    *{box-sizing:border-box}
    body{font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;margin:0;color:#111;font-size:13px}
    .page{padding:12mm 12mm 8mm;page-break-after:always}
    .page:last-child{page-break-after:auto}
    .head{text-align:center;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:10px}
    .cty{font-size:13px;font-weight:800;letter-spacing:.3px}
    .sub{font-size:11px;color:#555}
    h1{font-size:19px;margin:8px 0 3px;letter-spacing:.5px}
    .ma{font-size:12px;color:#333}
    .lien{font-size:11px;color:#777;font-style:italic;margin-top:2px}
    table.info{width:100%;border-collapse:collapse;margin-bottom:10px}
    table.info td{padding:5px 6px;border-bottom:1px dashed #ccc;vertical-align:top}
    td.k{color:#555;width:36%}
    td.v{text-align:right}
    .mono{font-family:"SF Mono",Menlo,Consolas,monospace}
    .tien{border:2px solid #111;border-radius:6px;padding:8px 10px;margin-bottom:10px}
    .tien .row{display:flex;justify-content:space-between;align-items:center}
    .big{font-size:20px}
    .chu{font-size:11.5px;color:#444;margin-top:3px}
    .dieu{font-size:11.5px;margin-bottom:14px}
    .dt{font-weight:700;margin-bottom:2px}
    .dieu ol{margin:0;padding-left:18px}
    .dieu li{margin-bottom:2px}
    .sign{display:flex;justify-content:space-around;text-align:center;margin-top:6px}
    .sign>div{min-width:150px}
    .st{font-weight:800;font-size:12px}
    .sn{font-size:10.5px;color:#777;margin-bottom:38px}
    .nv{font-size:12px;font-weight:600}
    @media print{.noprint{display:none}@page{size:A5;margin:0}}
  </style></head><body>
    <div class="noprint" style="padding:10px 12mm;background:#f2f5f9;display:flex;gap:10px;align-items:center">
      <button onclick="window.print()" style="padding:8px 16px;font-weight:700;background:#1f6feb;color:#fff;border:0;border-radius:8px;cursor:pointer">🖨 In biên nhận</button>
      <span style="color:#555">Phiếu <b>${esc(coc.code)}</b> — in 2 liên (cửa hàng giữ 1, khách giữ 1). Khổ A5.</span>
    </div>
    ${lien("Liên 1: Cửa hàng giữ")}
    ${lien("Liên 2: Khách hàng giữ")}
  </body></html>`;

  const w = window.open("", "_blank");
  if (!w) { alert("Trình duyệt chặn cửa sổ in. Cho phép popup rồi thử lại."); return; }
  w.document.write(html); w.document.close();
}
