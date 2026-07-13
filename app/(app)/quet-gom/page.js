"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Field, Badge, Toast, VehicleSearch, LocSearch, Pager, pageSlice } from "@/components/ui";
import { errMsg, downloadCSV, fmtTime } from "@/lib/format";
import Scanner from "@/components/Scanner";

export default function QuetGom() {
  const { supabase, vehicles, locations, profile, loading, refresh } = useCatalog();
  const { toast, notify } = useToast();
  const [loc, setLoc] = useState("");
  const [vid, setVid] = useState("");          // mau xe dang quet
  const [rows, setRows] = useState([]);         // {frame, vehicle_id}
  const [manual, setManual] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draftId, setDraftId] = useState(null);  // dang sua phieu nao
  const [draftCode, setDraftCode] = useState("");
  const [drafts, setDrafts] = useState([]);
  const [dTab, setDTab] = useState("Nháp");
  // ===== Danh sach hang (frame_pool) =====
  const [poolQ, setPoolQ] = useState("");
  const [poolHits, setPoolHits] = useState([]);
  const [poolCount, setPoolCount] = useState(null);
  const fileRef = { current: null };

  const [poolOpen, setPoolOpen] = useState(false);
  const [poolAll, setPoolAll] = useState(null);   // null = chua tai
  const [poolFilter, setPoolFilter] = useState("");
  const [poolPage, setPoolPage] = useState(1);
  const [poolPageSize, setPoolPageSize] = useState(20);

  const loadPoolAll = async () => {
    const [{ data: pool }, { data: units }, { data: drafts_ }] = await Promise.all([
      supabase.from("frame_pool").select("frame_number, vehicle_id").order("vehicle_id").limit(5000),
      supabase.from("vehicle_units").select("frame_number, status, location_code").limit(10000),
      supabase.from("import_drafts").select("code, rows").eq("status", "Nháp").limit(500),
    ]);
    const uMap = {};
    (units || []).forEach((u) => { uMap[u.frame_number] = u; });
    const dMap = {};
    (drafts_ || []).forEach((d) => (d.rows || []).forEach((r) => { if (!dMap[r.frame_number]) dMap[r.frame_number] = d.code; }));
    setPoolAll((pool || []).map((x) => {
      const u = uMap[x.frame_number];
      if (u) return { ...x, state: u.status === "DA_BAN" ? "Đã bán" : "Đã trong kho", ref: u.location_code };
      if (dMap[x.frame_number]) return { ...x, state: "Đang ở phiếu", ref: dMap[x.frame_number] };
      return { ...x, state: "Chờ gán", ref: "" };
    }));
  };
  const togglePoolList = async () => {
    const next = !poolOpen;
    setPoolOpen(next);
    if (next) { setPoolAll(null); await loadPoolAll(); }
  };

  const loadPoolCount = async () => {
    const { count } = await supabase.from("frame_pool").select("*", { count: "exact", head: true });
    setPoolCount(count ?? 0);
  };
  useEffect(() => { if (!loading) loadPoolCount(); }, [loading]);

  useEffect(() => {
    const q = poolQ.trim();
    if (q.length < 3) { setPoolHits([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc("fn_tim_pool", { p_q: q });
      setPoolHits(data || []);
    }, 300);
    return () => clearTimeout(t);
  }, [poolQ]);

  const loadDrafts = async () => {
    const { data } = await supabase.from("import_drafts").select("*").order("updated_at", { ascending: false }).limit(200);
    setDrafts(data || []);
  };
  useEffect(() => { if (!loading) loadDrafts(); }, [loading]);

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;
  const canImport = ["CEO", "ADMIN"].includes(profile.role);
  const vOf = (id) => vehicles.find((x) => x.id === id);
  const locLabel = locations.find((l) => l.code === loc)?.name || "";
  const locNameOf = (c) => locations.find((l) => l.code === c)?.name || c;

  const addFrames = (list) => {
    if (!vid) return notify("Chọn mẫu xe đang quét trước (dãy nào quét dãy đó).", "err");
    const clean = list.map((x) => x.trim().toUpperCase()).filter(Boolean);
    setRows((prev) => {
      const have = new Set(prev.map((r) => r.frame));
      const fresh = clean.filter((f) => !have.has(f));
      const dup = clean.length - fresh.length;
      if (dup > 0) notify(`Bỏ qua ${dup} số khung quét trùng.`, "err");
      return [...prev, ...fresh.map((f) => ({ frame: f, vehicle_id: vid }))];
    });
  };
  const addManual = () => { addFrames(manual.split(/[\n,;\s]+/)); setManual(""); };
  const editFrame = (i, val) => setRows((p) => p.map((r, j) => (j === i ? { ...r, frame: val.toUpperCase() } : r)));

  const pickPool = (h) => {
    if (h.state !== "Chờ gán") return notify(`Số khung này ${h.state === "Đang ở phiếu" ? `đang nằm ở phiếu ${h.ref}` : h.state === "Đã trong kho" ? `đã ở kho ${h.ref}` : "đã bán"} — không chọn lại được.`, "err");
    if (rows.some((r) => r.frame === h.frame_number)) return notify("Số khung này đã có trong danh sách đang gom.", "err");
    setRows((p) => [...p, { frame: h.frame_number, vehicle_id: h.vehicle_id }]);
    setPoolQ(""); setPoolHits([]);
    notify(`Đã thêm ${h.frame_number} — nhớ Lưu phiếu nháp để giữ chỗ, tránh điểm khác chọn trùng.`);
  };

  const stripVN = (x) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().replace(/[^a-z0-9]/g, "");
  const importPoolCSV = async (file) => {
    const text = (await file.text()).replace(/^\uFEFF/, "");
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return notify("File rỗng hoặc thiếu dòng dữ liệu.", "err");
    const sep = lines[0].includes(";") && !lines[0].includes(",") ? ";" : ",";
    const cells = (l) => l.split(sep).map((c) => c.replace(/^"|"$/g, "").trim());
    const head = cells(lines[0]).map(stripVN);
    const iVid = head.findIndex((h) => ["maxe", "manoibo", "vehicleid", "maxenoibo", "ma"].some((k) => h.includes(k)));
    const iFrame = head.findIndex((h) => ["sokhung", "framenumber", "frame", "sokhungxe", "vin"].some((k) => h.includes(k)));
    if (iVid < 0 || iFrame < 0) return notify(`Không nhận ra cột. Tiêu đề cần có "Mã xe" (mã nội bộ) và "Số khung" — file đang có: ${cells(lines[0]).join(" | ")}`, "err");
    const rws = lines.slice(1).map(cells).map((c) => ({ vehicle_id: c[iVid], frame_number: c[iFrame] })).filter((r) => r.frame_number);
    if (rws.length === 0) return notify("Không đọc được dòng dữ liệu nào.", "err");
    if (!confirm(`Import ${rws.length} số khung từ file hãng vào danh sách chờ?`)) return;
    setBusy(true);
    let ins = 0, upd = 0, skipped = [];
    for (let i = 0; i < rws.length; i += 500) {
      const { data, error } = await supabase.rpc("fn_import_pool", { p_rows: rws.slice(i, i + 500) });
      if (error) { setBusy(false); return notify(errMsg(error), "err"); }
      ins += data.inserted; upd += data.updated; skipped = skipped.concat(data.skipped || []);
    }
    setBusy(false); loadPoolCount(); if (poolOpen) loadPoolAll();
    notify(`Import xong: ${ins} mới, ${upd} cập nhật.` +
      (skipped.length ? ` Bỏ qua ${skipped.length}: ${skipped.slice(0, 3).map((x) => `${x.frame} (${x.ly_do})`).join("; ")}${skipped.length > 3 ? "…" : ""}` : ""),
      skipped.length ? "err" : "ok");
  };

  const exportPoolConLai = async () => {
    const { data, error } = await supabase.rpc("fn_pool_con_lai");
    if (error) return notify(errMsg(error), "err");
    if (!data?.length) return notify("Không còn số khung nào chờ gán — toàn bộ danh sách hãng đã vào kho/phiếu. 🎉");
    downloadCSV(`doi_chieu_chua_gan_${new Date().toISOString().slice(0, 10)}.csv`,
      [["frame_number", "vehicle_id"], ...data.map((r) => [r.frame_number, r.vehicle_id])]);
    notify(`Đã xuất ${data.length} số khung hãng có nhưng chưa thấy thực tế — dùng làm bảng đối chiếu thiếu.`);
  };

  const newDraft = () => { setRows([]); setDraftId(null); setDraftCode(""); };

  const saveDraft = async () => {
    if (!loc) return notify("Chọn kho trước khi lưu phiếu.", "err");
    if (rows.length === 0) return notify("Chưa có số khung nào để lưu.", "err");
    const frames = rows.map((r) => r.frame.trim()).filter(Boolean);
    if (frames.length !== rows.length) return notify("Có dòng số khung đang để trống — điền hoặc xóa dòng đó.", "err");
    if (new Set(frames).size !== frames.length) return notify("Có số khung bị trùng trong phiếu — kiểm tra lại các dòng.", "err");
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_luu_phieu_nhap", {
      p: { id: draftId || "", location_code: loc, rows: rows.map((r) => ({ frame_number: r.frame.trim(), vehicle_id: r.vehicle_id })) },
    });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    setDraftCode(data);
    if (!draftId) {
      const { data: d } = await supabase.from("import_drafts").select("id").eq("code", data).single();
      if (d) setDraftId(d.id);
    }
    notify(`Đã lưu phiếu nhập nháp ${data} (${rows.length} xe · ${locLabel}). Sửa tiếp hoặc chuyển Admin/BGĐ nhập vào kho.`);
    loadDrafts();
  };

  const exportRows = (rws, tag) => {
    downloadCSV(`${tag}_${new Date().toISOString().slice(0, 10)}.csv`,
      [["frame_number", "vehicle_id"], ...rws.map((r) => [r.frame_number || r.frame, r.vehicle_id])]);
  };

  const importDraft = async (d) => {
    if (!confirm(`Nhập phiếu ${d.code} (${(d.rows || []).length} xe) vào ${locNameOf(d.location_code)}?`)) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_nhap_tu_phieu", { p_id: d.id });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    const sk = data?.skipped || [];
    notify(`Phiếu ${d.code}: đã nhập ${data?.inserted || 0} xe (chứng từ ${data?.doc}).` +
      (sk.length ? ` Bỏ qua ${sk.length} số khung: ${sk.slice(0, 3).map((x) => `${x.frame} (${x.ly_do})`).join("; ")}${sk.length > 3 ? "…" : ""}` : ""),
      sk.length ? "err" : "ok");
    if (draftId === d.id) newDraft();
    loadDrafts(); refresh();
  };

  const importCurrent = async () => {
    if (!loc) return notify("Chọn kho trước khi nhập thẳng.", "err");
    if (rows.length === 0) return notify("Chưa có số khung nào.", "err");
    if (draftId) {
      const d = drafts.find((x) => x.id === draftId);
      await saveDraft();
      return importDraft(d || { id: draftId, code: draftCode, rows, location_code: loc });
    }
    if (!confirm(`Nhập thẳng ${rows.length} xe vào ${locLabel} (không lưu phiếu nháp)?`)) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_import_units", {
      p_loc: loc,
      p_rows: rows.map((r) => ({ frame_number: r.frame.trim(), vehicle_id: r.vehicle_id, note: "Kiểm kê đầu kỳ" })),
    });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    const sk = data?.skipped || [];
    notify(`Đã nhập ${data?.inserted || 0} xe vào ${locLabel} (phiếu ${data?.doc}).` +
      (sk.length ? ` Bỏ qua ${sk.length}: ${sk.slice(0, 3).map((x) => `${x.frame} (${x.ly_do})`).join("; ")}${sk.length > 3 ? "…" : ""}` : ""),
      sk.length ? "err" : "ok");
    if (!sk.length) setRows([]);
    refresh();
  };

  const openDraft = (d) => {
    setRows((d.rows || []).map((r) => ({ frame: r.frame_number, vehicle_id: r.vehicle_id })));
    setLoc(d.location_code); setDraftId(d.id); setDraftCode(d.code);
    window.scrollTo({ top: 0, behavior: "smooth" });
    notify(`Đang mở phiếu ${d.code} để sửa — sửa xong nhớ bấm "Lưu phiếu nháp".`);
  };

  const delDraft = async (d) => {
    if (!confirm(`Xóa phiếu nháp ${d.code}?`)) return;
    const { error } = await supabase.rpc("fn_xoa_phieu_nhap", { p_id: d.id });
    if (error) return notify(errMsg(error), "err");
    if (draftId === d.id) newDraft();
    notify(`Đã xóa phiếu ${d.code}.`); loadDrafts();
  };

  const shown = drafts.filter((d) => d.status === dTab);

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      {showScanner && <Scanner onClose={() => setShowScanner(false)} onAdd={addFrames} />}

      <div className="card !border-brand !border-2">
        <div className="font-extrabold text-base">📍 Kho / cửa hàng đang kiểm</div>
        <p className="text-xs text-[#5A6572] mb-3">Chọn kho trước tiên — áp dụng chung cho mọi cách đưa số khung vào danh sách gom bên dưới (quét camera, gõ tay, chọn từ danh sách hãng). Phiếu nhập nháp sẽ mang kho này.</p>
        {draftId && (
          <div className="flex items-center gap-2 bg-[#FDF6E3] border border-[#F5C542] rounded-xl px-3 py-2 mb-3 text-[13px]">
            <span className="font-bold">✏ Đang sửa phiếu {draftCode}</span>
            <button className="btn-ghost !px-2.5 !py-1 !text-xs ml-auto" onClick={newDraft}>+ Phiếu mới</button>
          </div>
        )}
        <div className="max-w-md"><LocSearch locations={locations} value={loc} onChange={setLoc} /></div>
        {!loc && <p className="text-[11px] text-[#A25F00] font-semibold mt-1.5">⚠ Chưa chọn kho — vẫn gom được nhưng phải chọn kho trước khi Lưu phiếu nháp / Nhập.</p>}
      </div>

      <div className="card">
        <div className="font-extrabold text-base">📷 Quét camera / gõ tay</div>
        <p className="text-xs text-[#5A6572] mb-3">Đứng dãy xe nào chọn đúng mẫu xe đó rồi quét liên tục; sang dãy khác đổi mẫu xe quét tiếp. Quét xong bấm <b>Lưu phiếu nháp</b> ở khối "Đã gom" — trang này không tự thay đổi tồn.</p>
        <Field label="Mẫu xe đang quét (dãy hiện tại)" required><VehicleSearch vehicles={vehicles} value={vid} onChange={setVid} /></Field>
        <button className="btn-primary !py-3 w-full" disabled={!vid} onClick={() => setShowScanner(true)}>📷 Quét camera / chụp OCR</button>
        <div className="flex gap-1.5 mt-2">
          <input className="inp font-mono !text-[13px]" placeholder="Hoặc gõ/dán số khung, cách nhau xuống dòng…" value={manual} onChange={(e) => setManual(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addManual()} />
          <button className="btn-ghost whitespace-nowrap" onClick={addManual}>+ Thêm</button>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center gap-2 flex-wrap mb-1.5">
          <div className="font-extrabold mr-auto">🔎 Tìm từ danh sách hãng {poolCount !== null && <span className="text-xs font-normal text-[#8A93A0]">({poolCount} số khung trong danh sách chờ)</span>}</div>
          {canImport && (
            <>
              <label className="btn-ghost !text-xs cursor-pointer">⬆ Import file hãng (CSV)
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { if (e.target.files[0]) importPoolCSV(e.target.files[0]); e.target.value = ""; }} />
              </label>
              <button className="btn-ghost !text-xs" onClick={exportPoolConLai}>⬇ CSV chưa gán (đối chiếu)</button>
              <button className="btn-ghost !text-xs hover:text-danger" onClick={async () => { if (confirm("Xóa TOÀN BỘ danh sách chờ từ hãng? (không ảnh hưởng tồn kho/phiếu nháp)")) { const { error } = await supabase.rpc("fn_xoa_pool"); if (error) return notify(errMsg(error), "err"); loadPoolCount(); notify("Đã xóa danh sách chờ."); } }}>🗑</button>
            </>
          )}
        </div>
        <p className="text-[11px] text-[#8A93A0] mb-2">Nhìn tem xe → gõ 3–6 ký tự cuối số khung → chạm chọn, xe tự vào danh sách đang gom với đúng mẫu xe theo file hãng (không lo chọn nhầm model). Kho vẫn do mình chọn ở ô trên.</p>
        <div className="flex gap-1.5">
          <input className="inp font-mono !text-[14px]" placeholder="Gõ đuôi số khung, VD: 429407…" value={poolQ} onChange={(e) => setPoolQ(e.target.value.toUpperCase())} />
          <button className={`btn !px-3 !text-xs whitespace-nowrap ${poolOpen ? "bg-navy-900 text-white" : "bg-[#EEF1F4] text-[#3B4552]"}`} onClick={togglePoolList}>📋 {poolOpen ? "Ẩn danh sách" : "Xem danh sách chờ"}</button>
        </div>
        {poolOpen && (
          <div className="mt-2.5">
            {poolAll === null ? <div className="text-sm text-[#8A93A0]">Đang tải danh sách…</div> : (() => {
              const filtered = poolAll.filter((x) => !poolFilter || x.state === poolFilter);
              const counts = poolAll.reduce((m, x) => ({ ...m, [x.state]: (m[x.state] || 0) + 1 }), {});
              return (
                <>
                  <div className="flex gap-1.5 flex-wrap mb-2">
                    {["", "Chờ gán", "Đang ở phiếu", "Đã trong kho", "Đã bán"].map((st) => (
                      <button key={st} className={`btn !px-3 !py-1.5 !text-xs ${poolFilter === st ? "bg-navy-900 text-white" : "bg-[#EEF1F4] text-[#3B4552]"}`} onClick={() => { setPoolFilter(st); setPoolPage(1); }}>
                        {st === "" ? `Tất cả (${poolAll.length})` : `${st} (${counts[st] || 0})`}
                      </button>
                    ))}
                  </div>
                  <div className="overflow-x-auto"><table className="w-full border-collapse">
                    <thead><tr><th className="th w-10">STT</th><th className="th">Xe (theo file hãng)</th><th className="th">Số khung</th><th className="th">Trạng thái</th><th className="th w-20"></th></tr></thead>
                    <tbody>{pageSlice(filtered, poolPage, poolPageSize).map((x, i) => {
                      const v = vOf(x.vehicle_id);
                      const free = x.state === "Chờ gán";
                      return (
                        <tr key={x.frame_number} className="hover:bg-[#F8FAFC]">
                          <td className="td text-center text-xs text-[#8A93A0]">{(poolPage - 1) * poolPageSize + i + 1}</td>
                          <td className="td text-[13px] font-semibold">{v ? `${v.name} ${v.color}` : x.vehicle_id}<div className="text-[10.5px] text-[#8A93A0] font-normal">{x.vehicle_id}</div></td>
                          <td className="td font-mono text-[12.5px]">{x.frame_number}</td>
                          <td className="td">{free ? <Badge tone="green">Chờ gán</Badge>
                            : x.state === "Đang ở phiếu" ? <Badge tone="amber">Ở phiếu {x.ref}</Badge>
                            : x.state === "Đã bán" ? <Badge tone="gray">Đã bán</Badge>
                            : <Badge tone="blue">Kho {locNameOf(x.ref)}</Badge>}</td>
                          <td className="td">{free && <button className="btn-primary !px-2.5 !py-1 !text-xs" onClick={() => { pickPool({ ...x }); loadPoolAll(); }}>+ Chọn</button>}</td>
                        </tr>
                      );
                    })}
                    {filtered.length === 0 && <tr><td className="td" colSpan={5}>Không có số khung nào ở trạng thái này.</td></tr>}
                    </tbody>
                  </table></div>
                  <Pager total={filtered.length} page={poolPage} setPage={setPoolPage} pageSize={poolPageSize} setPageSize={setPoolPageSize} />
                </>
              );
            })()}
          </div>
        )}
        {poolQ.trim().length >= 3 && (
          <div className="mt-1.5 border border-[#E6EAEF] rounded-xl overflow-hidden">
            {poolHits.length === 0 && <div className="px-3 py-2.5 text-sm text-[#8A93A0]">Không thấy trong danh sách hãng — kiểm tra lại số hoặc dùng quét camera/gõ tay ở trên.</div>}
            {poolHits.map((h) => {
              const v = vOf(h.vehicle_id);
              const free = h.state === "Chờ gán";
              return (
                <button key={h.frame_number} className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left border-b border-[#F2F4F7] last:border-0 ${free ? "hover:bg-[#F0FDF6] cursor-pointer" : "opacity-60"}`} onClick={() => pickPool(h)}>
                  <span className="font-mono font-bold text-[13px]">{h.frame_number}</span>
                  <span className="text-xs text-[#5A6572]">{v ? `${v.name} ${v.color}` : h.vehicle_id}</span>
                  <span className="ml-auto">
                    {free ? <Badge tone="green">Chờ gán</Badge>
                      : h.state === "Đang ở phiếu" ? <Badge tone="amber">Ở phiếu {h.ref}</Badge>
                      : h.state === "Đã bán" ? <Badge tone="gray">Đã bán</Badge>
                      : <Badge tone="blue">Kho {locNameOf(h.ref)}</Badge>}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="card">
        <div className="flex items-center gap-2 flex-wrap mb-2.5">
          <div className="font-extrabold mr-auto">Đã gom: {rows.length} xe {locLabel && `· ${locLabel}`}</div>
          <button className="btn-primary !text-xs" disabled={busy} onClick={saveDraft}>💾 Lưu phiếu nháp</button>
          <button className="btn-ok !text-xs" onClick={() => rows.length ? (exportRows(rows, `quet_${loc || "kho"}`), notify(`Đã xuất ${rows.length} số khung — gửi Zalo cho Admin/BGĐ kèm tên kho.`)) : notify("Chưa có số khung nào.", "err")}>⬇ Xuất CSV</button>
          {canImport && <button className="btn-primary !text-xs" disabled={busy} onClick={importCurrent}>{busy ? "Đang xử lý…" : "⚡ Nhập thẳng vào kho"}</button>}
          {rows.length > 0 && <button className="btn-danger !text-xs" onClick={() => confirm("Xóa toàn bộ danh sách đang gom?") && newDraft()}>Làm lại</button>}
        </div>
        {rows.length === 0 ? <div className="text-sm text-[#8A93A0]">Chưa quét xe nào. Chọn mẫu xe rồi bấm nút quét, hoặc mở một phiếu nháp bên dưới để sửa.</div> : (
          <div className="overflow-x-auto"><table className="w-full border-collapse">
            <thead><tr><th className="th w-10">STT</th><th className="th">Hãng</th><th className="th">Tên xe</th><th className="th">Màu</th><th className="th">Số khung (sửa được)</th><th className="th w-8"></th></tr></thead>
            <tbody>{rows.map((r, i) => {
              const v = vOf(r.vehicle_id);
              return (
                <tr key={i} className="hover:bg-[#F8FAFC]">
                  <td className="td text-center text-xs text-[#8A93A0]">{i + 1}</td>
                  <td className="td text-xs">{v?.brand || "?"}</td>
                  <td className="td font-semibold text-[13px]">{v?.name || r.vehicle_id}</td>
                  <td className="td text-xs">{v?.color || ""}</td>
                  <td className="td"><input className="inp !py-1.5 !text-[12.5px] font-mono !w-56 max-w-full" value={r.frame} onChange={(e) => editFrame(i, e.target.value)} /></td>
                  <td className="td"><button className="text-[#C6CDD6] hover:text-danger" title="Xóa dòng" onClick={() => setRows((p) => p.filter((_, j) => j !== i))}>✕</button></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </div>

      <div className="card">
        <div className="flex items-center gap-2 flex-wrap mb-2.5">
          <div className="font-extrabold mr-auto">Danh sách phiếu nhập nháp</div>
          {["Nháp", "Đã nhập"].map((t) => (
            <button key={t} className={`btn !px-3 !py-2 !text-xs ${dTab === t ? "bg-navy-900 text-white" : "bg-[#EEF1F4] text-[#3B4552]"}`} onClick={() => setDTab(t)}>
              {t} ({drafts.filter((d) => d.status === t).length})
            </button>
          ))}
        </div>
        {shown.length === 0 ? <div className="text-sm text-[#8A93A0]">Chưa có phiếu nào ở mục này.</div> : (
          <div className="overflow-x-auto"><table className="w-full border-collapse">
            <thead><tr><th className="th">Phiếu</th><th className="th">Kho</th><th className="th">Số xe</th><th className="th">Người tạo</th><th className="th">Cập nhật</th><th className="th">Trạng thái</th><th className="th"></th></tr></thead>
            <tbody>{shown.map((d) => (
              <tr key={d.id} className="hover:bg-[#F8FAFC]">
                <td className="td font-bold">{d.code}{d.imported_doc && <div className="text-[10.5px] text-[#8A93A0] font-normal">→ {d.imported_doc}</div>}</td>
                <td className="td text-xs">{locNameOf(d.location_code)}</td>
                <td className="td font-bold text-center">{(d.rows || []).length}</td>
                <td className="td text-xs">{d.created_by_name}</td>
                <td className="td text-xs">{fmtTime(d.updated_at)}</td>
                <td className="td">{d.status === "Nháp" ? <Badge tone="amber">Nháp</Badge> : <Badge tone="green">Đã nhập{d.imported_by_name ? ` · ${d.imported_by_name}` : ""}</Badge>}</td>
                <td className="td"><div className="flex gap-1.5 flex-wrap">
                  {d.status === "Nháp" && <button className="btn-ghost !px-2.5 !py-1 !text-xs" onClick={() => openDraft(d)}>✏ Mở sửa</button>}
                  <button className="btn-ghost !px-2.5 !py-1 !text-xs" onClick={() => exportRows(d.rows || [], d.code)}>CSV</button>
                  {canImport && d.status === "Nháp" && <button className="btn-primary !px-2.5 !py-1 !text-xs" disabled={busy} onClick={() => importDraft(d)}>⚡ Nhập</button>}
                  {d.status === "Nháp" && <button className="btn-ghost !px-2 !py-1 !text-xs hover:text-danger" onClick={() => delDraft(d)}>🗑</button>}
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <p className="text-[11px] text-[#8A93A0] mt-2">Sales lưu phiếu nháp → Quản lý/Admin/BGĐ mở sửa nếu cần → Admin/BGĐ bấm ⚡ Nhập là xe vào kho, phiếu chuyển sang "Đã nhập" kèm mã chứng từ.</p>
      </div>
    </div>
  );
}
