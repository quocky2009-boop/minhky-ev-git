-- ============================================================
-- Migration 047 — NHẬP HÀNG V2: nhiều mã xe trong 1 phiếu
-- Ham cu fn_nhap_hang chi nhan 1 ma xe + danh sach so khung.
-- Ban moi: 1 phieu nhap co NHIEU DONG, moi dong 1 ma xe + so khung
-- + gia von rieng -> hop voi bo cuc form moi (giong don ban).
-- Chay SAU 046. Chay lai nhieu lan van an toan.
-- ============================================================

create or replace function public.fn_nhap_hang_v2(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; v_doc text; ln jsonb; f text; v_loc text;
  v_before int; v_n int := 0; v_xe int := 0; v_von bigint := 0;
  v_frames text[]; v_cost bigint;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('nhap_hang') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền nhập hàng'; end if;

  if jsonb_array_length(coalesce(p->'lines','[]'::jsonb)) = 0 then
    raise exception 'THIEU_DONG: chưa có dòng hàng nào';
  end if;
  v_loc := p->>'location_code';
  if coalesce(v_loc,'') = '' then raise exception 'THIEU_THONG_TIN: chọn kho nhập'; end if;

  v_doc := coalesce(nullif(p->>'doc',''), public.fn_next_code('PN'));

  for ln in select jsonb_array_elements(p->'lines') loop
    if coalesce(ln->>'vehicle_id','') = '' then continue; end if;

    select array_agg(x) into v_frames
    from jsonb_array_elements_text(coalesce(ln->'frames','[]'::jsonb)) x;
    if coalesce(array_length(v_frames,1),0) = 0 then
      raise exception 'THIEU_SO_KHUNG: dòng % chưa có số khung nào', ln->>'vehicle_id';
    end if;

    v_cost := coalesce((ln->>'cost_price')::bigint, 0);
    v_before := public._count_at(ln->>'vehicle_id', v_loc);

    foreach f in array v_frames loop
      f := upper(btrim(f));
      if f = '' then continue; end if;
      if exists (select 1 from public.vehicle_units where frame_number = f) then
        raise exception 'TRUNG_SO_KHUNG: số khung % đã có trên hệ thống', f;
      end if;
      insert into public.vehicle_units (frame_number, vehicle_id, location_code, status,
        cost_price, imported_at, import_doc, note)
      values (f, ln->>'vehicle_id', v_loc, 'TON_KHO', v_cost, now(), v_doc,
        coalesce(ln->>'note',''));
      v_n := v_n + 1;
      v_von := v_von + v_cost;
    end loop;

    -- Ghi gia von mac dinh cho mau xe (de don ban sau nay tu lay)
    if v_cost > 0 then
      update public.vehicles set default_cost = v_cost where id = ln->>'vehicle_id';
    end if;

    perform public._log_txn('Nhập hàng', ln->>'vehicle_id', null, v_loc,
      array_length(v_frames,1), v_before, v_before + array_length(v_frames,1), v_doc,
      trim(concat(
        case when coalesce(p->>'supplier','') <> '' then concat('NCC: ', p->>'supplier', ' · ') else '' end,
        'SK: ', array_to_string(v_frames, ', '),
        case when v_cost > 0 then concat(' · giá vốn ', v_cost, 'đ/xe') else '' end,
        case when coalesce(p->>'note','') <> '' then concat(' · ', p->>'note') else '' end)),
      me.uid, me.name);
    v_xe := v_xe + 1;
  end loop;

  if v_n = 0 then raise exception 'THIEU_SO_KHUNG: không có số khung hợp lệ nào'; end if;

  perform public._notify_discord(jsonb_build_object('content',
    concat('📦 **Nhập hàng ', v_doc, '** · ', v_n, ' xe (', v_xe, ' mã) · kho ', v_loc,
      case when coalesce(p->>'supplier','') <> '' then concat(' · NCC ', p->>'supplier') else '' end,
      case when v_von > 0 then concat(E'\n💰 Tổng giá vốn: ', to_char(v_von, 'FM999,999,999,999'), 'đ') else '' end,
      E'\n👤 ', me.name)));

  return jsonb_build_object('doc', v_doc, 'so_xe', v_n, 'so_ma', v_xe, 'tong_von', v_von);
end $$;
