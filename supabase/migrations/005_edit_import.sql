-- ============================================================
-- Migration 005: Sua danh muc xe/kho, import so khung hang loat,
-- danh sach nha cung cap. Chay SAU 004, 1 lan duy nhat.
-- ============================================================

-- Danh sach nha cung cap (chinh trong Cai dat)
insert into public.app_settings(key, value) values ('suppliers', 'VinFast
TAILG') on conflict do nothing;

-- ---- SUA THONG TIN XE (ma noi bo giu nguyen de khong vo lien ket ton/don) ----
create or replace function public.fn_sua_xe(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN'; end if;
  if not exists (select 1 from public.brands where name = trim(p->>'brand')) then
    insert into public.brands(name) values (trim(p->>'brand'));
  end if;
  update public.vehicles set
    brand = coalesce(nullif(trim(p->>'brand'),''), brand),
    name = coalesce(nullif(trim(p->>'name'),''), name),
    color = coalesce(nullif(trim(p->>'color'),''), color),
    mfr_code = coalesce(p->>'mfr_code', mfr_code),
    list_price = coalesce((p->>'list_price')::bigint, list_price),
    min_stock = coalesce((p->>'min_stock')::int, min_stock),
    status = coalesce(nullif(p->>'status',''), status),
    updated_at = now()
  where id = p->>'id';
  if not found then raise exception 'KHONG_TIM_THAY: mã xe không tồn tại'; end if;
end $$;

-- ---- SUA THONG TIN KHO (ma kho giu nguyen) ----
create or replace function public.fn_sua_kho(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN'; end if;
  update public.locations set
    name = coalesce(nullif(trim(p->>'name'),''), name),
    region = coalesce(nullif(p->>'region',''), region),
    type = coalesce(nullif(p->>'type',''), type),
    address = coalesce(p->>'address', address),
    status = coalesce(nullif(p->>'status',''), status)
  where code = p->>'code';
  if not found then raise exception 'KHONG_TIM_THAY: mã kho không tồn tại'; end if;
end $$;

-- ---- IMPORT SO KHUNG HANG LOAT VAO 1 KHO ----
-- p_rows: [{frame_number, vehicle_id, imported_at?, engine_number?, note?}]
-- Tra ve jsonb {inserted: n, skipped: [danh sach so khung bi bo qua + ly do]}
create or replace function public.fn_import_units(p_loc text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; r jsonb; f text; vid text; n int := 0;
        skipped jsonb := '[]'::jsonb; v_doc text; v_before int;
        touched text[] := '{}';
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN: chỉ Admin/BGĐ được import tồn'; end if;
  if not exists (select 1 from public.locations where code = p_loc) then raise exception 'KHONG_TIM_THAY: mã kho không tồn tại'; end if;
  v_doc := public.fn_gen_code('IMP');
  for r in select jsonb_array_elements(p_rows) loop
    f := upper(trim(coalesce(r->>'frame_number','')));
    vid := trim(coalesce(r->>'vehicle_id',''));
    if f = '' or vid = '' then
      skipped := skipped || jsonb_build_object('frame', f, 'ly_do', 'Thiếu số khung hoặc mã xe');
    elsif not exists (select 1 from public.vehicles where id = vid) then
      skipped := skipped || jsonb_build_object('frame', f, 'ly_do', 'Mã xe '||vid||' không có trong danh mục');
    elsif exists (select 1 from public.vehicle_units where frame_number = f) then
      skipped := skipped || jsonb_build_object('frame', f, 'ly_do', 'Số khung đã tồn tại trên hệ thống');
    else
      insert into public.vehicle_units(frame_number, vehicle_id, location_code, status, engine_number, imported_at, import_doc, note)
      values (f, vid, p_loc, 'TON_KHO', coalesce(r->>'engine_number',''),
              coalesce(nullif(r->>'imported_at','')::timestamptz, now()), v_doc, coalesce(r->>'note',''));
      n := n + 1;
      if not (vid = any(touched)) then touched := touched || vid; end if;
    end if;
  end loop;
  -- Ghi 1 dong lich su cho moi ma xe co them
  foreach vid in array touched loop
    v_before := public._count_at(vid, p_loc);
    perform public._log_txn('Nhập hàng', vid, null, p_loc,
      (select count(*)::int from public.vehicle_units where import_doc = v_doc and vehicle_id = vid),
      v_before - (select count(*)::int from public.vehicle_units where import_doc = v_doc and vehicle_id = vid),
      v_before, v_doc, 'Import CSV hàng loạt', me.uid, me.name);
  end loop;
  return jsonb_build_object('inserted', n, 'doc', v_doc, 'skipped', skipped);
end $$;

-- ---- Xe them qua dieu chinh voi so khung tam SKT- -> danh dau la placeholder ----
create or replace function public.fn_duyet_dieu_chinh(p_id bigint, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare me record; ad record; v_sys int; f text; n int := 0;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN: chỉ Admin/BGĐ được duyệt điều chỉnh'; end if;
  select * into ad from public.stock_adjustments where id = p_id for update;
  if ad.status <> 'Chờ duyệt' then raise exception 'TRANG_THAI_SAI'; end if;
  if p_approve then
    v_sys := public._count_at(ad.vehicle_id, ad.location_code);
    for f in select jsonb_array_elements_text(ad.frames_remove) loop
      update public.vehicle_units set status='DA_XOA', removed_reason=ad.reason, updated_at=now()
      where frame_number=f and status='TON_KHO';
      n := n - 1;
    end loop;
    for f in select jsonb_array_elements_text(ad.frames_add) loop
      f := upper(trim(f));
      if exists (select 1 from public.vehicle_units where frame_number=f) then
        update public.vehicle_units set status='TON_KHO', location_code=ad.location_code, vehicle_id=ad.vehicle_id, removed_reason='', updated_at=now() where frame_number=f;
      else
        insert into public.vehicle_units(frame_number, vehicle_id, location_code, status, is_placeholder, import_doc, note)
        values (f, ad.vehicle_id, ad.location_code, 'TON_KHO', (f like 'SKT-%'), ad.code, 'Thêm qua điều chỉnh: '||ad.reason);
      end if;
      n := n + 1;
    end loop;
    if n <> 0 then
      perform public._log_txn('Điều chỉnh', ad.vehicle_id,
        case when n < 0 then ad.location_code end, case when n > 0 then ad.location_code end,
        n, v_sys, v_sys + n, ad.code, ad.reason||coalesce('. '||nullif(ad.note,''),''), me.uid, me.name);
    end if;
    update public.stock_adjustments set status='Đã duyệt', approved_by=me.uid, approved_by_name=me.name, approved_at=now() where id = p_id;
  else
    update public.stock_adjustments set status='Từ chối', approved_by=me.uid, approved_by_name=me.name, approved_at=now() where id = p_id;
  end if;
end $$;
