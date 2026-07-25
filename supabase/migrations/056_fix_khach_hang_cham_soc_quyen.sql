-- ============================================================
-- Migration 056 — FIX KHÁCH HÀNG: cột chăm sóc + quyền + cửa hàng phụ trách
--  1) Đảm bảo mọi cột module Khách hàng v2 tồn tại (fix lỗi
--     'column next_care_date does not exist' khi lưu chăm sóc).
--  2) Thêm cột store_code cho profiles (cửa hàng của từng nhân viên) + hàm
--     fn_set_store để CEO gán trong màn Người dùng.
--  3) fn_luu_khach_hang_v2: CHỈ CEO đổi "Nhân viên phụ trách"; "Cửa hàng
--     phụ trách" mặc định = cửa hàng của người tạo (profiles.store_code).
-- Chạy SAU 055. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

-- ===================== 1) ĐẢM BẢO CÁC CỘT TỒN TẠI =====================
alter table public.customers add column if not exists next_care_date date;
alter table public.customers add column if not exists next_care_note text default '';
alter table public.customers add column if not exists phone2 text default '';
alter table public.customers add column if not exists email text default '';
alter table public.customers add column if not exists birthday date;
alter table public.customers add column if not exists gender text;
alter table public.customers add column if not exists location_code text references public.locations(code);
alter table public.customers add column if not exists interested_products text default '';
alter table public.customers add column if not exists interested_vehicle_id text references public.vehicles(id);
alter table public.customers add column if not exists budget bigint;
alter table public.customers add column if not exists buy_timeline text;
alter table public.customers add column if not exists potential text;
alter table public.customers add column if not exists temperature text;
alter table public.customer_care_logs add column if not exists care_type text default '';
create index if not exists customers_next_care_idx on public.customers (next_care_date) where next_care_date is not null;

-- ===================== 2) CỬA HÀNG CỦA NHÂN VIÊN =====================
alter table public.profiles add column if not exists store_code text references public.locations(code);

-- CEO gan cua hang cho nhan vien (goi tu man Nguoi dung)
create or replace function public.fn_set_store(p_user uuid, p_store text)
returns void language plpgsql security definer set search_path = public as $$
declare me record;
begin
  select * into me from public.fn_me();
  if me.role <> 'CEO' then raise exception 'KHONG_CO_QUYEN: chỉ CEO được gán cửa hàng'; end if;
  update public.profiles set store_code = nullif(p_store,''), updated_at = now() where id = p_user;
end $$;

-- Helper: cua hang cua chinh minh (dung trong fn_luu_khach_hang_v2)
create or replace function public.my_store_code()
returns text language sql security definer set search_path = public stable as $$
  select store_code from public.profiles where id = auth.uid();
$$;

-- ===================== 3) CHẶN ĐỔI NGƯỜI PHỤ TRÁCH + CỬA HÀNG MẶC ĐỊNH =====================
create or replace function public.fn_luu_khach_hang_v2(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare me record; v_id bigint; v_phone text; v_assign uuid; v_assign_name text; old record; v_store text;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('sua_khach') then raise exception 'KHONG_CO_QUYEN'; end if;
  if coalesce(trim(p->>'name'),'') = '' then raise exception 'THIEU_THONG_TIN: nhập họ tên'; end if;
  if coalesce(trim(p->>'phone'),'') = '' then raise exception 'THIEU_THONG_TIN: nhập số điện thoại'; end if;

  v_phone := regexp_replace(trim(p->>'phone'), '\D', '', 'g');
  if length(v_phone) < 9 then raise exception 'SDT_SAI: số điện thoại không hợp lệ'; end if;
  if coalesce(trim(p->>'email'),'') <> '' and trim(p->>'email') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'EMAIL_SAI: email không hợp lệ';
  end if;

  v_id := nullif(p->>'id','')::bigint;
  if v_id is null then
    select id into v_id from public.customers where phone_digits = v_phone limit 1;
  end if;

  if v_id is null then
    -- TAO MOI: nguoi phu trach mac dinh = nguoi tao (tru khi CEO chi dinh nguoi khac)
    if me.role = 'CEO' and nullif(p->>'assigned_to','') is not null then
      v_assign := (p->>'assigned_to')::uuid; v_assign_name := coalesce(p->>'assigned_name','');
    else
      v_assign := me.uid; v_assign_name := me.name;
    end if;
    -- Cua hang phu trach: uu tien gia tri nhap, roi den cua hang cua nguoi tao
    v_store := coalesce(nullif(p->>'location_code',''), public.my_store_code());
    insert into public.customers (code, name, phone, phone2, email, cccd, address, birthday, gender,
      customer_type, source, assigned_to, assigned_name, location_code,
      interested_products, budget, buy_timeline, potential, note, status, created_by, created_by_name)
    values (public.fn_gen_code('KH'), trim(p->>'name'), trim(p->>'phone'), coalesce(p->>'phone2',''),
      lower(coalesce(p->>'email','')), coalesce(p->>'cccd',''), coalesce(p->>'address',''),
      nullif(p->>'birthday','')::date, nullif(p->>'gender',''),
      coalesce(nullif(p->>'customer_type',''), 'Khách lẻ'), coalesce(p->>'source',''),
      v_assign, v_assign_name, v_store, coalesce(p->>'interested_products',''),
      nullif(p->>'budget','')::bigint, nullif(p->>'buy_timeline',''), nullif(p->>'potential',''),
      coalesce(p->>'note',''), coalesce(nullif(p->>'status',''), 'Lead mới'), me.uid, me.name)
    returning id into v_id;
  else
    select * into old from public.customers where id = v_id;
    -- CHI CEO duoc doi nguoi phu trach; nguoi khac giu nguyen
    if me.role = 'CEO' and nullif(p->>'assigned_to','') is not null then
      v_assign := (p->>'assigned_to')::uuid; v_assign_name := coalesce(p->>'assigned_name', old.assigned_name);
    else
      v_assign := old.assigned_to; v_assign_name := old.assigned_name;
    end if;
    update public.customers set
      name = trim(p->>'name'), phone = trim(p->>'phone'),
      phone2 = coalesce(p->>'phone2', phone2),
      email = coalesce(nullif(lower(trim(p->>'email')),''), email),
      cccd = coalesce(nullif(p->>'cccd',''), cccd),
      address = coalesce(nullif(p->>'address',''), address),
      birthday = coalesce(nullif(p->>'birthday','')::date, birthday),
      gender = coalesce(nullif(p->>'gender',''), gender),
      customer_type = coalesce(nullif(p->>'customer_type',''), customer_type),
      source = coalesce(nullif(p->>'source',''), source),
      assigned_to = v_assign, assigned_name = v_assign_name,
      location_code = coalesce(nullif(p->>'location_code',''), location_code),
      interested_products = coalesce(p->>'interested_products', interested_products),
      budget = coalesce(nullif(p->>'budget','')::bigint, budget),
      buy_timeline = coalesce(nullif(p->>'buy_timeline',''), buy_timeline),
      potential = coalesce(nullif(p->>'potential',''), potential),
      note = coalesce(p->>'note', note),
      status = coalesce(nullif(p->>'status',''), status),
      updated_at = now()
    where id = v_id;
  end if;
  return v_id;
end $$;

do $do$
begin
  raise notice 'XONG 056: cot khach hang OK; them profiles.store_code + fn_set_store; chi CEO doi nguoi phu trach; cua hang mac dinh theo nguoi tao';
end $do$;
