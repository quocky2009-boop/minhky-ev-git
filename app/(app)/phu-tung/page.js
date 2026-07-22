"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, Field, KPI, LocSearch, Pager, pageSlice, useSortable, Th } from "@/components/ui";
import { fmtVND, fmtTime, errMsg, downloadCSV } from "@/lib/format";

const TXN_LABEL = {
  NHAP: "Nhập kho", XUAT_DV: "Xuất cho phiếu DV", XUAT_NOI_BO: "Xuất nội bộ",
  DIEU_CHUYEN_DI: "Chuyển đi", DIEU_CHUYEN_DEN: "Chuyển đến", KIEM_KE: "Kiểm kê", HOAN_TRA: "Hoàn trả",
};
const emptyPart = { id: null, code: "", name: "", group_name: "Phụ tùng", unit: "cái", cost_price: 0, sell_price: 0, min_stock: 0, track_serial: false, note: "" };

export default function KhoPhuTung() {
  const { supabase, locations, settings, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [tab, setTab] = useState("ton");
  const [perms, setPerms] = useState({});
  const [parts, setParts] = useState([]);
  const [stock, setStock] = useState([]);
  const [units, setUnits] = useState([]);
  const [txns, setTxns] = useState([]);
  const [sups, setSups] = useState([]);
  const [q, setQ] = useState("");
  const [fLoc, setFLoc] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const sort = useSortable();
  // form danh muc
  const [pf, setPf] = useState(emptyPart);
  const [showPf, setShowPf] = useState(false);
  // form nhap
  const [nf, setNf] = useState({ part_id: "", location_code: "", qty: 1, unit_cost: "", supplier_id: "", note: "", serials: "" });

  const can = (p) => profile?.role === "CEO" || !!perms[p];
  const groups = (settings?.dv_nhom_phu_tung || "Pin & Ắc quy\nSăm lốp\nPhanh\nĐiện & Sạc\nNhựa & Dàn áo\nKhác").split(/\n+/).map((x) => x.trim()).filter(Boolean);

  const load = async () => {
    if (!profile) return;
    const [{ data: p }, { data: s }, { data: u }, { data: t }, { data: sp }, { data: pm }] = await Promise.all([
      supabase.from("parts").select("*").order("group_name").order("name"),
      supabase.from("parts_stock").select("*"),
      supabase.from("part_units").select("*").eq("status", "TON_KHO").limit(3000),
      supabase.from("pt_txns").select("*").order("created_at", { ascending: false }).limit(500),
      supabase.from("suppliers").select("id,name").limit(200),
      supabase.from("role_perms").select("perm,allowed").eq("role", profile.role),
    ]);
    setParts(p || []); setStock(s || []); setUnits(u || []); setTxns(t || []); setSups(sp || []);
    const m = {}; (pm || []).forEach((x) => { m[x.perm] = x.allowed; }); setPerms(m);
  };
  useEffect(() => { if (!loading) load(); }, [loading, profile]);

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;

  const qtyOf = (pid, loc) => stock.find((s) => s.part_id === pid && s.location_code === loc)?.qty || 0;
  const totalOf = (pid) => stock.filter((s) => s.part_id === pid).reduce((a, b) => a + b.qty, 0);
  const locName = (c) => locations.find((l) => l.code === c)?.name || c;
  const partName = (id) => parts.find((p) => p.id === id)?.name || id;

  const savePart = async () => {
    if (!pf.code.trim() || !pf.name.trim()) return notify("Nhập mã và tên phụ tùng.", "err");
    setBusy(true);
    const { error } = await supabase.rpc("fn_pt_luu_part", { p: pf });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(pf.id ? "Đã cập nhật phụ tùng." : "Đã thêm phụ tùng.");
    setShowPf(false); setPf(emptyPart); load();
  };

  const nhapKho = async () => {
    if (!nf.part_id || !nf.location_code) return notify("Chọn phụ tùng và kho nhập.", "err");
    const pt = parts.find((p) => p.id == nf.part_id);
    const serials = nf.serials.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
    if (pt?.track_serial && serials.length !== Number(nf.qty)) {
      return notify(`${pt.name} theo dõi serial — nhập đúng ${nf.qty} serial (đang có ${serials.length}).`, "err");
    }
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_pt_nhap", { p: {
      part_id: nf.part_id, location_code: nf.location_code, qty: Number(nf.qty),
      unit_cost: nf.unit_cost ? Number(nf.unit_cost) : null, supplier_id: nf.supplier_id || null,
      note: nf.note, serials,
    } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(`Đã nhập kho — phiếu ${data}.`);
    setNf({ part_id: "", location_code: nf.location_code, qty: 1, unit_cost: "", supplier_id: "", note: "", serials: "" });
    load();
  };

  const kw = q.trim().toLowerCase();
  const partRows = sort.sortFn(
    parts.filter((p) => !kw || `${p.code} ${p.name} ${p.group_name}`.toLowerCase().includes(kw)),
    { code: (p) => p.code, name: (p) => p.name, group: (p) => p.group_name, ton: (p) => totalOf(p.id), gia: (p) => p.sell_price }
  );
  const duoiDinhMuc = parts.filter((p) => p.min_stock > 0 && totalOf(p.id) < p.min_stock);
  const selPart = parts.find((p) => p.id == nf.part_id);

  const exportCSV = () => {
    downloadCSV(`kho_phu_tung_${new Date().toISOString().slice(0, 10)}.csv`,
      [["Mã", "Tên", "Nhóm", "ĐVT", "Giá nhập", "Giá bán", "Tồn tổng", ...locations.map((l) => l.name), "Định mức"],
       ...partRows.map((p) => [p.code, p.name, p.group_name, p.unit, p.cost_price, p.sell_price, totalOf(p.id),
         ...locations.map((l) => qtyOf(p.id, l.code)), p.min_stock])]);
    notify(`Đã xuất ${partRows.length} phụ tùng.`);
  };

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-extrabold text-lg mr-auto">Kho phụ tùng</div>
        {can("pt_danh_muc") && <button className="btn-ghost !text-xs" onClick={() => { setPf(emptyPart); setShowPf(!showPf); }}>{showPf ? "Đóng" : "+ Thêm phụ tùng"}</button>}
        <button className="btn-ghost !text-xs" onClick={exportCSV}>⬇ CSV</button>
      </div>

      <div className="flex gap-3 flex-wrap">
        <KPI label="Mã phụ tùng" value={parts.length} tone="dark" />
        <KPI label="Tổng tồn (cái)" value={stock.reduce((a, b) => a + b.qty, 0)} tone="blue" />
        <KPI label="Dưới định mức" value={duoiDinhMuc.length} tone={duoiDinhMuc.length ? "red" : "green"} />
        <KPI label="Pin/ắc quy theo serial" value={units.length} tone="purple" />
      </div>

      {showPf && (
        <div className="card !p-4 border-2 border-brand">
          <div className="font-extrabold mb-3">{pf.id ? "Sửa phụ tùng" : "Thêm phụ tùng mới"}</div>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Mã" required><input className="inp" value={pf.code} onChange={(e) => setPf((p) => ({ ...p, code: e.target.value.toUpperCase() }))} placeholder="VD: PT-LOP-001" /></Field>
            <Field label="Tên phụ tùng" required><input className="inp" value={pf.name} onChange={(e) => setPf((p) => ({ ...p, name: e.target.value }))} /></Field>
            <Field label="Nhóm"><select className="inp" value={pf.group_name} onChange={(e) => setPf((p) => ({ ...p, group_name: e.target.value }))}>{groups.map((g) => <option key={g}>{g}</option>)}</select></Field>
            <Field label="Đơn vị"><input className="inp" value={pf.unit} onChange={(e) => setPf((p) => ({ ...p, unit: e.target.value }))} /></Field>
            <Field label="Giá nhập"><input type="number" className="inp" value={pf.cost_price} onChange={(e) => setPf((p) => ({ ...p, cost_price: +e.target.value || 0 }))} /></Field>
            <Field label="Giá bán"><input type="number" className="inp" value={pf.sell_price} onChange={(e) => setPf((p) => ({ ...p, sell_price: +e.target.value || 0 }))} /></Field>
            <Field label="Tồn tối thiểu (cảnh báo)"><input type="number" className="inp" value={pf.min_stock} onChange={(e) => setPf((p) => ({ ...p, min_stock: +e.target.value || 0 }))} /></Field>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm font-semibold cursor-pointer">
                <input type="checkbox" className="w-4 h-4" checked={pf.track_serial} onChange={(e) => setPf((p) => ({ ...p, track_serial: e.target.checked }))} />
                🔋 Theo dõi từng serial (pin / ắc quy)
              </label>
            </div>
            <Field label="Ghi chú"><input className="inp" value={pf.note} onChange={(e) => setPf((p) => ({ ...p, note: e.target.value }))} /></Field>
          </div>
          <div className="flex gap-2 mt-3">
            <button className="btn-ok" disabled={busy} onClick={savePart}>{busy ? "Đang lưu…" : "Lưu"}</button>
            <button className="btn-ghost" onClick={() => setShowPf(false)}>Hủy</button>
          </div>
        </div>
      )}

      <div className="flex gap-1.5 flex-wrap">
        {[["ton", "Tồn kho"], ["nhap", "Nhập kho"], ["serial", "Serial pin"], ["ls", "Lịch sử"]].map(([k, v]) => (
          <button key={k} className={`btn !px-3 !py-2 !text-xs ${tab === k ? "bg-brand text-white" : "bg-[#EEF1F4]"}`} onClick={() => { setTab(k); setPage(1); }}>{v}</button>
        ))}
      </div>

      {tab === "ton" && (
        <div className="card">
          <div className="flex gap-2 items-center mb-3 flex-wrap">
            <div className="font-extrabold mr-auto">Tồn theo điểm ({partRows.length})</div>
            <input className="inp !w-56" placeholder="Tìm mã / tên phụ tùng…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
          <div className="tbl-scroll"><table className="w-full border-collapse tbl-card">
            <thead><tr>
              <Th label="Mã" k="code" sort={sort} /><Th label="Tên phụ tùng" k="name" sort={sort} /><Th label="Nhóm" k="group" sort={sort} />
              <Th label="Giá bán" k="gia" sort={sort} /><Th label="Tổng tồn" k="ton" sort={sort} />
              {locations.map((l) => <th key={l.code} className="th text-center text-[10px]">{l.name}</th>)}
              <th className="th"></th>
            </tr></thead>
            <tbody>{pageSlice(partRows, page, 20).map((p) => {
              const tt = totalOf(p.id);
              const thieu = p.min_stock > 0 && tt < p.min_stock;
              return (
                <tr key={p.id} className={thieu ? "bg-[#FFF6F6]" : "hover:bg-[#F8FAFC]"}>
                  <td className="td font-mono text-xs">{p.code}</td>
                  <td className="td font-semibold text-[13px]">{p.name}{p.track_serial && <Badge tone="purple">serial</Badge>}</td>
                  <td className="td text-xs">{p.group_name}</td>
                  <td className="td">{fmtVND(p.sell_price)}</td>
                  <td className="td"><b className={thieu ? "text-danger" : ""}>{tt}</b> {p.unit}{thieu && <div className="text-[10px] text-danger">dưới định mức {p.min_stock}</div>}</td>
                  {locations.map((l) => { const n = qtyOf(p.id, l.code); return <td key={l.code} className={`td text-center tabular-nums ${n === 0 ? "text-[#C6CDD6]" : "font-bold"}`}>{n === 0 ? "·" : n}</td>; })}
                  <td className="td">{can("pt_danh_muc") && <button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => { setPf({ ...p }); setShowPf(true); window.scrollTo(0, 0); }}>✎</button>}</td>
                </tr>
              );
            })}
            {partRows.length === 0 && <tr><td className="td" colSpan={6 + locations.length}>Chưa có phụ tùng nào. Bấm "+ Thêm phụ tùng" để bắt đầu.</td></tr>}
            </tbody>
          </table></div>
          <Pager total={partRows.length} page={page} setPage={setPage} pageSize={20} setPageSize={() => {}} />
        </div>
      )}

      {tab === "nhap" && (
        <div className="card">
          <div className="font-extrabold mb-3">Nhập kho phụ tùng</div>
          {!can("pt_nhap") ? <div className="text-sm text-[#8A93A0]">Bạn không có quyền nhập kho phụ tùng.</div> : (
            <>
              <div className="grid gap-3 md:grid-cols-3">
                <Field label="Phụ tùng" required>
                  <select className="inp" value={nf.part_id} onChange={(e) => setNf((p) => ({ ...p, part_id: e.target.value }))}>
                    <option value="">— Chọn —</option>
                    {parts.filter((p) => p.status === "Hoạt động").map((p) => <option key={p.id} value={p.id}>{p.name} ({p.code}){p.track_serial ? " 🔋serial" : ""}</option>)}
                  </select>
                </Field>
                <Field label="Nhập vào kho" required><LocSearch locations={locations} value={nf.location_code} onChange={(v) => setNf((p) => ({ ...p, location_code: v }))} placeholder="Chọn điểm…" /></Field>
                <Field label="Số lượng" required><input type="number" min="1" className="inp" value={nf.qty} onChange={(e) => setNf((p) => ({ ...p, qty: e.target.value }))} /></Field>
                <Field label="Giá nhập (bỏ trống = giá trong danh mục)"><input type="number" className="inp" value={nf.unit_cost} onChange={(e) => setNf((p) => ({ ...p, unit_cost: e.target.value }))} /></Field>
                <Field label="Nhà cung cấp">
                  <select className="inp" value={nf.supplier_id} onChange={(e) => setNf((p) => ({ ...p, supplier_id: e.target.value }))}>
                    <option value="">— Không chọn —</option>
                    {sups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </Field>
                <Field label="Ghi chú"><input className="inp" value={nf.note} onChange={(e) => setNf((p) => ({ ...p, note: e.target.value }))} /></Field>
                {selPart?.track_serial && (
                  <div className="md:col-span-3">
                    <Field label={`Serial từng cục — mỗi dòng 1 serial (cần đúng ${nf.qty})`}>
                      <textarea className="inp !h-24 font-mono text-xs" value={nf.serials} onChange={(e) => setNf((p) => ({ ...p, serials: e.target.value }))} placeholder={"SN001\nSN002"} />
                    </Field>
                  </div>
                )}
              </div>
              <button className="btn-ok mt-3" disabled={busy} onClick={nhapKho}>{busy ? "Đang nhập…" : "⇩ Nhập kho"}</button>
            </>
          )}
        </div>
      )}

      {tab === "serial" && (
        <div className="card">
          <div className="flex gap-2 items-center mb-3 flex-wrap">
            <div className="font-extrabold mr-auto">Pin / ắc quy đang tồn theo serial ({units.filter((u) => !fLoc || u.location_code === fLoc).length})</div>
            <div className="!w-56"><LocSearch locations={locations} value={fLoc} onChange={setFLoc} placeholder="Lọc điểm…" /></div>
          </div>
          <div className="tbl-scroll"><table className="w-full border-collapse tbl-card">
            <thead><tr><th className="th w-8">#</th><th className="th">Serial</th><th className="th">Loại</th><th className="th">Điểm</th><th className="th">Ngày nhập</th></tr></thead>
            <tbody>{pageSlice(units.filter((u) => !fLoc || u.location_code === fLoc), page, 20).map((u, i) => (
              <tr key={u.serial} className="hover:bg-[#F8FAFC]">
                <td className="td text-center text-xs text-[#8A93A0]">{i + 1}</td>
                <td className="td font-mono font-bold text-[12px]">{u.serial}</td>
                <td className="td text-[13px]">{partName(u.part_id)}</td>
                <td className="td text-xs">{locName(u.location_code)}</td>
                <td className="td text-xs">{fmtTime(u.imported_at)}</td>
              </tr>
            ))}
            {units.length === 0 && <tr><td className="td" colSpan={5}>Chưa có pin/ắc quy nào theo serial. Tạo phụ tùng có bật "Theo dõi serial" rồi nhập kho.</td></tr>}
            </tbody>
          </table></div>
          <Pager total={units.filter((u) => !fLoc || u.location_code === fLoc).length} page={page} setPage={setPage} pageSize={20} setPageSize={() => {}} />
        </div>
      )}

      {tab === "ls" && (
        <div className="card">
          <div className="font-extrabold mb-3">Lịch sử nhập xuất ({txns.length})</div>
          <div className="flex flex-col gap-1.5">
            {pageSlice(txns, page, 20).map((t) => (
              <div key={t.id} className="flex items-center gap-2 p-2 rounded-lg border border-[#E3E8EF] text-[13px]">
                <Badge tone={t.qty_change > 0 ? "green" : "amber"}>{TXN_LABEL[t.txn_type] || t.txn_type}</Badge>
                <div className="mr-auto min-w-0">
                  <div className="font-semibold truncate">{partName(t.part_id)} <span className="text-[11px] text-[#8A93A0]">tại {locName(t.location_code)}</span></div>
                  <div className="text-[11px] text-[#8A93A0] truncate">{t.doc_code} · {t.by_name} · {fmtTime(t.created_at)}{t.note ? " · " + t.note : ""}</div>
                </div>
                <b className={t.qty_change > 0 ? "text-[#0E7A4A]" : "text-danger"}>{t.qty_change > 0 ? "+" : ""}{t.qty_change}</b>
                <span className="text-[11px] text-[#8A93A0] w-20 text-right">{t.qty_before} → {t.qty_after}</span>
              </div>
            ))}
            {txns.length === 0 && <div className="text-sm text-[#8A93A0]">Chưa có giao dịch nào.</div>}
          </div>
          <Pager total={txns.length} page={page} setPage={setPage} pageSize={20} setPageSize={() => {}} />
        </div>
      )}
    </div>
  );
}
