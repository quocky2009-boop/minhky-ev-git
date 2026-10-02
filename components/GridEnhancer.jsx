"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Tuy bien bang luoi cho MOI bang trong app (khong can sua tung trang):
//  - keo canh phai tieu de cot de doi do rong (nhap dup de dat lai cot do)
//  - keo tha tieu de cot de doi thu tu (cot checkbox / cot thao tac giu nguyen cho)
//  - luu theo tung nguoi dung (bang user_grid_prefs + cache localStorage)
// Khoa bang = duong dan trang + tap ten cot, nen on dinh du thu tu cot da doi.
const MIN_W = 48;
const clean = (t) => (t || "").replace(/[⇅↑↓▲▼↕⇵]/g, "").replace(/\s+/g, " ").trim();

export default function GridEnhancer({ userId }) {
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  useEffect(() => {
    if (!userId) return;
    const sb = createClient();
    const LS = `gridprefs:${userId}`;
    let prefs = {};
    try { prefs = JSON.parse(localStorage.getItem(LS) || "{}") || {}; } catch { prefs = {}; }
    const timers = {};
    let ready = true, raf = 0, obs = null, dead = false;

    const persist = (key) => {
      try { localStorage.setItem(LS, JSON.stringify(prefs)); } catch {}
      clearTimeout(timers[key]);
      timers[key] = setTimeout(() => {
        sb.from("user_grid_prefs")
          .upsert({ user_id: userId, grid_key: key, prefs: prefs[key] || {}, updated_at: new Date().toISOString() }, { onConflict: "user_id,grid_key" })
          .then(() => {}, () => {});
      }, 700);
    };

    const headThs = (table) => {
      const head = table.querySelector("thead tr");
      return head ? Array.from(head.children).filter((c) => c.tagName === "TH") : [];
    };

    const init = (table) => {
      const head = table.querySelector("thead tr");
      if (!head) return false;
      const ths = headThs(table);
      if (ths.length < 2 || ths.length !== head.children.length) return false;
      if (ths.some((th) => th.colSpan > 1)) return false;
      if (table.closest("td")) return false;
      if (getComputedStyle(head.parentElement).display === "none") return false;
      if (table._gids && !ths.every((th) => th.dataset.gid)) table._gids = null;
      if (!table._gids) {
        const used = {}, gids = [], pin = new Set();
        ths.forEach((th, i) => {
          let g = clean(th.textContent);
          if (!g) { g = "~pin" + i; pin.add(g); }
          if (used[g]) g = g + "#" + i;
          used[g] = 1;
          th.dataset.gid = g; gids.push(g);
        });
        table._gids = gids; table._pin = pin;
        table._key = pathRef.current + "|" + [...gids].sort().join(",");
      }
      return true;
    };

    const targetGids = (table, p) => {
      const orig = table._gids, pin = table._pin;
      const mov = orig.filter((g) => !pin.has(g));
      const ord = ((p && p.order) || []).filter((g) => mov.includes(g));
      mov.forEach((g) => { if (!ord.includes(g)) ord.push(g); });
      let k = 0;
      return orig.map((g) => (pin.has(g) ? g : ord[k++]));
    };

    const applyRow = (row, table, target) => {
      const cells = Array.from(row.children);
      if (cells.length !== table._gids.length) return;
      if (!cells[0].dataset.gid) cells.forEach((c, i) => { c.dataset.gid = table._gids[i]; });
      else if (cells.some((c) => !c.dataset.gid)) return;
      const by = {};
      cells.forEach((c) => { by[c.dataset.gid] = c; });
      if (target.some((g) => !by[g])) return;
      if (target.every((g, i) => cells[i] === by[g])) return;
      target.forEach((g) => row.appendChild(by[g]));
    };

    const setWidths = (table, widths) => {
      const ths = headThs(table);
      let sum = 0;
      ths.forEach((th) => {
        const w = widths[th.dataset.gid] || th.getBoundingClientRect().width;
        th.style.width = w + "px"; th.style.minWidth = w + "px";
        sum += w;
      });
      table.style.tableLayout = "fixed";
      table.style.width = sum + "px";
      table.style.minWidth = "100%";
      table._wset = true;
    };
    const clearWidths = (table) => {
      headThs(table).forEach((th) => { th.style.width = ""; th.style.minWidth = ""; });
      table.style.tableLayout = ""; table.style.width = ""; table.style.minWidth = "";
      table._wset = false;
    };

    const moveCol = (table, from, to) => {
      const key = table._key;
      const cur = targetGids(table, prefs[key]).filter((g) => !table._pin.has(g));
      const fi = cur.indexOf(from), ti = cur.indexOf(to);
      if (fi < 0 || ti < 0) return;
      cur.splice(fi, 1); cur.splice(ti, 0, from);
      prefs[key] = { ...(prefs[key] || {}), order: cur };
      persist(key);
      applyAll(table);
    };

    const decorate = (table) => {
      const key = table._key;
      headThs(table).forEach((th) => {
        const gid = th.dataset.gid;
        if (getComputedStyle(th).position === "static") th.style.position = "relative";
        if (!th.querySelector(":scope > .grid-rs")) {
          const h = document.createElement("div");
          h.className = "grid-rs"; h.title = "Kéo để đổi độ rộng cột · nhấp đúp để đặt lại";
          h.addEventListener("click", (e) => e.stopPropagation());
          h.addEventListener("dblclick", (e) => {
            e.stopPropagation();
            const p = { ...(prefs[key] || {}) }; delete p.widths; prefs[key] = p;
            persist(key); clearWidths(table);
          });
          h.addEventListener("mousedown", (e) => {
            e.preventDefault(); e.stopPropagation();
            const snap = {};
            headThs(table).forEach((t) => { snap[t.dataset.gid] = t.getBoundingClientRect().width; });
            setWidths(table, snap);
            const startX = e.clientX, startW = snap[th.dataset.gid];
            document.body.style.userSelect = "none";
            const move = (ev) => { snap[th.dataset.gid] = Math.max(MIN_W, startW + ev.clientX - startX); setWidths(table, snap); };
            const up = () => {
              document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up);
              document.body.style.userSelect = "";
              prefs[key] = { ...(prefs[key] || {}), widths: { ...snap } };
              persist(key); decorate(table);
            };
            document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
          });
          th.appendChild(h);
        }
        if (!th._gb && !table._pin.has(gid)) {
          th._gb = true; th.draggable = true;
          th.addEventListener("dragstart", (e) => {
            table._drag = th.dataset.gid;
            e.dataTransfer.effectAllowed = "move";
            try { e.dataTransfer.setData("text/plain", th.dataset.gid); } catch {}
          });
          th.addEventListener("dragover", (e) => {
            if (table._drag && table._drag !== th.dataset.gid) { e.preventDefault(); th.style.boxShadow = "inset 3px 0 0 #1E4FD8"; }
          });
          th.addEventListener("dragleave", () => { th.style.boxShadow = ""; });
          th.addEventListener("drop", (e) => {
            e.preventDefault(); th.style.boxShadow = "";
            const from = table._drag; table._drag = null;
            if (from && from !== th.dataset.gid) moveCol(table, from, th.dataset.gid);
          });
          th.addEventListener("dragend", () => { table._drag = null; headThs(table).forEach((t) => { t.style.boxShadow = ""; }); });
        }
      });

      const wrap = table.parentElement;
      const p = prefs[key];
      const custom = p && ((p.order && p.order.length) || (p.widths && Object.keys(p.widths).length));
      const btn = wrap && wrap.querySelector(":scope > .grid-reset");
      if (custom && wrap && !btn) {
        if (getComputedStyle(wrap).position === "static") wrap.style.position = "relative";
        const b = document.createElement("button");
        b.type = "button"; b.className = "grid-reset"; b.textContent = "↺ Đặt lại cột";
        b.title = "Trả bảng về thứ tự và độ rộng cột mặc định";
        b.addEventListener("click", () => {
          prefs[key] = {}; persist(key); clearWidths(table); applyAll(table); b.remove();
        });
        wrap.appendChild(b);
      } else if (!custom && btn) btn.remove();
    };

    function applyAll(table) {
      const p = prefs[table._key];
      const target = targetGids(table, p);
      Array.from(table.rows).forEach((r) => applyRow(r, table, target));
      if (p && p.widths && Object.keys(p.widths).length) setWidths(table, p.widths);
      else if (table._wset) clearWidths(table);
      decorate(table);
    }

    const scan = () => {
      raf = 0;
      if (dead || !ready) return;
      if (obs) obs.disconnect();
      try {
        const m = document.querySelector("main");
        if (m) m.querySelectorAll("table").forEach((table) => { if (init(table)) applyAll(table); });
      } catch { /* khong de loi tien ich lam hong trang */ }
      finally {
        const m = document.querySelector("main");
        if (obs && m && !dead) obs.observe(m, { childList: true, subtree: true });
      }
    };
    const schedule = () => { if (!raf && !dead) raf = requestAnimationFrame(() => setTimeout(scan, 60)); };

    const m = document.querySelector("main");
    obs = new MutationObserver(schedule);
    if (m) obs.observe(m, { childList: true, subtree: true });

    sb.from("user_grid_prefs").select("grid_key,prefs").then(({ data }) => {
      (data || []).forEach((r) => { prefs[r.grid_key] = r.prefs || {}; });
      try { localStorage.setItem(LS, JSON.stringify(prefs)); } catch {}
    }, () => {}).finally(() => { schedule(); });

    return () => { dead = true; if (obs) obs.disconnect(); Object.values(timers).forEach(clearTimeout); };
  }, [userId]);

  return null;
}
