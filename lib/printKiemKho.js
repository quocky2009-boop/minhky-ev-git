"use client";

// In "Phieu kiem kho theo so khung" — tung diem 1 trang, danh sach so khung
// da co san + cot tick / ghi chu, cuoi moi trang co phan tong hop thua-thieu.
// scope: "loc" (1 diem) | "region" (nhieu diem trong khu vuc) | "all" (toan bo)
export async function printPhieuKiemKho({ supabase, scope, code, label, locations, vehicles, settings }) {
  // Xac dinh danh sach diem can in
  let locs = [];
  if (scope === "loc") locs = locations.filter((l) => l.code === code);
  else if (scope === "region") locs = locations.filter((l) => l.region === code);
  else locs = [...locations];
  locs = locs.slice().sort((a, b) => (a.region || "").localeCompare(b.region || "") || a.name.localeCompare(b.name));

  if (locs.length === 0) { alert("Không có điểm nào để in."); return; }

  // Lay xe ton theo tung diem
  const codes = locs.map((l) => l.code);
  const { data: units } = await supabase.from("vehicle_units").select("*")
    .in("location_code", codes).in("status", ["TON_KHO", "DANG_CHUYEN"]).order("vehicle_id");
  const all = units || [];

  const vName = (id) => { const v = vehicles.find((x) => x.id === id); return v ? `${v.name} · ${v.color}` : id; };
  const vBrand = (id) => vehicles.find((x) => x.id === id)?.brand || "";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const today = new Date().toLocaleDateString("vi-VN");
  const cty = settings?.cty_ten || "HỆ THỐNG XE ĐIỆN MINH KỲ";

  const pages = locs.map((l) => {
    const rows = all.filter((u) => u.location_code === l.code)
      .sort((a, b) => vBrand(a.vehicle_id).localeCompare(vBrand(b.vehicle_id)) ||
                      vName(a.vehicle_id).localeCompare(vName(b.vehicle_id)) ||
                      a.frame_number.localeCompare(b.frame_number));
    const body = rows.length === 0
      ? `<tr><td colspan="6" style="text-align:center;color:#888;padding:14px">Hệ thống ghi nhận điểm này KHÔNG còn xe tồn. Nếu thực tế có xe → ghi vào phần "Xe thừa" bên dưới.</td></tr>`
      : rows.map((u, i) => `<tr>
          <td class="c">${i + 1}</td>
          <td>${esc(vBrand(u.vehicle_id))}</td>
          <td>${esc(vName(u.vehicle_id))}</td>
          <td class="mono">${esc(u.frame_number)}${u.is_placeholder ? ' <span class="tag">SK tạm</span>' : ""}${u.status === "DANG_CHUYEN" ? ' <span class="tag">đang chuyển</span>' : ""}</td>
          <td class="tick"></td>
          <td></td>
        </tr>`).join("");

    return `<section class="page">
      <div class="head">
        <div>
          <div class="cty">${esc(cty)}</div>
          <h1>PHIẾU KIỂM KHO THEO SỐ KHUNG</h1>
        </div>
        <div class="meta">Ngày kiểm: ${today}<br/>Hệ thống ghi nhận: <b>${rows.length}</b> xe</div>
      </div>
      <div class="diem"><b>Điểm kiểm:</b> ${esc(l.name)} <span class="muted">(${esc(l.code)})</span> · Khu vực: ${esc(l.region || "-")} · Loại: ${esc(l.type || "-")}</div>
      <table>
        <thead><tr>
          <th style="width:34px">TT</th><th style="width:70px">Hãng</th><th>Tên xe · Màu</th>
          <th style="width:200px">Số khung</th><th style="width:44px">Có ✓</th><th style="width:150px">Ghi chú</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>

      <div class="sum">
        <div class="box">
          <div class="bt">A. XE THIẾU (hệ thống có, thực tế KHÔNG thấy)</div>
          <div class="hint">Sau khi đi hết xe, số khung nào ở bảng trên chưa tick "Có ✓" = xe thiếu. Liệt kê lại số cuối:</div>
          <div class="lines"></div>
        </div>
        <div class="box">
          <div class="bt">B. XE THỪA (thực tế có, KHÔNG nằm trong bảng)</div>
          <div class="hint">Xe tìm thấy nhưng không có trong danh sách điểm này. Ghi số khung + tên xe:</div>
          <div class="lines"></div>
        </div>
      </div>

      <div class="tally">
        Tổng thực đếm: ______ xe &nbsp;|&nbsp; Khớp: ______ &nbsp;|&nbsp; Thiếu (A): ______ &nbsp;|&nbsp; Thừa (B): ______
      </div>
      <div class="sign">
        <div>Người kiểm kho<br/><span class="muted">(ký, ghi rõ họ tên)</span></div>
        <div>Cửa hàng trưởng<br/><span class="muted">(ký, ghi rõ họ tên)</span></div>
      </div>
    </section>`;
  }).join("");

  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Phiếu kiểm kho — ${esc(label)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; margin: 0; color: #111; font-size: 13px; }
    .page { padding: 16mm 12mm; page-break-after: always; }
    .page:last-child { page-break-after: auto; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 8px; }
    .cty { font-size: 12px; color: #444; font-weight: 700; letter-spacing: .3px; }
    h1 { font-size: 18px; margin: 3px 0 0; }
    .meta { text-align: right; font-size: 12px; color: #333; }
    .diem { margin: 10px 0; padding: 7px 10px; background: #f2f5f9; border-radius: 6px; }
    .muted { color: #888; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #bbb; padding: 5px 7px; text-align: left; vertical-align: top; }
    th { background: #eaeef3; font-size: 11px; text-transform: uppercase; letter-spacing: .3px; }
    td.c, td.tick { text-align: center; }
    td.tick { height: 26px; }
    .mono { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 12px; font-weight: 700; }
    .tag { display: inline-block; font-size: 9px; background: #fde9c8; color: #8a5200; padding: 0 4px; border-radius: 4px; font-weight: 700; vertical-align: middle; }
    .sum { display: flex; gap: 10px; margin-top: 12px; }
    .box { flex: 1; border: 1px solid #bbb; border-radius: 6px; padding: 8px 10px; }
    .bt { font-weight: 800; font-size: 12px; }
    .hint { font-size: 10.5px; color: #666; margin: 3px 0 6px; }
    .lines { min-height: 66px; background-image: repeating-linear-gradient(#fff, #fff 21px, #ccc 22px); }
    .tally { margin-top: 10px; padding: 7px 10px; border: 1px dashed #999; border-radius: 6px; font-weight: 600; font-size: 12px; }
    .sign { display: flex; justify-content: space-around; margin-top: 22px; text-align: center; font-weight: 700; font-size: 12px; }
    .sign > div { min-width: 200px; }
    @media print { .noprint { display: none; } }
  </style></head>
  <body>
    <div class="noprint" style="padding:10px 12mm;background:#f2f5f9;display:flex;gap:10px;align-items:center">
      <button onclick="window.print()" style="padding:8px 16px;font-weight:700;background:#1f6feb;color:#fff;border:0;border-radius:8px;cursor:pointer">🖨 In ${locs.length} phiếu</button>
      <span style="color:#555">Phạm vi: <b>${esc(label)}</b> — ${locs.length} điểm, ${all.length} xe. Mỗi điểm 1 trang.</span>
    </div>
    ${pages}
  </body></html>`;

  const w = window.open("", "_blank");
  if (!w) { alert("Trình duyệt chặn cửa sổ in. Cho phép popup rồi thử lại."); return; }
  w.document.write(html); w.document.close();
}
