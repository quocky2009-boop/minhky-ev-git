"use client";
// Quet ma vach/QR bang camera + OCR anh chup -> tra ve danh sach so khung
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui";

const beep = () => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 1200; g.gain.value = 0.15;
    o.start(); setTimeout(() => { o.stop(); ctx.close(); }, 120);
  } catch {}
};

export default function Scanner({ onAdd, onClose }) {
  const [tab, setTab] = useState("scan");
  const [codes, setCodes] = useState([]);        // ma da quet trong phien
  const [err, setErr] = useState("");
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrFound, setOcrFound] = useState([]);  // {text, checked}
  const scannerRef = useRef(null);
  const fileRef = useRef(null);

  // ===== TAB 1: QUET MA VACH / QR =====
  useEffect(() => {
    if (tab !== "scan") return;
    let mounted = true, inst = null;
    (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (!mounted) return;
        inst = new Html5Qrcode("mk-scan-region");
        scannerRef.current = inst;
        await inst.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 260, height: 140 } },
          (text) => {
            const v = String(text).trim().toUpperCase();
            if (!v) return;
            setCodes((p) => {
              if (p.includes(v)) return p;
              beep();
              return [...p, v];
            });
          },
          () => {}
        );
      } catch (e) {
        setErr("Không mở được camera. Kiểm tra: (1) đã cho phép quyền camera, (2) đang chạy trên https hoặc localhost. " + (e?.message || ""));
      }
    })();
    return () => {
      mounted = false;
      if (inst) { inst.stop().then(() => inst.clear()).catch(() => {}); }
      scannerRef.current = null;
    };
  }, [tab]);

  // ===== TAB 2: OCR ANH CHUP =====
  const runOCR = async (file) => {
    setOcrBusy(true); setOcrFound([]); setErr("");
    try {
      const Tesseract = (await import("tesseract.js")).default;
      const worker = await Tesseract.createWorker("eng");
      await worker.setParameters({ tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" });
      const { data } = await worker.recognize(file);
      await worker.terminate();
      const raw = (data.text || "").toUpperCase();
      // Lay cac day chu-so lien tuc 8-20 ky tu (so khung/VIN thuong 17)
      const cands = [...new Set((raw.match(/[A-Z0-9]{8,20}/g) || []))];
      if (cands.length === 0) setErr("Không nhận diện được dãy số khung nào trong ảnh. Chụp gần hơn, đủ sáng, tem thẳng góc.");
      setOcrFound(cands.map((t) => ({ text: t, checked: t.length === 17 })));
    } catch (e) {
      setErr("Lỗi OCR: " + (e?.message || e) + ". Lần đầu chạy cần internet để tải bộ nhận dạng (~2MB).");
    }
    setOcrBusy(false);
  };

  const totalPick = codes.length + ocrFound.filter((x) => x.checked).length;
  const finish = () => {
    const picked = [...codes, ...ocrFound.filter((x) => x.checked).map((x) => x.text)];
    onAdd([...new Set(picked)]);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[90] bg-black/60 flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-white rounded-2xl w-[480px] max-w-full max-h-[92vh] overflow-y-auto p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center mb-3">
          <div className="font-extrabold text-base mr-auto">Quét số khung</div>
          <button className="btn-ghost !px-3 !py-1.5 !text-xs" onClick={onClose}>✕ Đóng</button>
        </div>
        <div className="flex gap-1.5 mb-3">
          <button className={`btn !px-3 !py-2 !text-xs ${tab === "scan" ? "bg-brand text-white" : "bg-[#EEF1F4] text-[#3B4552]"}`} onClick={() => setTab("scan")}>📷 Quét mã vạch / QR</button>
          <button className={`btn !px-3 !py-2 !text-xs ${tab === "ocr" ? "bg-brand text-white" : "bg-[#EEF1F4] text-[#3B4552]"}`} onClick={() => setTab("ocr")}>🔤 Chụp ảnh đọc chữ (OCR)</button>
        </div>

        {err && <div className="text-xs text-danger font-semibold mb-2">{err}</div>}

        {tab === "scan" && (
          <>
            <div id="mk-scan-region" className="rounded-xl overflow-hidden bg-black min-h-[240px]" />
            <p className="text-[11px] text-[#5A6572] mt-2">Đưa mã vạch trên tem số khung / thùng xe vào khung. Quét trúng sẽ kêu "bíp" và tự thêm vào danh sách — quét liên tục nhiều xe không cần bấm gì.</p>
          </>
        )}

        {tab === "ocr" && (
          <>
            <button className="btn-primary w-full" disabled={ocrBusy} onClick={() => fileRef.current?.click()}>
              {ocrBusy ? "Đang đọc ảnh… (10–20 giây)" : "📸 Chụp / chọn ảnh tem số khung"}
            </button>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => { if (e.target.files[0]) runOCR(e.target.files[0]); e.target.value = ""; }} />
            {ocrFound.length > 0 && (
              <div className="mt-3 border border-[#E6EAEF] rounded-xl overflow-hidden">
                <div className="px-3 py-2 bg-[#F8FAFC] text-xs font-bold">Máy đọc được các dãy sau — tick đúng số khung (dãy 17 ký tự được tick sẵn):</div>
                {ocrFound.map((x, i) => (
                  <label key={x.text} className="flex items-center gap-2.5 px-3 py-2 text-sm border-t border-[#F2F4F7] cursor-pointer">
                    <input type="checkbox" checked={x.checked} onChange={() => setOcrFound((p) => p.map((y, j) => j === i ? { ...y, checked: !y.checked } : y))} />
                    <span className="font-mono">{x.text}</span>
                    <span className="ml-auto text-[11px] text-[#8A93A0]">{x.text.length} ký tự</span>
                  </label>
                ))}
              </div>
            )}
            <p className="text-[11px] text-[#5A6572] mt-2">Mẹo: chụp thẳng góc, đủ sáng, tem chiếm gần hết khung hình. OCR nên dùng cho tem in; số dập chìm trên khung kim loại đọc kém — ưu tiên quét mã vạch.</p>
          </>
        )}

        {codes.length > 0 && (
          <div className="mt-3">
            <div className="text-xs font-bold mb-1.5">Đã quét trong phiên này ({codes.length}):</div>
            <div className="flex gap-1.5 flex-wrap max-h-28 overflow-y-auto">
              {codes.map((c) => (
                <span key={c} className="inline-flex items-center gap-1 bg-[#E5F6EE] text-[#0E7A4A] text-[11px] font-mono font-bold px-2 py-1 rounded-lg">
                  {c}<button className="text-[#0E7A4A]/60 hover:text-danger" onClick={() => setCodes((p) => p.filter((x) => x !== c))}>✕</button>
                </span>
              ))}
            </div>
          </div>
        )}

        <button className="btn-ok w-full mt-3" disabled={totalPick === 0} onClick={finish}>
          Thêm {totalPick} số khung vào danh sách
        </button>
      </div>
    </div>
  );
}
