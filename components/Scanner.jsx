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
  const [last, setLast] = useState("");
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
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");
        if (!mounted) return;
        // Khai bao ro cac dinh dang: QR + ma vach 1D (Code128/39, EAN, UPC, ITF...)
        inst = new Html5Qrcode("mk-scan-region", {
          formatsToSupport: [
            Html5QrcodeSupportedFormats.QR_CODE,
            Html5QrcodeSupportedFormats.DATA_MATRIX,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.CODE_93,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.ITF,
            Html5QrcodeSupportedFormats.CODABAR,
          ],
          verbose: false,
        });
        scannerRef.current = inst;
        await inst.start(
          { facingMode: "environment" },
          {
            fps: 15,
            // Khung quet NGANG rong — ma vach 1D can chieu ngang lon
            qrbox: (w, h) => ({ width: Math.min(Math.floor(w * 0.9), 420), height: 150 }),
            // Uu tien bo giai ma goc cua trinh duyet (BarcodeDetector) — doc 1D tot hon han
            experimentalFeatures: { useBarCodeDetectorIfSupported: true },
            // Xin do phan giai cao de net vach nho
            videoConstraints: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
          },
          (text) => {
            const v = String(text).trim().toUpperCase();
            if (!v) return;
            setCodes((p) => {
              if (p.includes(v)) return p;
              beep();
              setLast(v);
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
            <div id="mk-scan-region" className="rounded-xl overflow-hidden bg-black min-h-[140px] [&_video]:!max-h-[30vh] [&_video]:!w-full [&_video]:!object-cover" />
            {last && (
              <div className="mt-2 flex items-center gap-2 bg-[#E5F6EE] rounded-xl px-3 py-2.5">
                <span className="text-[11px] font-bold text-[#0E7A4A] shrink-0">✓ Vừa quét:</span>
                <span className="font-mono font-extrabold text-[15px] text-[#0E7A4A] tracking-wide break-all">{last}</span>
              </div>
            )}
            <p className="text-[11px] text-[#5A6572] mt-2">Đưa mã vào giữa khung, giữ máy cách tem 10–20cm cho nét. Mã vạch 1D: để mã nằm NGANG, chiếm gần hết chiều rộng khung. Quét trúng kêu "bíp" và tự thêm — quét liên tục nhiều xe không cần bấm gì. Trên điện thoại Android/Chrome tốc độ đọc mã vạch nhanh nhất.</p>
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
