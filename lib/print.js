"use client";

// Doc so tien bang chu tieng Viet
const DOC_SO = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];
function doc3so(n, full) {
  const tr = Math.floor(n / 100), ch = Math.floor((n % 100) / 10), dv = n % 10;
  let out = "";
  if (full || tr > 0) out += DOC_SO[tr] + " trăm";
  if (ch > 1) { out += " " + DOC_SO[ch] + " mươi"; if (dv === 1) out += " mốt"; else if (dv === 5) out += " lăm"; else if (dv > 0) out += " " + DOC_SO[dv]; }
  else if (ch === 1) { out += " mười"; if (dv === 5) out += " lăm"; else if (dv > 0) out += " " + DOC_SO[dv]; }
  else if (dv > 0) { if (out) out += " lẻ"; out += " " + DOC_SO[dv]; }
  return out.trim();
}
function docTien(n) {
  if (!n || n <= 0) return "Không đồng";
  const ty = Math.floor(n / 1e9), tr = Math.floor((n % 1e9) / 1e6), ng = Math.floor((n % 1e6) / 1e3), le = n % 1e3;
  let out = "";
  if (ty > 0) out += doc3so(ty, false) + " tỷ ";
  if (tr > 0) out += doc3so(tr, ty > 0) + " triệu ";
  if (ng > 0) out += doc3so(ng, ty > 0 || tr > 0) + " nghìn ";
  if (le > 0) out += doc3so(le, out !== "");
  out = out.trim() + " đồng";
  return out.charAt(0).toUpperCase() + out.slice(1);
}

