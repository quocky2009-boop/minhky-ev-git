"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, VehicleSearch } from "@/components/ui";
import Link from "next/link";
import { fmtTime, fmtDate, errMsg } from "@/lib/format";

const STATUS_TONE = { "Chưa nhập": "amber", "Nhập một phần": "blue", "Hoàn thành": "green", "Hoàn thành (giao thiếu)": "purple", "Đã hủy": "dark" };
const CHUYEN_TONE = { "Dự kiến": "amber", "Đã về": "green", "Hủy": "dark" };

export default function DatHangNhapChiTiet() {
  const { id } = useParams();
  const router = useRouter();
  const { supabase, vehicles, locations, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [po, setPo] = useState(null);
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState(true);
  const [suaMode, setSuaMode] = useState(false);
  const [suaLines, setSuaLines] = useState([]);
  const [huyBusy, setHuyBusy] = useState(false);
  const [rcpts, setRcpts] = useState([]);
  const [units, setUnits] = useState([]);
  const [ships, setShips] = useState([]);
  const [chuyenF, setChuyenF] = useState(null); // { id, ngay_du_kien, bien_so, tai_xe, note, lines:[{vehicle_id, qty}] }
  const [dongF, setDongF] = useState(null); // ly do

  const load = async () => {
    setBusy(true);
    const [{ data: o }, { data: ln }, { data: rc }, { data: sh }] = await Promise.all([
      supabase.from("purchase_orders").select("*").eq("id", id).single(),
      supabase.from("purchase_order_lines").select("*").eq("po_id", id).order("id"),
      supabase.from("purchase_order_receipts").select("*").eq("po_id", id).order("received_at", { ascending: false }),
      supabase.from("purchase_order_shipments").select("*, lines:purchase_order_shipment_lines(id, vehicle_id, qty)").eq("po_id", id).order("ngay_du_kien", { ascending: true, nullsFirst: false }),
    ]);
    const docs = [...new Set((rc || []).map((r) => r.import_doc))];
    let us = [];
    if (docs.length) { const r = await supabase.from("vehicle_units").select("frame_number,vehicle_id,import_doc,status").in("import_doc", docs).limit(2000); us = r.data || []; }
    setPo(o || null); setLines(ln || []); setRcpts(rc || []); setUnits(us); setShips(sh || []);
    setBusy(false);
  };
  useEffect(() => { if (!loading) load(); }, [loading, id]);

  if (loading || busy) return <div className="card">Đang tải…</div>;
  if (!po) return (
    <div className="card">
      <div className="text-[#8A93A0]">Không tìm thấy đơn đặt hàng.</div>
      <button className="btn-ghost !text-xs mt-2" onClick={() => router.back()}>← Quay lại</button>
    </div>
  );

  const vName = (vid) => { const v = vehicles.find((x) => x.id === vid); return v ? `${v.brand} ${v.name} ${v.color}` : vid; };
  const locName = (c) => locations.find((l) => l.code === c)?.name || c;
  const soLuongDat = lines.reduce((s, l) => s + l.qty_ordered, 0);
  const soLuongNhan = lines.reduce((s, l) => s + l.qty_received, 0);
  const daDong = ["Hoàn thành", "Hoàn thành (giao thiếu)", "Đã hủy"].includes(po.status);
  const canDong = ["CEO", "ADMIN"].includes(profile?.role);
  const pct = soLuongDat > 0 ? Math.min(100, Math.round((soLuongNhan / soLuongDat) * 100)) : 0;
  const conThieuVeh = (vid) => lines.filter((l) => l.vehicle_id === vid).reduce((s, l) => s + (l.qty_ordered - l.qty_received), 0);
  const vehOpts = [...new Set(lines.map((l) => l.vehicle_id))];

  const dongDon = async () => {
    if (!dongF.trim()) return notify("Nhập lý do đóng đơn.", "err");
    const { data, error } = await supabase.rpc("fn_dong_don_dat_hang", { p_id: po.id, p_ly_do: dongF });
    if (error) return notify(errMsg(error), "err");
    notify(`Đã đóng đơn — ghi nhận giao thiếu ${data?.thieu ?? 0} xe.`); setDongF(null); load();
  };
  const moLai = async () => {
    if (!confirm("Mở lại đơn để tiếp tục nhập hàng?")) return;
    const { error } = await supabase.rpc("fn_mo_lai_don_dat_hang", { p_id: po.id });
    if (error) return notify(errMsg(error), "err");
    notify("Đã mở lại đơn."); load();
  };
  const luuChuyen = async () => {
    const lns = chuyenF.lines.filter((l) => l.vehicle_id && Number(l.qty) > 0).map((l) => ({ vehicle_id: l.vehicle_id, qty: Number(l.qty) }));
    if (lns.length === 0) return notify("Chuyến cần ít nhất một dòng xe.", "err");
    const { error } = await supabase.rpc("fn_luu_chuyen_dat_hang", { p: { id: chuyenF.id || null, po_id: po.id, ngay_du_kien: chuyenF.ngay_du_kien || null, bien_so: chuyenF.bien_so, tai_xe: chuyenF.tai_xe, note: chuyenF.note, lines: lns } });
    if (error) return notify(errMsg(error), "err");
    notify("Đã lưu chuyến xe."); setChuyenF(null); load();
  };
  const huyChuyen = async (c) => {
    if (!confirm("Hủy chuyến xe này?")) return;
    const { error } = await supabase.rpc("fn_huy_chuyen_dat_hang", { p_id: c.id });
    if (error) return notify(errMsg(error), "err");
    notify("Đã hủy chuyến."); load();
  };

  const moSua = () => {
    setSuaLines(lines.map((l) => ({ id: l.id, vehicle_id: l.vehicle_id, qty_ordered: l.qty_ordered, qty_received: l.qty_received })));
    setSuaMode(true);
  };

  const luuSua = async () => {
    const { error } = await supabase.rpc("fn_sua_don_dat_hang", { p: {
      id: po.id, supplier: po.supplier, ngay_du_kien: po.ngay_du_kien, note: po.note,
      lines: suaLines.map((l) => ({ id: l.id, qty_ordered: Number(l.qty_ordered) })),
    } });
    if (error) return notify(errMsg(error), "err");
    notify("Đã cập nhật đơn đặt hàng."); setSuaMode(false); load();
  };

  const huyDon = async () => {
    if (!confirm(`Hủy đơn đặt hàng ${po.code}? Không thể hoàn tác.`)) return;
    setHuyBusy(true);
    const { error } = await supabase.rpc("fn_huy_don_dat_hang", { p_id: po.id });
    setHuyBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify("Đã hủy đơn đặt hàng."); load();
  };

  const nhapHang = () => {
    router.push(`/nhap-hang?po_id=${po.id}`);
  };

  return (
    <div className="flex flex-col gap-4 pb-8">
      <Toast toast={toast} />
      <div className="flex items-center gap-2 flex-wrap">
        <button className="btn-ghost !text-xs" onClick={() => router.back()}>← Quay lại danh sách đơn đặt hàng</button>
        <div className="ml-auto flex gap-2">
          {po.status === "Chưa nhập" && (
            <button className="btn-ghost !text-xs !text-danger" disabled={huyBusy} onClick={huyDon}>{huyBusy ? "Đang hủy…" : "Hủy"}</button>
          )}
          {po.status === "Nhập một phần" && canDong && (
            <button className="btn-ghost !text-xs" onClick={() => setDongF("")}>Đóng đơn (giao thiếu)</button>
          )}
          {po.status === "Hoàn thành (giao thiếu)" && canDong && (
            <button className="btn-ghost !text-xs" onClick={moLai}>Mở lại đơn</button>
          )}
          {!daDong && (
            <button className="btn-ghost !text-xs" onClick={moSua}>Sửa đơn</button>
          )}
          {!daDong && (
            <button className="btn-primary !text-xs" onClick={nhapHang}>Nhập hàng</button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xl font-extrabold">{po.code}</span>
        <span className="text-[13px] text-[#8A93A0]">{fmtTime(po.created_at)}</span>
        <Badge tone={STATUS_TONE[po.status]}>{po.status}</Badge>
        <div className="flex items-center gap-2 min-w-[200px] flex-1 max-w-sm">
          <div className="h-2 flex-1 rounded-full bg-[#E3E8EF] overflow-hidden"><div className="h-full bg-brand" style={{ width: `${pct}%` }} /></div>
          <span className="text-[12px] font-bold">{soLuongNhan}/{soLuongDat} xe</span>
        </div>
      </div>
      {po.status === "Hoàn thành (giao thiếu)" && (
        <div className="rounded-lg bg-[#F3EEFF] text-[#5B3FA0] text-[12.5px] px-3 py-2">
          Đã đóng đơn giao thiếu {soLuongDat - soLuongNhan} xe bởi <b>{po.closed_by_name}</b> lúc {fmtTime(po.closed_at)} — lý do: {po.close_reason}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 flex flex-col gap-4">
          <div className="card">
            <div className="font-extrabold mb-2">Thông tin nhà cung cấp</div>
            <div className="text-[15px] font-bold text-brand">{po.supplier || "— Không rõ NCC —"}</div>
          </div>

          <div className="card">
            <div className="font-extrabold mb-3">Thông tin sản phẩm</div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead><tr className="text-[11.5px] text-[#8A93A0] uppercase border-b border-[#E3E8EF]">
                  <th className="text-left py-2 pl-2">Model xe + màu</th>
                  <th className="text-right py-2">SL đặt</th>
                  <th className="text-right py-2">SL đã nhận</th>
                  <th className="text-right py-2 pr-2">Còn thiếu</th>
                </tr></thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id} className="border-b border-dashed border-[#F0F2F5]">
                      <td className="py-2.5 pl-2 font-semibold">{vName(l.vehicle_id)}</td>
                      <td className="py-2.5 text-right">{l.qty_ordered}</td>
                      <td className="py-2.5 text-right">{l.qty_received}</td>
                      <td className="py-2.5 pr-2 text-right font-bold">
                        {l.qty_ordered - l.qty_received > 0 ? <span className="text-[#A25F00]">{l.qty_ordered - l.qty_received}</span> : <Badge tone="green">Đủ</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="text-[13px]"><td className="py-1.5 pl-2 text-[#5A6572]">Tổng</td><td className="py-1.5 text-right font-bold">{soLuongDat}</td><td className="py-1.5 text-right font-bold">{soLuongNhan}</td><td className="py-1.5 pr-2"></td></tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="flex items-center mb-2">
              <div className="font-extrabold mr-auto">Lịch về hàng theo chuyến vận tải</div>
              {!daDong && <button className="btn-ghost !text-xs" onClick={() => setChuyenF({ id: null, ngay_du_kien: "", bien_so: "", tai_xe: "", note: "", lines: [{ vehicle_id: vehOpts[0] || "", qty: 1 }] })}>⊕ Thêm chuyến</button>}
            </div>
            {ships.length === 0 ? <div className="text-[12.5px] text-[#8A93A0]">Chưa có chuyến nào. Thêm chuyến khi hãng báo lịch giao.</div> : (
              <div className="flex flex-col gap-2">
                {ships.map((c) => (
                  <div key={c.id} className="rounded-lg border border-[#E3E8EF] p-2.5 text-[13px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <b>{c.ngay_du_kien ? fmtDate(c.ngay_du_kien) : "Chưa rõ ngày"}</b>
                      <Badge tone={CHUYEN_TONE[c.status]}>{c.status}</Badge>
                      {c.bien_so && <span className="text-[#5A6572]">Xe tải {c.bien_so}</span>}
                      {c.tai_xe && <span className="text-[#5A6572]">· {c.tai_xe}</span>}
                      {c.status === "Dự kiến" && (
                        <span className="ml-auto flex gap-1">
                          <button className="btn-ghost !px-2 !py-0.5 !text-xs" onClick={() => setChuyenF({ id: c.id, ngay_du_kien: c.ngay_du_kien || "", bien_so: c.bien_so, tai_xe: c.tai_xe, note: c.note, lines: c.lines.map((x) => ({ vehicle_id: x.vehicle_id, qty: x.qty })) })}>✎</button>
                          <button className="btn-ghost !px-2 !py-0.5 !text-xs !text-danger" onClick={() => huyChuyen(c)}>Hủy</button>
                        </span>
                      )}
                    </div>
                    <div className="text-[12px] text-[#5A6572] mt-1">{c.lines.map((x) => `${vName(x.vehicle_id)} × ${x.qty}`).join(" · ")}</div>
                    {c.note && <div className="text-[11.5px] text-[#8A93A0]">{c.note}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <div className="font-extrabold mb-2">Lịch sử nhập hàng</div>
            {rcpts.length === 0 ? <div className="text-[12.5px] text-[#8A93A0]">Chưa có lần nhập nào.</div> : (
              <div className="flex flex-col gap-2">
                {Object.entries(rcpts.reduce((m, r) => { (m[r.import_doc] = m[r.import_doc] || []).push(r); return m; }, {})).map(([doc, rs]) => (
                  <div key={doc} className={`rounded-lg border p-2.5 text-[13px] ${rs.every((r) => r.huy) ? "border-[#EEE] bg-[#FAFAFA] opacity-70" : "border-[#E3E8EF]"}`}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link href={`/nhap-hang/${encodeURIComponent(doc)}`} className="font-bold text-brand underline">{doc}</Link>
                      <span className="text-[#5A6572]">{fmtTime(rs[0].received_at)} · {rs[0].created_by_name}</span>
                      {rs.every((r) => r.huy) && <Badge tone="dark">Đã hủy</Badge>}
                      <span className="ml-auto font-bold">{rs.reduce((s, r) => s + r.qty, 0)} xe</span>
                    </div>
                    {[...new Set(rs.map((r) => r.vehicle_id))].map((vid) => {
                      const fr = units.filter((u) => u.import_doc === doc && u.vehicle_id === vid);
                      return (
                        <div key={vid} className="mt-1">
                          <div className="text-[12px] font-semibold">{vName(vid)} × {rs.filter((r) => r.vehicle_id === vid).reduce((s, r) => s + r.qty, 0)}</div>
                          <div className="flex gap-1 flex-wrap mt-0.5">{fr.map((u) => <span key={u.frame_number} className="bg-[#F3F5F8] rounded px-1.5 py-0.5 text-[10.5px] font-mono">{u.frame_number}</span>)}</div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="card">
            <div className="font-extrabold mb-3">Thông tin đơn đặt hàng</div>
            <div className="flex flex-col gap-1.5 text-[13px]">
              {[
                ["Mã đơn", po.code],
                ["Khu vực", po.khu_vuc?.length ? po.khu_vuc.join(", ") : locName(po.location_code)],
                ["Nhân viên tạo", po.created_by_name],
                ["Ngày tạo", fmtTime(po.created_at)],
                po.ngay_du_kien && ["Ngày nhập dự kiến", po.ngay_du_kien],
              ].filter(Boolean).map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <span className="text-[#8A93A0] w-32 shrink-0">{k}</span>
                  <span className="font-semibold">{v}</span>
                </div>
              ))}
            </div>
          </div>
          {po.note && (
            <div className="card">
              <div className="font-extrabold mb-1">Ghi chú</div>
              <div className="text-[13px]">{po.note}</div>
            </div>
          )}
        </div>
      </div>

      {/* MODAL SỬA ĐƠN */}
      {suaMode && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-3" onClick={() => setSuaMode(false)}>
          <div className="bg-white rounded-2xl w-[460px] max-w-full p-4" onClick={(e) => e.stopPropagation()}>
            <div className="font-extrabold mb-1">Sửa đơn đặt hàng {po.code}</div>
            <div className="text-[12px] text-[#8A93A0] mb-3">Chỉ được sửa tăng SL đặt hoặc giữ nguyên (không được thấp hơn SL đã nhận).</div>
            <div className="flex flex-col gap-2 max-h-[50vh] overflow-y-auto">
              {suaLines.map((l, i) => (
                <div key={l.id} className="flex items-center gap-2">
                  <span className="flex-1 text-[13px]">{vName(l.vehicle_id)} <span className="text-[11px] text-[#8A93A0]">(đã nhận {l.qty_received})</span></span>
                  <input type="number" min={l.qty_received} className="inp !w-24" value={l.qty_ordered}
                    onChange={(e) => setSuaLines((p) => p.map((x, j) => j === i ? { ...x, qty_ordered: e.target.value } : x))} />
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-3">
              <button className="btn-ghost !text-xs flex-1" onClick={() => setSuaMode(false)}>Hủy</button>
              <button className="btn-primary !text-xs flex-1" onClick={luuSua}>Lưu</button>
            </div>
          </div>
        </div>
      )}

      {chuyenF && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-3" onClick={() => setChuyenF(null)}>
          <div className="bg-white rounded-2xl w-[520px] max-w-full p-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="font-extrabold mb-3">{chuyenF.id ? "Sửa chuyến xe" : "Thêm chuyến xe"}</div>
            <div className="grid gap-2 sm:grid-cols-3">
              <div><label className="lbl">Ngày dự kiến về</label><input type="date" className="inp" value={chuyenF.ngay_du_kien} onChange={(e) => setChuyenF((p) => ({ ...p, ngay_du_kien: e.target.value }))} /></div>
              <div><label className="lbl">Biển số xe tải</label><input className="inp" value={chuyenF.bien_so} onChange={(e) => setChuyenF((p) => ({ ...p, bien_so: e.target.value }))} /></div>
              <div><label className="lbl">Tài xế / SĐT</label><input className="inp" value={chuyenF.tai_xe} onChange={(e) => setChuyenF((p) => ({ ...p, tai_xe: e.target.value }))} /></div>
            </div>
            <div className="mt-2.5 flex flex-col gap-2">
              {chuyenF.lines.map((l, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select className="inp flex-1" value={l.vehicle_id} onChange={(e) => setChuyenF((p) => ({ ...p, lines: p.lines.map((x, j) => j === i ? { ...x, vehicle_id: e.target.value } : x) }))}>
                    {vehOpts.map((v) => <option key={v} value={v}>{vName(v)} (còn thiếu {conThieuVeh(v)})</option>)}
                  </select>
                  <input type="number" min="1" className="inp !w-20" value={l.qty} onChange={(e) => setChuyenF((p) => ({ ...p, lines: p.lines.map((x, j) => j === i ? { ...x, qty: e.target.value } : x) }))} />
                  {chuyenF.lines.length > 1 && <button className="btn-ghost !px-2 !py-1 !text-xs !text-danger" onClick={() => setChuyenF((p) => ({ ...p, lines: p.lines.filter((_, j) => j !== i) }))}>✕</button>}
                </div>
              ))}
              <button className="btn-ghost !text-xs self-start" onClick={() => setChuyenF((p) => ({ ...p, lines: [...p.lines, { vehicle_id: vehOpts[0] || "", qty: 1 }] }))}>⊕ Thêm dòng xe</button>
            </div>
            <div className="mt-2"><label className="lbl">Ghi chú</label><input className="inp" value={chuyenF.note} onChange={(e) => setChuyenF((p) => ({ ...p, note: e.target.value }))} /></div>
            <div className="flex gap-2 mt-3">
              <button className="btn-ghost !text-xs flex-1" onClick={() => setChuyenF(null)}>Hủy</button>
              <button className="btn-primary !text-xs flex-1" onClick={luuChuyen}>Lưu chuyến</button>
            </div>
          </div>
        </div>
      )}

      {dongF !== null && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-3" onClick={() => setDongF(null)}>
          <div className="bg-white rounded-2xl w-[440px] max-w-full p-4" onClick={(e) => e.stopPropagation()}>
            <div className="font-extrabold mb-1">Đóng đơn {po.code} — giao thiếu</div>
            <div className="text-[12px] text-[#8A93A0] mb-2">Hãng chỉ giao {soLuongNhan}/{soLuongDat} xe. Đơn sẽ chuyển sang "Hoàn thành (giao thiếu)", các chuyến dự kiến còn lại bị hủy. Có thể mở lại sau.</div>
            <textarea className="inp" rows={3} placeholder="Lý do (bắt buộc), VD: hãng báo hết hàng màu đỏ" value={dongF} onChange={(e) => setDongF(e.target.value)} />
            <div className="flex gap-2 mt-3">
              <button className="btn-ghost !text-xs flex-1" onClick={() => setDongF(null)}>Hủy</button>
              <button className="btn-primary !text-xs flex-1" onClick={dongDon}>Đóng đơn</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
