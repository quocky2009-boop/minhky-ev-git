"use client";
import { useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Field, Badge, Toast } from "@/components/ui";
import { errMsg } from "@/lib/format";

const TYPE_LABELS = { text: "Chữ", number: "Số", dropdown: "Danh sách chọn", checkbox: "Tick chọn", formula: "Công thức tự tính" };

export default function CaiDat() {
  const { supabase, profile, loading, settings, customFields, brands, refresh, taxRate, regions } = useCatalog();
  const { toast, notify } = useToast();
  const [tax, setTax] = useState("");
  const [show, setShow] = useState(false);
  const empty = { label: "", field_type: "text", optionsText: "", op: "divide", operand: "TAX", required: false };
  const [f, setF] = useState(empty);
  const [editField, setEditField] = useState(null);
  const [newBrand, setNewBrand] = useState("");
  const [reg, setReg] = useState(null);
  const [hook, setHook] = useState(null);
  const [bk, setBk] = useState(null); // {pk, bh, ftg, dk}

  const saveBk = async () => {
    const cln = (x) => x.split(/\n+/).map((y) => y.trim()).filter(Boolean).join("\n");
    for (const [key, val] of [["phu_kien", cln(bk.pk)], ["bao_hiem", cln(bk.bh)], ["gia_dang_ky", String(Number(bk.dk) || 350000)]]) {
      const { error } = await supabase.rpc("fn_set_setting", { p_key: key, p_value: val });
      if (error) return notify(errMsg(error), "err");
    }
    notify("Đã lưu danh mục bán kèm & trả góp."); setBk(null); refresh();
  };


  const saveHook = async () => {
    const v = hook.trim();
    if (v && !v.startsWith("https://discord.com/api/webhooks/") && !v.startsWith("https://discordapp.com/api/webhooks/"))
      return notify("URL không đúng dạng webhook Discord (bắt đầu bằng https://discord.com/api/webhooks/...).", "err");
    const { error } = await supabase.rpc("fn_set_setting", { p_key: "discord_webhook", p_value: v });
    if (error) return notify(errMsg(error), "err");
    notify(v ? "Đã lưu webhook. Bấm Gửi thử để kiểm tra." : "Đã tắt thông báo Discord.");
    setHook(null); refresh();
  };

  const testHook = async () => {
    const { error } = await supabase.rpc("fn_test_discord");
    if (error) return notify(errMsg(error), "err");
    notify("Đã gửi tin thử — kiểm tra channel Discord trong vài giây.");
  };

  const saveRegions = async () => {
    const clean = reg.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean).join("\n");
    if (!clean) return notify("Cần ít nhất 1 khu vực.", "err");
    const { error } = await supabase.rpc("fn_set_setting", { p_key: "regions", p_value: clean });
    if (error) return notify(errMsg(error), "err");
    notify("Đã lưu danh sách khu vực. Khu vực đang gắn với kho cũ vẫn hiển thị bình thường.");
    setReg(null); refresh();
  };

  const addBrand = async () => {
    if (!newBrand.trim()) return;
    const { error } = await supabase.rpc("fn_them_hang", { p_name: newBrand });
    if (error) return notify(errMsg(error), "err");
    notify(`Đã thêm hãng "${newBrand.trim()}" — dùng được ngay khi thêm xe mới.`);
    setNewBrand(""); refresh();
  };
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const startEditField = (c) => {
    setEditField(c.id);
    setF({
      label: c.label, field_type: c.field_type, required: c.required,
      optionsText: (c.options || []).join("\n"),
      op: c.formula?.op || "divide",
      operand: c.formula ? (c.formula.operand === "TAX" ? "TAX" : String(c.formula.operand)) : "TAX",
    });
    setShow(true);
  };


  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;
  if (!["CEO", "ADMIN"].includes(profile.role)) return <div className="card">Chỉ BGĐ/Admin được vào phần cài đặt.</div>;

  const saveTax = async () => {
    const pct = parseFloat(tax);
    if (isNaN(pct) || pct < 0 || pct > 100) return notify("Nhập thuế suất dạng số phần trăm, ví dụ 8 hoặc 10.", "err");
    const { error } = await supabase.rpc("fn_set_setting", { p_key: "tax_rate", p_value: String(pct / 100) });
    if (error) return notify(errMsg(error), "err");
    notify(`Đã đổi thuế suất thành ${pct}%. Các trường "trước thuế" sẽ tính theo mức mới.`);
    setTax(""); refresh();
  };

  const saveField = async () => {
    if (!f.label.trim()) return notify("Nhập tên trường.", "err");
    const p = { label: f.label.trim(), field_type: f.field_type, required: f.required };
    if (editField) p.id = String(editField);
    if (f.field_type === "dropdown") {
      p.options = f.optionsText.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
      if (p.options.length === 0) return notify("Nhập ít nhất 1 lựa chọn cho danh sách.", "err");
    }
    if (f.field_type === "formula") {
      p.formula = { base: "sale_price", op: f.op, operand: f.operand === "TAX" ? "TAX" : Number(f.operand) };
      if (f.operand !== "TAX" && (isNaN(Number(f.operand)) || Number(f.operand) === 0)) return notify("Toán hạng phải là số khác 0 hoặc chọn Thuế.", "err");
    }
    const { error } = await supabase.rpc("fn_save_custom_field", { p });
    if (error) return notify(errMsg(error), "err");
    notify(editField ? `Đã cập nhật trường "${f.label}".` : `Đã thêm trường "${f.label}" vào form đơn bán.`);
    setF(empty); setEditField(null); setShow(false); refresh();
  };

  const remove = async (c) => {
    if (!confirm(`Ẩn trường "${c.label}" khỏi form đơn bán? Dữ liệu cũ vẫn được giữ nguyên trong các đơn đã lưu.`)) return;
    const { error } = await supabase.rpc("fn_delete_custom_field", { p_id: c.id });
    if (error) return notify(errMsg(error), "err");
    notify(`Đã ẩn trường "${c.label}".`); refresh();
  };

  const opText = { divide: "÷", multiply: "×", add: "+", subtract: "−" };

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="card">
        <div className="font-extrabold mb-1">Thuế suất GTGT</div>
        <p className="text-xs text-[#5A6572] mb-3">Đang áp dụng: <b className="text-brand">{Math.round(taxRate * 1000) / 10}%</b>. Dùng cho các trường công thức "trước thuế" (giá trước thuế = giá bán ÷ (1 + thuế)).</p>
        <div className="flex gap-2 items-center">
          <input type="number" className="inp !w-32" placeholder="VD: 8 hoặc 10" value={tax} onChange={(e) => setTax(e.target.value)} />
          <span className="text-sm">%</span>
          <button className="btn-primary" onClick={saveTax}>Lưu thuế suất</button>
        </div>
      </div>

      <div className="card">
        <div className="font-extrabold mb-1">Danh mục hãng xe ({brands.length})</div>
        <p className="text-xs text-[#5A6572] mb-3">Hãng thêm ở đây sẽ xuất hiện trong dropdown chọn hãng khi thêm/sửa xe ở Danh mục xe.</p>
        <div className="flex gap-2 items-center flex-wrap">
          <div className="flex gap-1.5 flex-wrap">{brands.map((b) => <Badge key={b.name} tone="blue">{b.name}</Badge>)}</div>
          <input className="inp !w-44 !py-1.5 !text-xs" placeholder="Tên hãng mới…" value={newBrand} onChange={(e) => setNewBrand(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addBrand()} />
          <button className="btn-ghost !py-1.5 !text-xs" onClick={addBrand}>+ Thêm hãng</button>
        </div>
      </div>

      <div className="card">
        <div className="font-extrabold mb-1">Thông báo Discord {settings.discord_webhook ? <Badge tone="green">Đang bật</Badge> : <Badge tone="gray">Chưa bật</Badge>}</div>
        <p className="text-xs text-[#5A6572] mb-3">Mọi biến động tồn kho (nhập, bán, điều chuyển, điều chỉnh, kiểm kê) sẽ gửi ngay vào channel Discord, kèm xe, kho, tồn trước → sau, người thao tác, số phiếu. Lấy URL: mở Discord → chuột phải channel → Chỉnh sửa kênh → Tích hợp (Integrations) → Webhook → Tạo webhook → Sao chép URL.</p>
        {hook === null ? (
          <div className="flex gap-2 items-center flex-wrap">
            <span className="text-sm font-mono text-[#5A6572]">{settings.discord_webhook ? settings.discord_webhook.slice(0, 45) + "…" : "Chưa cấu hình webhook."}</span>
            <button className="btn-ghost !py-1.5 !text-xs" onClick={() => setHook(settings.discord_webhook || "")}>✎ {settings.discord_webhook ? "Sửa" : "Thêm webhook"}</button>
            {settings.discord_webhook && <button className="btn-primary !py-1.5 !text-xs" onClick={testHook}>📨 Gửi thử</button>}
          </div>
        ) : (
          <div className="max-w-xl">
            <input className="inp font-mono !text-xs" placeholder="https://discord.com/api/webhooks/…" value={hook} onChange={(e) => setHook(e.target.value)} />
            <div className="flex gap-2 mt-2">
              <button className="btn-ok !py-2 !text-xs" onClick={saveHook}>Lưu</button>
              <button className="btn-ghost !py-2 !text-xs" onClick={() => setHook(null)}>Hủy</button>
              {settings.discord_webhook && <button className="btn-danger !py-2 !text-xs" onClick={() => { setHook(""); }}>Xóa URL (rồi bấm Lưu để tắt)</button>}
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="font-extrabold mb-1">Bán kèm (dùng trong đơn bán)</div>
        <p className="text-xs text-[#5A6572] mb-3">Danh mục phụ kiện và bảo hiểm theo định dạng mỗi dòng: <b>Tên|Giá</b> (VD: Mũ bảo hiểm|150000).</p>
        {bk === null ? (
          <div className="flex gap-2 items-center flex-wrap">
            <div className="text-xs"><b>Phụ kiện:</b> {(settings.phu_kien || "").split(/\n+/).filter(Boolean).length} mục · <b>Bảo hiểm:</b> {(settings.bao_hiem || "").split(/\n+/).filter(Boolean).length} mục · <b>Giá DV đăng ký:</b> {Number(settings.gia_dang_ky || 350000).toLocaleString("vi-VN")} đ</div>
            <button className="btn-ghost !py-1.5 !text-xs" onClick={() => setBk({ pk: settings.phu_kien || "", bh: settings.bao_hiem || "", dk: settings.gia_dang_ky || "350000" })}>✎ Sửa</button>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 max-w-2xl">
            <div><label className="lbl">Phụ kiện (Tên|Giá)</label><textarea className="inp !h-32 !text-xs font-mono" value={bk.pk} onChange={(e) => setBk((p) => ({ ...p, pk: e.target.value }))} /></div>
            <div><label className="lbl">Bảo hiểm (Tên|Giá)</label><textarea className="inp !h-32 !text-xs font-mono" value={bk.bh} onChange={(e) => setBk((p) => ({ ...p, bh: e.target.value }))} /></div>
            <div><label className="lbl">Giá DV đăng ký mặc định (đ)</label><input type="number" className="inp" value={bk.dk} onChange={(e) => setBk((p) => ({ ...p, dk: e.target.value }))} /></div>
            <div className="flex gap-2"><button className="btn-ok !py-2 !text-xs" onClick={saveBk}>Lưu</button><button className="btn-ghost !py-2 !text-xs" onClick={() => setBk(null)}>Hủy</button></div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="font-extrabold mb-1">Khu vực (dùng khi thêm/sửa kho và trong báo cáo)</div>
        <p className="text-xs text-[#5A6572] mb-3">Mỗi dòng 1 khu vực. Đổi tên danh sách này không tự đổi khu vực của kho cũ — vào Kho / Cửa hàng → Sửa để gán lại từng kho.</p>
        {reg === null ? (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex gap-1.5 flex-wrap">{regions.map((x) => <Badge key={x} tone="green">{x}</Badge>)}</div>
            <button className="btn-ghost !py-1.5 !text-xs" onClick={() => setReg(regions.join("\n"))}>✎ Sửa danh sách</button>
          </div>
        ) : (
          <div className="max-w-sm">
            <textarea className="inp !h-24" value={reg} onChange={(e) => setReg(e.target.value)} />
            <div className="flex gap-2 mt-2">
              <button className="btn-ok !py-2 !text-xs" onClick={saveRegions}>Lưu</button>
              <button className="btn-ghost !py-2 !text-xs" onClick={() => setReg(null)}>Hủy</button>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="flex items-center mb-1">
          <div className="font-extrabold mr-auto">Trường tùy chỉnh trên đơn bán ({customFields.length})</div>
          <button className="btn-primary !py-2 !text-xs" onClick={() => { setEditField(null); setF(empty); setShow(!show); }}>+ Thêm trường mới</button>
        </div>
        <p className="text-xs text-[#5A6572] mb-3">Trường thêm ở đây sẽ xuất hiện ngay trong form "Tạo đơn bán" và lưu kèm từng đơn.</p>

        {show && (
          <div className="bg-[#F8FAFC] rounded-xl p-4 mb-4">
            <div className="grid gap-x-4 md:grid-cols-3 sm:grid-cols-2">
              <Field label="Tên trường" required><input className="inp" value={f.label} onChange={(e) => set("label", e.target.value)} placeholder='VD: Tặng mũ bảo hiểm' /></Field>
              <Field label="Kiểu dữ liệu" required>
                <select className="inp" value={f.field_type} onChange={(e) => set("field_type", e.target.value)}>
                  {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="Bắt buộc nhập?">
                <label className="flex items-center gap-2 text-sm py-2"><input type="checkbox" checked={f.required} onChange={(e) => set("required", e.target.checked)} /> Bắt buộc</label>
              </Field>
              {f.field_type === "dropdown" && (
                <Field label="Các lựa chọn (mỗi dòng 1 lựa chọn)" required>
                  <textarea className="inp !h-20" value={f.optionsText} onChange={(e) => set("optionsText", e.target.value)} placeholder={"Có\nKhông"} />
                </Field>
              )}
              {f.field_type === "formula" && (
                <>
                  <Field label="Công thức: Giá bán thực tế…">
                    <select className="inp" value={f.op} onChange={(e) => set("op", e.target.value)}>
                      <option value="divide">chia (÷)</option><option value="multiply">nhân (×)</option>
                      <option value="add">cộng (+)</option><option value="subtract">trừ (−)</option>
                    </select>
                  </Field>
                  <Field label="…cho giá trị" hint='Chọn "(1 + Thuế suất)" cho giá trước thuế, hoặc nhập số bất kỳ.'>
                    <select className="inp" value={f.operand === "TAX" ? "TAX" : "NUM"} onChange={(e) => set("operand", e.target.value === "TAX" ? "TAX" : "")}>
                      <option value="TAX">(1 + Thuế suất) — hiện là {(1 + taxRate).toFixed(2)}</option>
                      <option value="NUM">Số tự nhập…</option>
                    </select>
                    {f.operand !== "TAX" && <input type="number" className="inp mt-1.5" value={f.operand} onChange={(e) => set("operand", e.target.value)} placeholder="VD: 1.1" />}
                  </Field>
                </>
              )}
            </div>
            <button className="btn-ok" onClick={saveField}>{editField ? "Lưu thay đổi" : "Lưu trường mới"}</button>
            {editField && <button className="btn-ghost ml-2" onClick={() => { setEditField(null); setF(empty); setShow(false); }}>Hủy sửa</button>}
          </div>
        )}

        <div className="overflow-x-auto"><table className="w-full border-collapse">
          <thead><tr><th className="th">Tên trường</th><th className="th">Kiểu</th><th className="th">Chi tiết</th><th className="th">Bắt buộc</th><th className="th"></th></tr></thead>
          <tbody>{customFields.map((c) => (
            <tr key={c.id}>
              <td className="td font-bold">{c.label}</td>
              <td className="td"><Badge tone="blue">{TYPE_LABELS[c.field_type]}</Badge></td>
              <td className="td text-xs">
                {c.field_type === "dropdown" && (c.options || []).join(" / ")}
                {c.field_type === "formula" && c.formula && `Giá bán ${opText[c.formula.op] || "?"} ${c.formula.operand === "TAX" ? "(1 + thuế)" : c.formula.operand}`}
              </td>
              <td className="td">{c.required ? "Có" : "—"}</td>
              <td className="td"><div className="flex gap-1.5">
                <button className="btn-ghost !px-2.5 !py-1 !text-xs" onClick={() => startEditField(c)}>✎ Sửa</button>
                <button className="btn-danger !px-2.5 !py-1 !text-xs" onClick={() => remove(c)}>Ẩn</button>
              </div></td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>
    </div>
  );
}
