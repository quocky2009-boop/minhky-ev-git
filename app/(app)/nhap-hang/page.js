"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Field, Badge, Toast, LocSearch, VehicleSearch, MoneyInput } from "@/components/ui";
import { fmtVND, fmtTime, errMsg, downloadCSV } from "@/lib/format";
import Scanner from "@/components/Scanner";
import Link from "next/link";

const iso = (d) => d.toLocaleDateString("sv-SE");
const emptyLine = { vehicle_id: "", frames: [], cost_price: 0, note: "" };

export default function NhapHang() {
  const { supabase, vehicles, locations, settings, profile, loading, refresh } = useCatalog();
  const { toast, notify } = useToast();

  const [txns, setTxns] = useState([]);
  const [busy, setBusy] = useState(false);
  const [ketQua, setKetQua] = useState(null);
  const [detail, setDetail] = useState(null);

  // Thông tin phiếu
  const [meta, setMeta] = useState({ location_code: "", supplier: "", doc: "", note: "", ngay: iso(new Date()) });
  // Dòng hàng
  const [lines, setLines] = useState([{ ...emptyLine }]);
  // Quét
  const [scanIdx, setScanIdx] = useState(null);

  const load = async () => {
    const { data } = await supabase.from("inventory_txns").select("*")
      .eq("txn_type", "Nhập hàng").order("created_at", { ascending: false }).limit(200);
    setTxns(data || []);
  };
  useEffect(() => { if (!loading) load(); }, [loading]);

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;
  const canNhap = ["CEO", "ADMIN"].includes(profile.role);

  const vName = (id) => { const v = vehicles.find((x) => x.id === id); return v ? `${v.brand} ${v.name} ${v.color}` : id; };
  const locName = (c) => locations.find((l) => l.code === c)?.name || c;
  const sups = (settings?.suppliers || "VinFast\nTAILG").split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);

  const setLine = (i, k, v) => setLines((p) => p.map((x, j) => j === i ? { ...x, [k]: v } : x));

  const themSK = (i, raw) => {
    const list = String(raw || "").split(/[\s,;\n]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
    if (list.length === 0) return;
    setLines((p) => p.map((x, j) => {
      if (j !== i) return x;
      const moi = list.filter((sk) => !x.frames.includes(sk));
      const trung = list.filter((sk) => x.frames.includes(sk));
      if (trung.length) notify(`Bỏ qua ${trung.length} số khung đã có trong dòng.`, "err");
      return { ...x, frames: [...x.frames, ...moi] };
    }));
  };

  const tongXe = lines.reduce((s, l) => s + l.frames.length, 0);
  const tongVon = lines.reduce((s, l) => s + l.frames.length * (Number(l.cost_price) || 0), 0);
  const soMa = lines.filter((l) => l.vehicle_id && l.frames.length > 0).length;

  const luuPhieu = async () => {
    if (!meta.location_code) return notify("Chọn kho nhập.", "err");
    const ok = lines.filter((l) => l.vehicle_id && l.frames.length > 0);
    if (ok.length === 0) return notify("Chưa có dòng hàng hợp lệ (cần chọn mã xe và nhập số khung).", "err");
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_nhap_hang_v2", { p: {
      location_code: meta.location_code, supplier: meta.supplier, doc: meta.doc, note: meta.note,
      lines: ok.map((l) => ({ vehicle_id: l.vehicle_id, frames: l.frames, cost_price: Number(l.cost_price) || 0, note: l.note })),
    } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    setKetQua(data);
    notify(`Đã nhập ${data.so_xe} xe vào kho.`);
    refresh(); load();
  };

  const lamMoi = () => {
    setKetQua(null); setLines([{ ...emptyLine }]);
    setMeta((p) => ({ ...p, supplier: "", doc: "", note: "" }));
  };

  const openDetail = async (t) => {
    const { data: u } = await supabase.from("vehicle_units").select("*").eq("import_doc", t.doc_code).limit(200);
    setDetail({ doc: t.doc_code, txn: t, units: u || [] });
  };

  // ===== ĐÃ LƯU =====
  if (ketQua) {
    return (
      <div className="flex flex-col gap-4">
        <Toast toast={toast} />
        <div className="card text-center py-8">
          <div className="text-5xl mb-2">📦</div>
          <div className="font-extrabold text-xl mb-1">Đã nhập {ketQua.so_xe} xe vào kho</div>
          <div className="text-[13px] text-[#5A6572]">Phiếu <b>{ketQua.doc}</b> · {ketQua.so_ma} mã xe · kho {locName(meta.location_code)}</div>
          {ketQua.tong_von > 0 && <div className="text-[13px] text-[#5A6572] mt-0.5">Tổng giá vốn: <b>{fmtVND(ketQua.tong_von)}</b></div>}
          <div className="flex gap-2 justify-center flex-wrap mt-4">
            <button className="btn-ok" onClick={lamMoi}>+ Nhập phiếu khác</button>
            <Link href="/danh-muc-xe?tab=sokhung" className="btn-ghost">Xem xe theo số khung</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-24">
      <Toast toast={toast} />
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-extrabold text-lg mr-auto">Nhập hàng</div>
        {!canNhap && <Badge tone="amber">Chỉ Admin/BGĐ được nhập hàng</Badge>}
      </div>

      {canNhap && (
        <>
          {/* HÀNG 1: NCC | THÔNG TIN PHIẾU */}
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="card lg:col-span-2">
              <div className="font-extrabold mb-2.5">Thông tin nhà cung cấp</div>
              <div className="grid gap-2.5 md:grid-cols-2">
                <Field label="Nhà cung cấp">
                  <select className="inp" value={meta.supplier} onChange={(e) => setMeta((p) => ({ ...p, supplier: e.target.value }))}>
                    <option value="">— Chọn NCC —</option>
                    {sups.map((x) => <option key={x}>{x}</option>)}
                  </select>
                </Field>
                <Field label="Số chứng từ NCC (nếu có)">
                  <input className="inp" value={meta.doc} onChange={(e) => setMeta((p) => ({ ...p, doc: e.target.value.toUpperCase() }))} placeholder="Bỏ trống = tự sinh mã PN-…" />
                </Field>
                <div className="md:col-span-2">
                  <Field label="Ghi chú phiếu nhập">
                    <input className="inp" value={meta.note} onChange={(e) => setMeta((p) => ({ ...p, note: e.target.value }))} placeholder="VD: lô hàng tháng 7, xe giao đợt 2" />
                  </Field>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="font-extrabold mb-2.5">Thông tin bổ sung</div>
              <div className="flex flex-col gap-2.5">
                <Field label="Nhập vào kho" required>
                  <LocSearch locations={locations} value={meta.location_code} onChange={(v) => setMeta((p) => ({ ...p, location_code: v }))} placeholder="Chọn kho / cửa hàng" />
                </Field>
                <Field label="Người nhập"><input className="inp bg-[#F8FAFC]" value={profile.name} disabled /></Field>
                <Field label="Ngày nhập"><input type="date" className="inp" value={meta.ngay} onChange={(e) => setMeta((p) => ({ ...p, ngay: e.target.value }))} /></Field>
              </div>
            </div>
          </div>

          {/* HÀNG 2: BẢNG HÀNG HÓA */}
          <div className="card">
            <div className="flex items-center gap-2 mb-2.5 flex-wrap">
              <div className="font-extrabold mr-auto">Thông tin hàng hóa</div>
              <span className="text-[11px] text-[#8A93A0]">{soMa} mã · {tongXe} xe</span>
            </div>

            <div className="flex flex-col gap-3">
              {lines.map((l, i) => (
                <div key={i} className="rounded-xl border border-[#E3E8EF] p-3">
                  <div className="grid gap-2.5 md:grid-cols-4 mb-2.5">
                    <div className="md:col-span-2">
                      <label className="lbl">Mã xe {i + 1}</label>
                      <VehicleSearch vehicles={vehicles} value={l.vehicle_id} onChange={(id) => setLine(i, "vehicle_id", id || "")} />
                    </div>
                    <div>
                      <label className="lbl">💰 Giá vốn / xe</label>
                      <MoneyInput value={l.cost_price} onChange={(v) => setLine(i, "cost_price", v)} placeholder="Giá nhập thực tế" />
                    </div>
                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <label className="lbl">Số lượng</label>
                        <div className="inp bg-[#F8FAFC] flex items-center font-bold">{l.frames.length} xe</div>
                      </div>
                      {lines.length > 1 && (
                        <button className="btn-ghost !px-2.5 !py-2 !text-danger" onClick={() => setLines((p) => p.filter((_, j) => j !== i))}>✕</button>
                      )}
                    </div>
                  </div>

                  <label className="lbl">Số khung (dán nhiều dòng, cách nhau bằng dấu phẩy hoặc xuống dòng)</label>
                  <div className="flex gap-1.5 mb-2">
                    <input className="inp font-mono !text-[13px]" placeholder="Nhập/dán số khung rồi Enter…"
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); themSK(i, e.target.value); e.target.value = ""; } }}
                      onBlur={(e) => { if (e.target.value.trim()) { themSK(i, e.target.value); e.target.value = ""; } }} />
                    <button className="btn-ghost !px-3 whitespace-nowrap" onClick={() => setScanIdx(i)}>📷 Quét</button>
                  </div>

                  {l.frames.length > 0 && (
                    <div className="flex gap-1.5 flex-wrap">
                      {l.frames.map((sk, k) => (
                        <span key={sk} className="inline-flex items-center gap-1.5 bg-[#F3F5F8] rounded-lg px-2 py-1 text-[11.5px] font-mono">
                          {sk}
                          <button className="text-danger font-bold" onClick={() => setLine(i, "frames", l.frames.filter((_, j) => j !== k))}>✕</button>
                        </span>
                      ))}
                      <button className="text-[11px] text-danger underline" onClick={() => setLine(i, "frames", [])}>Xóa hết</button>
                    </div>
                  )}

                  {l.vehicle_id && l.frames.length > 0 && (Number(l.cost_price) || 0) > 0 && (
                    <div className="text-[12px] text-[#5A6572] mt-2 text-right">
                      {l.frames.length} × {fmtVND(l.cost_price)} = <b className="text-brand">{fmtVND(l.frames.length * Number(l.cost_price))}</b>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <button className="btn-ghost !text-xs mt-2.5" onClick={() => setLines((p) => [...p, { ...emptyLine }])}>⊕ Thêm mã xe khác</button>
          </div>

          {/* HÀNG 3: TỔNG KẾT */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card">
              <div className="font-extrabold mb-2.5">Kiểm tra trước khi lưu</div>
              <div className="flex flex-col gap-1.5 text-[13px]">
                {lines.filter((l) => l.vehicle_id && l.frames.length > 0).map((l, i) => (
                  <div key={i} className="flex justify-between gap-2 py-1 border-b border-dashed border-[#EEF1F4]">
                    <span className="min-w-0"><b>{vName(l.vehicle_id)}</b><span className="block text-[11px] text-[#8A93A0]">{l.frames.length} số khung</span></span>
                    <span className="text-right whitespace-nowrap">{fmtVND(l.frames.length * (Number(l.cost_price) || 0))}</span>
                  </div>
                ))}
                {soMa === 0 && <div className="text-[#8A93A0]">Chưa có dòng hàng nào hợp lệ.</div>}
              </div>
            </div>

            <div className="card">
              <div className="font-extrabold mb-2.5">Tổng kết phiếu</div>
              <div className="rounded-xl border border-[#E3E8EF] overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-dashed border-[#E3E8EF] text-[13.5px]">
                  <span className="text-[#5A6572]">Số mã xe</span><span className="font-bold">{soMa}</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2 border-b border-dashed border-[#E3E8EF] text-[13.5px]">
                  <span className="text-[#5A6572]">Tổng số xe</span><span className="font-bold">{tongXe} chiếc</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2 border-b border-dashed border-[#E3E8EF] text-[13.5px]">
                  <span className="text-[#5A6572]">Kho nhập</span><span className="font-bold">{meta.location_code ? locName(meta.location_code) : "—"}</span>
                </div>
                <div className={`flex items-center justify-between px-3 py-2.5 ${tongVon > 0 ? "bg-[#EAF2FF]" : "bg-[#FFF6E5]"}`}>
                  <span className="font-bold text-[13.5px]">Tổng giá vốn lô hàng</span>
                  <span className={`text-[18px] font-extrabold ${tongVon > 0 ? "text-brand" : "text-[#A25F00]"}`}>{fmtVND(tongVon)}</span>
                </div>
              </div>
              {tongVon === 0 && tongXe > 0 && (
                <div className="text-[11.5px] text-[#A25F00] mt-2">⚠ Chưa khai giá vốn — báo cáo lãi gộp sẽ thiếu số liệu.</div>
              )}
            </div>
          </div>

          {/* THANH DÍNH ĐÁY */}
          <div className="fixed bottom-0 left-0 right-0 lg:left-[248px] bg-white border-t border-[#E6EAEF] px-4 py-3 flex items-center gap-3 z-30">
            <div className="text-[13px] hidden sm:block">
              <span className="text-[#8A93A0]">Tổng:</span> <b className="text-brand text-[15px]">{tongXe} xe</b>
              {tongVon > 0 && <span className="text-[#5A6572] ml-2">· {fmtVND(tongVon)}</span>}
            </div>
            <div className="ml-auto flex gap-2">
              <button className="btn-ghost" onClick={lamMoi}>Xóa hết</button>
              <button className="btn-ok !px-6" disabled={busy || tongXe === 0} onClick={luuPhieu}>
                {busy ? "Đang lưu…" : `Nhập kho${tongXe > 0 ? ` (${tongXe} xe)` : ""}`}
              </button>
            </div>
          </div>
        </>
      )}

      {/* LỊCH SỬ NHẬP */}
      <div className="card">
        <div className="font-extrabold mb-2.5">Lịch sử nhập hàng ({txns.length})</div>
        <div className="flex flex-col gap-1.5">
          {txns.slice(0, 30).map((t) => (
            <div key={t.id} className="flex items-center gap-2 p-2.5 rounded-xl border border-[#E3E8EF] text-[13px]">
              <div className="mr-auto min-w-0">
                <div className="font-semibold">{t.doc_code} · {vName(t.vehicle_id)}</div>
                <div className="text-[11px] text-[#8A93A0] truncate">{fmtTime(t.created_at)} · {locName(t.to_location)} · {t.created_by_name}{t.note ? " · " + t.note : ""}</div>
              </div>
              <b className="text-[#0E7A4A] whitespace-nowrap">+{t.quantity}</b>
            </div>
          ))}
          {txns.length === 0 && <div className="text-sm text-[#8A93A0]">Chưa có phiếu nhập nào.</div>}
        </div>
      </div>

      {scanIdx !== null && (
        <Scanner
          onAdd={(code) => { themSK(scanIdx, code); }}
          onClose={() => setScanIdx(null)}
        />
      )}
    </div>
  );
}
