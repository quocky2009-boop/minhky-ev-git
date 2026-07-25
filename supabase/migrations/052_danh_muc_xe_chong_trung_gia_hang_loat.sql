-- ============================================================
-- Migration 052 — DANH MỤC XE: CHỐNG TRÙNG MÃ + CẬP NHẬT GIÁ HÀNG LOẠT
--  1) fn_them_xe: BÁO LỖI khi trùng Mã hãng (mfr_code) hoặc trùng mã nội bộ
--     (thay vì âm thầm ghi đè như trước). Import CSV vẫn cho cập nhật.
--  2) fn_cap_nhat_gia_hang_loat: đổi giá niêm yết cho nhiều mã cùng lúc,
--     lọc theo hãng và/hoặc theo tên model.
-- Chạy SAU 051. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

-- ===================== 1) fn_them_xe: chống trùng =====================
-- Thêm cờ p_cap_nhat: mặc định false = thêm mới (chặn trùng).
-- Import CSV gọi với p->'_cap_nhat' = true để giữ hành vi cũ (upsert).
create or replace function public.fn_them_xe(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare me record; v_id text; v_mfr text; v_capnhat boolean;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN'; end if;

  v_capnhat := coalesce((p->>'_cap_nhat')::boolean, false);
  v_mfr := nullif(trim(coalesce(p->>'mfr_code','')), '');

  if not exists (select 1 from public.brands where name = trim(p->>'brand')) then
    insert into public.brands(name) values (trim(p->>'brand'));
  end if;

  v_id := upper(replace(trim(p->>'brand')||'_'||trim(p->>'name')||'_'||trim(p->>'color'), ' ', '_'));

  if not v_capnhat then
    -- Chặn trùng mã nội bộ (cùng hãng + tên + màu)
    if exists (select 1 from public.vehicles where id = v_id) then
      raise exception 'TRUNG_MA_XE: đã có xe % (% % %) trong danh mục',
        v_id, trim(p->>'brand'), trim(p->>'name'), trim(p->>'color');
    end if;
    -- Chặn trùng Mã hãng
    if v_mfr is not null and exists (select 1 from public.vehicles where nullif(trim(mfr_code),'') = v_mfr) then
      raise exception 'TRUNG_MA_HANG: Mã hãng "%" đã được dùng cho mã xe %',
        v_mfr, (select id from public.vehicles where nullif(trim(mfr_code),'') = v_mfr limit 1);
    end if;
  end if;

  insert into public.vehicles (id, mfr_code, brand, name, color, list_price, min_stock)
  values (v_id, coalesce(v_mfr,''), trim(p->>'brand'), trim(p->>'name'), trim(p->>'color'),
          coalesce((p->>'list_price')::bigint,0), coalesce((p->>'min_stock')::int,2))
  on conflict (id) do update set mfr_code = excluded.mfr_code, list_price = excluded.list_price,
          min_stock = excluded.min_stock, updated_at = now();
  return v_id;
end $$;

-- Import CSV: gọi lại fn_them_xe với cờ cập nhật để giữ hành vi upsert cũ
create or replace function public.fn_import_xe(p jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare me record; r jsonb; n int := 0;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN'; end if;
  for r in select jsonb_array_elements(p) loop
    if coalesce(r->>'brand','')='' or coalesce(r->>'name','')='' or coalesce(r->>'color','')='' then continue; end if;
    perform public.fn_them_xe(r || jsonb_build_object('_cap_nhat', true));
    n := n + 1;
  end loop;
  return n;
end $$;

-- fn_sua_xe: khi sửa, nếu đổi Mã hãng sang trùng mã khác thì cũng chặn
create or replace function public.fn_sua_xe(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; v_mfr text;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN'; end if;
  if not exists (select 1 from public.brands where name = trim(p->>'brand')) then
    insert into public.brands(name) values (trim(p->>'brand'));
  end if;

  v_mfr := nullif(trim(coalesce(p->>'mfr_code','')), '');
  if v_mfr is not null and exists (
    select 1 from public.vehicles where nullif(trim(mfr_code),'') = v_mfr and id <> p->>'id'
  ) then
    raise exception 'TRUNG_MA_HANG: Mã hãng "%" đã được dùng cho mã xe %',
      v_mfr, (select id from public.vehicles where nullif(trim(mfr_code),'') = v_mfr and id <> p->>'id' limit 1);
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

-- ===================== 2) CẬP NHẬT GIÁ HÀNG LOẠT =====================
-- p = { brand?, name?, list_price }
--   brand: lọc theo hãng (bỏ trống = mọi hãng)
--   name : lọc theo tên model, khớp gần đúng không phân biệt hoa/thường (bỏ trống = mọi model)
--   list_price: giá niêm yết mới (bắt buộc > 0)
-- Trả về jsonb { so_ma_cap_nhat, danh_sach: [id...] }
create or replace function public.fn_cap_nhat_gia_hang_loat(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; v_brand text; v_name text; v_gia bigint; v_ids text[];
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN: chỉ Admin/BGĐ được cập nhật giá'; end if;

  v_brand := nullif(trim(coalesce(p->>'brand','')), '');
  v_name  := nullif(trim(coalesce(p->>'name','')), '');
  v_gia   := coalesce((p->>'list_price')::bigint, 0);
  if v_gia <= 0 then raise exception 'THIEU_THONG_TIN: giá niêm yết mới phải lớn hơn 0'; end if;
  if v_brand is null and v_name is null then
    raise exception 'THIEU_DIEU_KIEN: phải chọn ít nhất hãng hoặc model để tránh đổi giá toàn bộ danh mục';
  end if;

  update public.vehicles set list_price = v_gia, updated_at = now()
  where (v_brand is null or brand = v_brand)
    and (v_name is null or name ilike '%'||v_name||'%');

  select array_agg(id) into v_ids from public.vehicles
  where (v_brand is null or brand = v_brand)
    and (v_name is null or name ilike '%'||v_name||'%')
    and list_price = v_gia;

  return jsonb_build_object('so_ma_cap_nhat', coalesce(array_length(v_ids,1),0), 'danh_sach', to_jsonb(coalesce(v_ids, array[]::text[])));
end $$;

-- ===================== KIỂM TRA =====================
do $do$
begin
  raise notice 'XONG 052: fn_them_xe chan trung ma; them fn_cap_nhat_gia_hang_loat';
end $do$;

-- ============================================================
-- ROLLBACK: chay lai ban 004/005 de tra fn_them_xe, fn_import_xe, fn_sua_xe ve cu.
--   drop function if exists public.fn_cap_nhat_gia_hang_loat(jsonb);
-- ============================================================
