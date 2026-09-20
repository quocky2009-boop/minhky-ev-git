-- =====================================================================
-- 128_khuyen_mai_loc_theo_pin.sql
--
-- MỤC ĐÍCH: Cho phép 1 chương trình khuyến mại giới hạn theo Hình thức
-- kinh doanh pin (Kèm pin / Thuê pin) — vd chương trình chỉ áp dụng
-- cho khách chọn "Thuê pin". Theo đúng quy ước đã dùng cho
-- vehicle_names trong bảng này: MẢNG RỖNG = áp dụng mọi hình thức
-- (kể cả xe không phải "Xe đổi pin"), không phải rỗng = chỉ áp dụng
-- cho (các) hình thức được chọn.
--
-- Chạy sau 127. Chạy lại nhiều lần vẫn an toàn.
-- =====================================================================

alter table public.promotions add column if not exists battery_options text[] not null default '{}';

-- ---------- fn_luu_khuyen_mai: nhan + luu battery_options ----------
create or replace function public.fn_luu_khuyen_mai(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare me record; v_id bigint; v_code text;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN: chỉ Admin/BGĐ được quản lý chương trình khuyến mại'; end if;
  if coalesce(trim(p->>'name'),'') = '' then raise exception 'THIEU_THONG_TIN: nhập tên chương trình'; end if;
  if coalesce(trim(p->>'brand'),'') = '' then raise exception 'THIEU_THONG_TIN: chọn hãng áp dụng'; end if;
  if nullif(p->>'start_date','') is null or nullif(p->>'end_date','') is null then
    raise exception 'THIEU_THONG_TIN: nhập đủ thời hạn chương trình';
  end if;

  v_id := nullif(p->>'id','')::bigint;
  if v_id is null then
    v_code := nullif(trim(p->>'code'),'');
    if v_code is null then v_code := public.fn_gen_code('KM'); end if;
    insert into public.promotions (code, name, brand, vehicle_names, start_date, end_date, note, status, battery_options, created_by, created_by_name)
    values (v_code, trim(p->>'name'), trim(p->>'brand'),
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'vehicle_names','[]'::jsonb)) x), '{}'),
      (p->>'start_date')::date, (p->>'end_date')::date, coalesce(p->>'note',''),
      coalesce(nullif(p->>'status',''), 'Đang áp dụng'),
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'battery_options','[]'::jsonb)) x), '{}'),
      me.uid, me.name)
    returning id into v_id;
  else
    update public.promotions set
      name = trim(p->>'name'), brand = trim(p->>'brand'),
      vehicle_names = coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'vehicle_names','[]'::jsonb)) x), '{}'),
      start_date = (p->>'start_date')::date, end_date = (p->>'end_date')::date,
      note = coalesce(p->>'note',''), status = coalesce(nullif(p->>'status',''), status),
      battery_options = coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'battery_options','[]'::jsonb)) x), '{}'),
      updated_at = now()
    where id = v_id;
    if not found then raise exception 'KHONG_TIM_THAY: chương trình không tồn tại'; end if;
  end if;
  return v_id;
end $$;
