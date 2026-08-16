-- ============================================================
-- Migration 080: Cho phép chọn "Người nhập" (Nhập hàng) và
-- "Người tạo" (Điều chuyển) thay vì luôn lấy theo profile CEO/BGĐ.
-- Nguyên nhân cũ: 2 hàm RPC luôn ghi me.uid/me.name (người đang
-- đăng nhập lúc gọi RPC) — đúng về mặt kỹ thuật, nhưng UI cần cho
-- phép chọn nhân viên khác (giống "Bán bởi" ở Đơn bán).
-- Thêm tham số optional 'nguoi_nhap_id' / 'nguoi_tao_id' (uuid),
-- không có thì mặc định là người đang đăng nhập. Quyền hạn (nhap_hang,
-- dieu_chuyen) vẫn kiểm tra theo người đang đăng nhập thực tế.
-- Chạy SAU 079. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

-- ---------- A) NHẬP HÀNG ----------
create or replace function public.fn_nhap_hang_v2(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; v_doc text; ln jsonb; f text; v_loc text;
  v_before int; v_n int := 0; v_xe int := 0; v_von bigint := 0;
  v_frames text[]; v_cost bigint; v_nv_id uuid; v_nv_name text;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('nhap_hang') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền nhập hàng'; end if;

  v_nv_id := nullif(p->>'nguoi_nhap_id','')::uuid;
  if v_nv_id is not null and exists (select 1 from public.profiles where id = v_nv_id) then
    select name into v_nv_name from public.profiles where id = v_nv_id;
  else
    v_nv_id := me.uid; v_nv_name := me.name;
  end if;

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
      v_nv_id, v_nv_name);
    v_xe := v_xe + 1;
  end loop;

  if v_n = 0 then raise exception 'THIEU_SO_KHUNG: không có số khung hợp lệ nào'; end if;

  perform public._notify_discord(jsonb_build_object('content',
    concat('📦 **Nhập hàng ', v_doc, '** · ', v_n, ' xe (', v_xe, ' mã) · kho ', v_loc,
      case when coalesce(p->>'supplier','') <> '' then concat(' · NCC ', p->>'supplier') else '' end,
      case when v_von > 0 then concat(E'\n💰 Tổng giá vốn: ', to_char(v_von, 'FM999,999,999,999'), 'đ') else '' end,
      E'\n👤 ', v_nv_name)));

  return jsonb_build_object('doc', v_doc, 'so_ma', v_n, 'so_xe', v_xe, 'von', v_von);
end $$;

-- ---------- B) ĐIỀU CHUYỂN ----------
create or replace function public.fn_tao_dieu_chuyen_v2(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; v_code text; f text; u record; v_from text; v_to text;
  v_frames text[]; v_n int := 0; v_vehicle_id text; v_nv_id uuid; v_nv_name text;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('dieu_chuyen') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền điều chuyển'; end if;

  v_nv_id := nullif(p->>'nguoi_tao_id','')::uuid;
  if v_nv_id is not null and exists (select 1 from public.profiles where id = v_nv_id) then
    select name into v_nv_name from public.profiles where id = v_nv_id;
  else
    v_nv_id := me.uid; v_nv_name := me.name;
  end if;

  v_from := p->>'from_location';
  v_to   := p->>'to_location';
  if coalesce(v_from,'') = '' or coalesce(v_to,'') = '' then
    raise exception 'THIEU_THONG_TIN: chọn kho đi và kho đến';
  end if;
  if v_from = v_to then raise exception 'KHO_TRUNG: kho đi và kho đến không được trùng'; end if;

  select array_agg(x) into v_frames from jsonb_array_elements_text(coalesce(p->'frames','[]'::jsonb)) x;
  if coalesce(array_length(v_frames,1),0) = 0 then
    raise exception 'THIEU_SO_KHUNG: chưa chọn xe nào';
  end if;

  v_code := public.fn_next_code('DCH');

  foreach f in array v_frames loop
    f := upper(btrim(f));
    select * into u from public.vehicle_units where frame_number = f for update;
    if u is null then raise exception 'SO_KHUNG_KHONG_CO: % không có trên hệ thống', f; end if;
    if u.location_code <> v_from then
      raise exception 'SAI_KHO: xe % đang ở kho %, không phải kho đi đã chọn', f, u.location_code;
    end if;
    if u.status <> 'TON_KHO' then
      raise exception 'XE_KHONG_SAN_SANG: xe % đang ở trạng thái %', f,
        case u.status when 'GIU_CHO' then 'giữ chỗ (có cọc)'
                      when 'DANG_CHUYEN' then 'đang chuyển'
                      when 'DA_BAN' then 'đã bán' else u.status end;
    end if;
    update public.vehicle_units
    set status = 'DANG_CHUYEN', transfer_code = v_code, updated_at = now()
    where frame_number = f;

    if v_vehicle_id is null then v_vehicle_id := u.vehicle_id; end if;
    v_n := v_n + 1;
  end loop;

  insert into public.transfer_orders (code, from_location, to_location, vehicle_id, quantity,
    requested_by, requested_by_name, note, frames, status)
  values (v_code, v_from, v_to, v_vehicle_id, v_n,
    v_nv_id, v_nv_name, coalesce(p->>'note',''), v_frames, 'Đang chuyển');

  return jsonb_build_object('code', v_code, 'so_xe', v_n);
end $$;