export async function printOrder({ supabase, o, vehicles, locations, settings, notify }) {
    const { data: its } = await supabase.from("sale_items").select("*").eq("sale_code", o.code);
    const v = vehicles.find((x) => x.id === o.vehicle_id);
    const l = locations.find((x) => x.code === o.location_code);
    const items = its || [];
    const kem = items.reduce((sm, x) => sm + x.amount, 0);
    const tienXe = o.sale_price * o.quantity;
    const tong = tienXe + kem;
    const paid = o.paid_amount || 0;
    const row = (t, r) => `<tr><td>${t}</td><td class="r">${r}</td></tr>`;
    const money = (n) => new Intl.NumberFormat("vi-VN").format(n) + " đ";
    const html = `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><title>${o.code}</title><style>
      *{margin:0;padding:0;box-sizing:border-box;font-family:'Segoe UI',Arial,sans-serif}
      body{padding:24px;max-width:720px;margin:0 auto;color:#111;font-size:13px;line-height:1.5}
      .hd{display:flex;justify-content:space-between;gap:12px;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:12px}
      .cty{font-size:15px;font-weight:800}.sub{font-size:11.5px;color:#444}
      h1{font-size:19px;text-align:center;margin:14px 0 2px;letter-spacing:.5px}
      .mid{text-align:center;font-size:12px;color:#444;margin-bottom:14px}
      h2{font-size:12.5px;text-transform:uppercase;margin:14px 0 6px;border-bottom:1px solid #bbb;padding-bottom:3px}
      table{width:100%;border-collapse:collapse}
      .kv td{padding:2.5px 0;vertical-align:top}.kv td:first-child{color:#555;width:34%}
      .bill td,.bill th{border:1px solid #999;padding:5px 8px}.bill th{background:#f0f0f0;text-align:left;font-size:12px}
      .r{text-align:right}.b{font-weight:800}
      .chu{font-style:italic;margin-top:6px}
      .sig{display:flex;justify-content:space-between;margin-top:34px;text-align:center}
      .sig div{width:45%}.sig .t{font-weight:700}.sig .s{font-size:11px;color:#555;margin-bottom:56px}
      .ft{text-align:center;font-size:11.5px;color:#555;margin-top:24px;border-top:1px dashed #aaa;padding-top:8px}
      @media print{body{padding:8px}.noprint{display:none}}
    </style></head><body>
      <div class="hd">
        <div>
          <div class="cty">${settings.cty_ten || "HỆ THỐNG XE ĐIỆN MINH KỲ"}</div>
          <div class="sub">${settings.cty_diachi || ""}</div>
          <div class="sub">${settings.cty_sdt ? "ĐT: " + settings.cty_sdt : ""}</div>
        </div>
        <div class="sub" style="text-align:right">Số phiếu: <b>${o.code}</b><br/>Ngày: ${new Date(o.sale_date).toLocaleDateString("vi-VN")}<br/>Điểm bán: ${l?.name || o.location_code}</div>
      </div>
      <h1>PHIẾU XUẤT BÁN XE</h1>
      <div class="mid">(Kiêm biên nhận giao xe cho khách hàng)</div>
      <h2>Thông tin khách hàng</h2>
      <table class="kv">
        ${row("Họ tên khách hàng", `<b>${o.customer_name}</b>`)}
        ${row("Số điện thoại", o.customer_phone)}
        ${o.customer_cccd ? row("CCCD", o.customer_cccd) : ""}
        ${o.customer_address ? row("Địa chỉ", o.customer_address) : ""}
      </table>
      <h2>Thông tin xe</h2>
      <table class="kv">
        ${row("Loại xe", `<b>${v ? v.brand + " " + v.name + " — màu " + v.color : o.vehicle_id}</b>`)}
        ${row("Số khung", `<b style="font-family:monospace">${o.frame_number}</b>`)}
        ${row("Số lượng", o.quantity + " xe")}
      </table>
      <h2>Thanh toán</h2>
      <table class="bill">
        <tr><th>Nội dung</th><th style="width:50px">SL</th><th style="width:100px" class="r">Đơn giá</th><th style="width:105px" class="r">Thành tiền</th><th style="width:95px">Hình thức TT</th></tr>
        <tr><td>${v ? v.name + " " + v.color : o.vehicle_id}</td><td>${o.quantity}</td><td class="r">${money(o.sale_price)}</td><td class="r">${money(tienXe)}</td><td>${o.payment_method || ""}</td></tr>
        ${items.map((x) => `<tr><td>${x.name}</td><td>${x.qty}</td><td class="r">${money(x.unit_price)}</td><td class="r">${money(x.amount)}</td><td>${x.payment_method || o.payment_method || ""}</td></tr>`).join("")}
        <tr><td colspan="3" class="r b">TỔNG CỘNG</td><td class="r b">${money(tong)}</td><td></td></tr>
        <tr><td colspan="3" class="r">Đã thanh toán</td><td class="r">${money(paid)}</td><td></td></tr>
        <tr><td colspan="3" class="r b">Còn lại</td><td class="r b">${money(Math.max(tong - paid, 0))}</td><td></td></tr>
      </table>
      ${(() => {
        const m = {}; const hx = o.payment_method || "";
        if (tienXe > 0 && hx) m[hx] = (m[hx] || 0) + tienXe;
        items.forEach((x) => { const k = x.payment_method || hx; if (x.amount > 0 && k) m[k] = (m[k] || 0) + x.amount; });
        const ks = Object.keys(m);
        return ks.length > 1 ? `<div style="margin-top:5px;font-size:12px"><b>Thu theo hình thức:</b> ${ks.map((k) => k + " " + money(m[k])).join(" · ")}</div>` : "";
      })()}
      <div class="chu">Bằng chữ (tổng cộng): <b>${docTien(tong)}</b></div>
      ${o.extra?.tra_gop_cong_ty ? `<div style="margin-top:6px"><b>Trả góp:</b> ${o.extra.tra_gop_cong_ty}${Number(o.extra.tra_gop_so_tien) > 0 ? " — số tiền trả góp " + money(Number(o.extra.tra_gop_so_tien)) : ""}</div>` : ""}
      ${o.note ? `<div style="margin-top:8px"><b>Ghi chú:</b> ${o.note}</div>` : ""}
      <div class="sig">
        <div><div class="t">KHÁCH HÀNG</div><div class="s">(Ký, ghi rõ họ tên)</div><div>${o.customer_name}</div></div>
        <div><div class="t">NHÂN VIÊN BÁN HÀNG</div><div class="s">(Ký, ghi rõ họ tên)</div><div>${o.seller_name}</div></div>
      </div>
      <div class="ft">${settings.phieu_footer || "Cảm ơn Quý khách đã tin tưởng Minh Kỳ EV. Kính chúc Quý khách thượng lộ bình an!"}</div>
      <div class="noprint" style="text-align:center;margin-top:18px"><button onclick="window.print()" style="padding:10px 26px;font-size:14px;font-weight:700;cursor:pointer">🖨 In / Lưu PDF</button></div>
    </body></html>`;
    const w = window.open("", "_blank");
    if (!w) return notify("Trình duyệt chặn cửa sổ mới — cho phép popup cho trang này rồi bấm In lại.", "err");
    w.document.write(html); w.document.close();
    setTimeout(() => { try { w.print(); } catch (e) {} }, 400);
  }
