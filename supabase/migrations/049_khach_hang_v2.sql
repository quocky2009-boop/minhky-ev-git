-- ============================================================
-- Migration 049 — VÁ LỖI + NÂNG CẤP KHÁCH HÀNG
--  A) VA: sale_payments thieu cot note (bang tao truoc khi them cot)
--  B) Bo sung truong khach hang: SDT phu, ngay sinh, gioi tinh,
--     san pham quan tam, ngan sach, thoi gian mua, muc do tiem nang
--  C) Bang LICH SU CHAM SOC khach hang
--  D) Bo 'Cả CK và TM' khoi danh muc phuong thuc thanh toan
-- Chay SAU 048. Chay lai nhieu lan van an toan.
-- ============================================================

-- ===================== A) VÁ sale_payments =====================
alter table public.sale_payments add column if not exists note text default '';
alter table public.sale_payments add column if not exists created_by uuid references public.profiles(id);
alter table public.sale_payments add column if not exists created_by_name text default '';

-- ===================== B) TRƯỜNG MỚI CHO KHÁCH HÀNG =====================
alter table public.customers add column if not exists phone2 text default '';
alter table public.customers add column if not exists birthday date;
alter table public.customers add column if not exists gender text check (gender in ('Nam','Nữ','Khác'));
alter table public.customers add column if not exists interested_products text default '';
alter table public.customers add column if not exists budget bigint;
alter table public.customers add column if not exists buy_timeline text;
alter table public.customers add column if not exists potential text check (potential in ('Cao','Trung bình','Thấp'));
alter table public.customers add column if not exists location_code text references public.locations(code);
create index if not exists customers_potential_idx on public.customers (potential) where potential is not null;
create index if not exists customers_loc_idx on public.customers (location_code);

-- ===================== C) CHĂM SÓC: DÙNG LẠI BẢNG CŨ =====================
-- App DA CO bang customer_care_logs + ham fn_luu_cham_soc (migration 011/013/015).
-- KHONG tao bang moi. Chi bo sung cot con thieu theo yeu cau:
--   thoi gian cu the (gio), hinh thuc lien he, ngay hen tiep theo tren tung lan
alter table public.customer_care_logs add column if not exists contact_at timestamptz;
alter table public.customer_care_logs add column if not exists channel text default '';
alter table public.customer_care_logs add column if not exists next_contact_at date;

-- Dien contact_at cho ban ghi cu (lay theo care_date)
update public.customer_care_logs
set contact_at = coalesce(contact_at, care_date::timestamptz)
where contact_at is null;

-- Luu ho so khach hang (ban day du, thay ham cu)
create or replace function public.fn_luu_khach_hang_v2(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare me record; v_id bigint; v_phone text;
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
    insert into public.customers (code, name, phone, phone2, email, cccd, address, birthday, gender,
      customer_type, source, assigned_to, assigned_name, location_code,
      interested_products, budget, buy_timeline, potential, note, status, created_by, created_by_name)
    values (public.fn_gen_code('KH'), trim(p->>'name'), trim(p->>'phone'), coalesce(p->>'phone2',''),
      lower(coalesce(p->>'email','')), coalesce(p->>'cccd',''), coalesce(p->>'address',''),
      nullif(p->>'birthday','')::date, nullif(p->>'gender',''),
      coalesce(nullif(p->>'customer_type',''), 'Khách lẻ'), coalesce(p->>'source',''),
      nullif(p->>'assigned_to','')::uuid, coalesce(p->>'assigned_name',''),
      nullif(p->>'location_code',''), coalesce(p->>'interested_products',''),
      nullif(p->>'budget','')::bigint, nullif(p->>'buy_timeline',''), nullif(p->>'potential',''),
      coalesce(p->>'note',''), coalesce(nullif(p->>'status',''), 'Lead mới'), me.uid, me.name)
    returning id into v_id;
  else
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
      assigned_to = coalesce(nullif(p->>'assigned_to','')::uuid, assigned_to),
      assigned_name = coalesce(nullif(p->>'assigned_name',''), assigned_name),
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

-- ===================== D) DANH MỤC PHƯƠNG THỨC THANH TOÁN =====================
insert into public.app_settings (key, value)
values ('payment_methods', E'Tiền mặt\nChuyển khoản\nTrả góp')
on conflict (key) do update set value = E'Tiền mặt\nChuyển khoản\nTrả góp';

-- ===================== E) VIEW: TỔNG QUAN 1 KHÁCH =====================
create or replace view public.v_khach_tong_quan as
select c.id as customer_id,
  (select count(*) from public.sales_orders o where o.customer_id = c.id) as so_don,
  coalesce((select sum(o.sale_price * o.quantity
    + coalesce((select sum(i.amount) from public.sale_items i where i.sale_code = o.code),0))
    from public.sales_orders o where o.customer_id = c.id), 0) as tong_mua,
  coalesce((select sum(greatest(o.sale_price * o.quantity
    + coalesce((select sum(i.amount) from public.sale_items i where i.sale_code = o.code),0)
    - coalesce(o.paid_amount,0), 0))
    from public.sales_orders o where o.customer_id = c.id), 0) as con_no,
  (select count(*) from public.dv_tickets t where t.customer_id = c.id) as so_phieu_dv,
  (select count(*) from public.test_drives t where t.customer_id = c.id) as so_lai_thu,
  (select count(*) from public.customer_care_logs k where k.customer_id = c.id) as so_lan_cham_soc,
  (select max(k.contact_at) from public.customer_care_logs k where k.customer_id = c.id) as cham_soc_gan_nhat,
  (select min(k.next_contact_at) from public.customer_care_logs k
    where k.customer_id = c.id and k.next_contact_at >= current_date) as hen_ke_tiep
from public.customers c;
