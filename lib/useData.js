"use client";
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

// Hook dùng chung: nạp danh mục xe, kho, tồn và profile người dùng
export function useCatalog() {
  const supabase = createClient();
  const [vehicles, setVehicles] = useState([]);
  const [locations, setLocations] = useState([]);
  const [brands, setBrands] = useState([]);
  const [settings, setSettings] = useState({});
  const [customFields, setCustomFields] = useState([]);
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [inv, setInv] = useState({});
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [{ data: v }, { data: l }, { data: i }, { data: b }, { data: st }, { data: cf }, { data: pmt }] = await Promise.all([
      supabase.from("vehicles").select("*").order("name"),
      supabase.from("locations").select("*").neq("status", "Đã xóa").order("region").order("name"),
      supabase.from("inventory").select("*"),
      supabase.from("brands").select("*").order("name"),
      supabase.from("app_settings").select("*"),
      supabase.from("custom_fields").select("*").eq("active", true).order("sort"),
      supabase.from("payment_methods").select("*").eq("is_active", true).order("sort_order"),
    ]);
    setVehicles(v || []); setLocations(l || []);
    setBrands(b || []); setCustomFields(cf || []);
    setPaymentMethods(pmt || []);
    const sm = {}; (st || []).forEach((r) => { sm[r.key] = r.value; }); setSettings(sm);
    const map = {};
    (i || []).forEach((r) => { map[r.vehicle_id + "|" + r.location_code] = r.quantity; });
    setInv(map);
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).single();
        setProfile(p);
      }
      refresh();
    })();
  }, [refresh]);

  const getQty = (vid, loc) => inv[vid + "|" + loc] || 0;
  const totalQty = (vid) => locations.reduce((s, l) => s + getQty(vid, l.code), 0);
  const regionQty = (vid, region) => locations.filter((l) => l.region === region).reduce((s, l) => s + getQty(vid, l.code), 0);

  const taxRate = parseFloat(settings.tax_rate || "0.08");
  const regions = [...new Set([
    ...(settings.regions || "Thành phố\nHàm Yên").split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean),
    ...locations.map((l) => l.region),
  ])];
  return { supabase, vehicles, locations, brands, settings, taxRate, regions, customFields, paymentMethods, inv, profile, loading, refresh, getQty, totalQty, regionQty };
}

export function useToast() {
  const [toast, setToast] = useState(null);
  const notify = (msg, tone = "ok") => { setToast({ msg, tone }); setTimeout(() => setToast(null), 3500); };
  return { toast, notify };
}