-- ============================================================
-- Migration 004 (BAN NANG CAP V2)
-- 1) Quan ly ton theo TUNG CHIEC (so khung) - vehicle_units
-- 2) Danh muc hang xe (brands)
-- 3) Cai dat he thong (app_settings: thue suat...)
-- 4) Truong tuy chinh dong cho don ban (custom_fields + extra)
-- Chay SAU 001/002/003/seed. Chay 1 lan duy nhat.
-- ============================================================

-- ---------- DANH MUC HANG ----------
create table public.brands (
  name text primary key,
  status text not null default 'Hoạt động',
  created_at timestamptz not null default now()
);
insert into public.brands(name) select distinct brand from public.vehicles on conflict do nothing;

-- ---------- CAI DAT ----------
create table public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
insert into public.app_settings(key, value) values ('tax_rate','0.08') on conflict do nothing;

-- ---------- TRUONG TUY CHINH ----------
create table public.custom_fields (
  id bigserial primary key,
  entity text not null default 'sales_order',
  label text not null,
  field_key text not null,
  field_type text not null check (field_type in ('text','number','dropdown','checkbox','formula')),
  options jsonb default '[]'::jsonb,          -- cho dropdown
  formula jsonb default null,                  -- {base:'sale_price', op:'divide'|'multiply'|'add'|'subtract', operand:'TAX'|so}
  required boolean not null default false,
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  unique (entity, field_key)
);
-- 2 truong mau theo yeu cau
insert into public.custom_fields(entity,label,field_key,field_type,options,sort) values
('sales_order','Dịch vụ đăng ký','dich_vu_dang_ky','dropdown','["Có","Không"]'::jsonb,1);
insert into public.custom_fields(entity,label,field_key,field_type,formula,sort) values
('sales_order','Giá bán trước thuế','gia_truoc_thue','formula','{"base":"sale_price","op":"divide","operand":"TAX"}'::jsonb,2);

alter table public.sales_orders add column if not exists extra jsonb not null default '{}'::jsonb;

-- ---------- XE TUNG CHIEC (SO KHUNG) ----------
create table public.vehicle_units (
  frame_number text primary key,
  vehicle_id text not null references public.vehicles(id),
  location_code text references public.locations(code),
  status text not null default 'TON_KHO' check (status in ('TON_KHO','DANG_CHUYEN','DA_BAN','DA_XOA')),
  engine_number text default '',
  is_placeholder boolean not null default false,   -- so khung tam, cho bo sung so that
  imported_at timestamptz not null default now(),
  import_doc text default '',
  transfer_code text default '',
  sale_code text default '',
  removed_reason text default '',
  note text default '',
  updated_at timestamptz not null default now()
);
create index on public.vehicle_units (vehicle_id, location_code, status);
create index on public.vehicle_units (location_code) where status in ('TON_KHO','DANG_CHUYEN');

-- Chuyen ton hien tai thanh cac chiec xe voi so khung TAM (SKT-...)
-- => vao "Kho / Cua hang" -> chon kho -> sua tung so khung tam thanh so that
do $$
declare r record; i int;
begin
  for r in select vehicle_id, location_code, quantity from public.inventory where quantity > 0 loop
    for i in 1..r.quantity loop
      insert into public.vehicle_units(frame_number, vehicle_id, location_code, status, is_placeholder, import_doc, note)
      values ('SKT-'||r.location_code||'-'||r.vehicle_id||'-'||lpad(i::text,3,'0'), r.vehicle_id, r.location_code, 'TON_KHO', true, 'KHOI-TAO', 'Số khung tạm sinh từ tồn Excel — cần cập nhật số thật');
    end loop;
  end loop;
end $$;

-- Ton kho (bang inventory) tu dong dong bo theo so xe TON_KHO + DANG_CHUYEN (xe dang chuyen van thuoc kho di)
create or replace function public._sync_inventory(p_vehicle text, p_loc text)
returns void language plpgsql security definer set search_path = public as $$
declare v_qty int;
begin
  if p_loc is null then return; end if;
  select count(*) into v_qty from public.vehicle_units
    where vehicle_id = p_vehicle and location_code = p_loc and status in ('TON_KHO','DANG_CHUYEN');
  insert into public.inventory(vehicle_id, location_code, quantity) values (p_vehicle, p_loc, v_qty)
  on conflict (vehicle_id, location_code) do update set quantity = excluded.quantity, updated_at = now();
end $$;

create or replace function public._trg_units_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT','UPDATE') then perform public._sync_inventory(new.vehicle_id, new.location_code); end if;
  if tg_op in ('DELETE','UPDATE') then perform public._sync_inventory(old.vehicle_id, old.location_code); end if;
  return null;
end $$;
create trigger trg_units_sync after insert or update or delete on public.vehicle_units
for each row execute procedure public._trg_units_sync();

-- Dieu chinh ton: luu danh sach so khung them/bot
alter table public.stock_adjustments add column if not exists frames_remove jsonb not null default '[]'::jsonb;
alter table public.stock_adjustments add column if not exists frames_add jsonb not null default '[]'::jsonb;

-- ---------- HAM GHI LICH SU (dem theo units) ----------
create or replace function public._log_txn(
  p_type text, p_vehicle text, p_from text, p_to text, p_qty int,
  p_before int, p_after int, p_doc text, p_note text, p_uid uuid, p_uname text
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.inventory_txns (txn_type, vehicle_id, from_location, to_location, qty, stock_before, stock_after, doc_code, note, created_by, created_by_name)
  values (p_type, p_vehicle, p_from, p_to, p_qty, p_before, p_after, p_doc, p_note, p_uid, p_uname);
end $$;

create or replace function public._count_at(p_vehicle text, p_loc text)
returns int language sql security definer set search_path = public stable as $$
  select count(*)::int from public.vehicle_units
  where vehicle_id = p_vehicle and location_code = p_loc and status in ('TON_KHO','DANG_CHUYEN');
$$;

-- ============================================================
-- VIET LAI CAC HAM NGHIEP VU THEO SO KHUNG
-- ============================================================
drop function if exists public.fn_nhap_hang(text,text,int,text,text,text);
drop function if exists public.fn_tao_dieu_chuyen(text,text,text,int,text);
drop function if exists public.fn_de_xuat_dieu_chinh(text,text,int,text,text);

-- ---- NHAP HANG: bat buoc danh sach so khung ----
create or replace function public.fn_nhap_hang(
  p_vehicle text, p_loc text, p_frames text[],
  p_supplier text default '', p_doc text default '', p_note text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare me record; v_doc text; f text; v_before int; n int;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN: chỉ Admin/BGĐ được nhập hàng'; end if;
  n := coalesce(array_length(p_frames,1),0);
  if n = 0 then raise exception 'THIEU_SO_KHUNG: phải nhập ít nhất 1 số khung'; end if;
  if (select count(distinct x) from unnest(p_frames) x) <> n then raise exception 'SO_KHUNG_TRUNG: danh sách có số khung bị lặp'; end if;
  v_before := public._count_at(p_vehicle, p_loc);
  v_doc := coalesce(nullif(p_doc,''), public.fn_gen_code('PN'));
  foreach f in array p_frames loop
    f := upper(trim(f));
    if f = '' then continue; end if;
    if exists (select 1 from public.vehicle_units where frame_number = f) then
      raise exception 'SO_KHUNG_TON_TAI: số khung % đã có trên hệ thống', f;
    end if;
    insert into public.vehicle_units(frame_number, vehicle_id, location_code, status, import_doc, note)
    values (f, p_vehicle, p_loc, 'TON_KHO', v_doc, coalesce('NCC: '||nullif(p_supplier,''),''));
  end loop;
  perform public._log_txn('Nhập hàng', p_vehicle, null, p_loc, n, v_before, v_before + n, v_doc,
    trim(coalesce('NCC: '||nullif(p_supplier,'')||'. ','') || coalesce(p_note,'')), me.uid, me.name);
  return v_doc;
end $$;

-- ---- BAN HANG: chon dich danh so khung ----
create or replace function public.fn_ban_hang(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare me record; v_code text; v_list bigint; f text; u record; n int; v_before int;
        v_frames text[];
begin
  select * into me from public.fn_me();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  select array_agg(x) into v_frames from jsonb_array_elements_text(coalesce(p->'frames','[]'::jsonb)) x;
  n := coalesce(array_length(v_frames,1),0);
  if n = 0 then raise exception 'THIEU_SO_KHUNG: chọn ít nhất 1 xe theo số khung'; end if;
  if coalesce(p->>'customer_name','') = '' or coalesce(p->>'customer_phone','') = '' then
    raise exception 'THIEU_THONG_TIN: cần tên và SĐT khách hàng';
  end if;
  v_before := public._count_at(p->>'vehicle_id', p->>'location_code');
  v_code := public.fn_gen_code('BH');
  foreach f in array v_frames loop
    select * into u from public.vehicle_units where frame_number = f for update;
    if u is null then raise exception 'SO_KHUNG_KHONG_CO: % không có trên hệ thống', f; end if;
    if u.status <> 'TON_KHO' then raise exception 'XE_KHONG_SAN_SANG: xe % đang ở trạng thái %', f, u.status; end if;
    if u.location_code <> p->>'location_code' or u.vehicle_id <> p->>'vehicle_id' then
      raise exception 'SAI_KHO_HOAC_XE: xe % không thuộc kho/mã xe đã chọn', f;
    end if;
    update public.vehicle_units set status='DA_BAN', sale_code=v_code, updated_at=now() where frame_number = f;
  end loop;
  perform public._log_txn('Bán hàng', p->>'vehicle_id', p->>'location_code', null, -n, v_before, v_before - n,
    v_code, 'KH '||(p->>'customer_name')||' · SK: '||array_to_string(v_frames,', '), me.uid, me.name);
  select list_price into v_list from public.vehicles where id = p->>'vehicle_id';
  insert into public.sales_orders (code, location_code, vehicle_id, quantity, frame_number,
    customer_name, customer_phone, customer_cccd, customer_address, customer_type, customer_source,
    list_price, sale_price, payment_method, seller_id, seller_name, document_status, note, extra)
  values (v_code, p->>'location_code', p->>'vehicle_id', n, array_to_string(v_frames,', '),
    p->>'customer_name', p->>'customer_phone', coalesce(p->>'customer_cccd',''), coalesce(p->>'customer_address',''),
    coalesce(p->>'customer_type','Khách lẻ'), coalesce(p->>'customer_source','Khách vãng lai'),
    coalesce(v_list,0), coalesce((p->>'sale_price')::bigint, v_list, 0),
    coalesce(p->>'payment_method','Chuyển khoản'), me.uid, me.name,
    coalesce(p->>'document_status','Đang làm đăng ký'), coalesce(p->>'note',''),
    coalesce(p->'extra','{}'::jsonb));
  return v_code;
end $$;

-- ---- DIEU CHUYEN theo so khung ----
create or replace function public.fn_tao_dieu_chuyen(
  p_vehicle text, p_from text, p_to text, p_frames text[], p_note text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare me record; v_code text; f text; u record; n int;
begin
  select * into me from public.fn_me();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if p_from = p_to then raise exception 'KHO_TRUNG: kho đi và kho đến không được trùng'; end if;
  n := coalesce(array_length(p_frames,1),0);
  if n = 0 then raise exception 'THIEU_SO_KHUNG: chọn ít nhất 1 xe'; end if;
  v_code := public.fn_gen_code('DCH');
  foreach f in array p_frames loop
    select * into u from public.vehicle_units where frame_number = f for update;
    if u is null or u.status <> 'TON_KHO' or u.location_code <> p_from or u.vehicle_id <> p_vehicle then
      raise exception 'XE_KHONG_SAN_SANG: xe % không sẵn sàng tại kho đi', f;
    end if;
    update public.vehicle_units set status='DANG_CHUYEN', transfer_code=v_code, updated_at=now() where frame_number = f;
  end loop;
  insert into public.transfer_orders (code, from_location, to_location, vehicle_id, quantity, requested_by, requested_by_name, note)
  values (v_code, p_from, p_to, p_vehicle, n, me.uid, me.name,
    coalesce(nullif(p_note,'')||' · ','')||'SK: '||array_to_string(p_frames,', '));
  return v_code;
end $$;

create or replace function public.fn_xac_nhan_dieu_chuyen(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare me record; tr record; v_bf int; v_bt int; n int;
begin
  select * into me from public.fn_me();
  if me.role not in ('MANAGER','ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN: chỉ Quản lý/Admin/BGĐ xác nhận nhận xe'; end if;
  select * into tr from public.transfer_orders where id = p_id for update;
  if tr.status <> 'Đang chuyển' then raise exception 'TRANG_THAI_SAI: phiếu không ở trạng thái Đang chuyển'; end if;
  v_bf := public._count_at(tr.vehicle_id, tr.from_location);
  v_bt := public._count_at(tr.vehicle_id, tr.to_location);
  update public.vehicle_units set location_code = tr.to_location, status='TON_KHO', transfer_code='', updated_at=now()
  where transfer_code = tr.code and status='DANG_CHUYEN';
  get diagnostics n = row_count;
  perform public._log_txn('Điều chuyển', tr.vehicle_id, tr.from_location, null, -n, v_bf, v_bf - n, tr.code, 'Chuyển đến '||tr.to_location, me.uid, me.name);
  perform public._log_txn('Điều chuyển', tr.vehicle_id, null, tr.to_location, n, v_bt, v_bt + n, tr.code, 'Nhận từ '||tr.from_location, me.uid, me.name);
  update public.transfer_orders set status='Đã nhận', confirmed_by=me.uid, confirmed_by_name=me.name, confirmed_at=now() where id = p_id;
end $$;

create or replace function public.fn_huy_dieu_chuyen(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare me record; tr record;
begin
  select * into me from public.fn_me();
  select * into tr from public.transfer_orders where id = p_id for update;
  if tr.status <> 'Đang chuyển' then raise exception 'TRANG_THAI_SAI'; end if;
  if not (me.role in ('MANAGER','ADMIN','CEO') or me.uid = tr.requested_by) then raise exception 'KHONG_CO_QUYEN'; end if;
  update public.vehicle_units set status='TON_KHO', transfer_code='', updated_at=now() where transfer_code = tr.code and status='DANG_CHUYEN';
  update public.transfer_orders set status='Đã hủy', confirmed_by=me.uid, confirmed_by_name=me.name, confirmed_at=now() where id = p_id;
end $$;

-- ---- DIEU CHINH theo so khung (them/bot chiec cu the) ----
create or replace function public.fn_de_xuat_dieu_chinh(
  p_vehicle text, p_loc text, p_remove text[], p_add text[], p_reason text, p_note text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare me record; v_sys int; v_code text; n_r int; n_a int; f text;
begin
  select * into me from public.fn_me();
  if me.role not in ('MANAGER','ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN: Sales không được đề xuất điều chỉnh tồn'; end if;
  if coalesce(p_reason,'') = '' then raise exception 'THIEU_LY_DO: điều chỉnh tồn bắt buộc có lý do'; end if;
  n_r := coalesce(array_length(p_remove,1),0); n_a := coalesce(array_length(p_add,1),0);
  if n_r = 0 and n_a = 0 then raise exception 'KHONG_CHENH_LECH: chưa chọn xe bớt hoặc thêm'; end if;
  foreach f in array coalesce(p_remove, '{}') loop
    if not exists (select 1 from public.vehicle_units where frame_number=f and location_code=p_loc and vehicle_id=p_vehicle and status='TON_KHO') then
      raise exception 'XE_KHONG_SAN_SANG: xe % không tồn tại ở kho này để bớt', f;
    end if;
  end loop;
  v_sys := public._count_at(p_vehicle, p_loc);
  v_code := public.fn_gen_code('DC');
  insert into public.stock_adjustments (code, location_code, vehicle_id, system_qty, actual_qty, diff_qty, reason, requested_by, requested_by_name, note, frames_remove, frames_add)
  values (v_code, p_loc, p_vehicle, v_sys, v_sys - n_r + n_a, n_a - n_r, p_reason, me.uid, me.name, coalesce(p_note,''),
          coalesce(to_jsonb(p_remove),'[]'::jsonb), coalesce(to_jsonb(p_add),'[]'::jsonb));
  return v_code;
end $$;

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
        insert into public.vehicle_units(frame_number, vehicle_id, location_code, status, import_doc, note)
        values (f, ad.vehicle_id, ad.location_code, 'TON_KHO', ad.code, 'Thêm qua điều chỉnh: '||ad.reason);
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

-- ---- SUA SO KHUNG (thay so tam bang so that) ----
create or replace function public.fn_sua_so_khung(p_old text, p_new text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; u record; v_new text;
begin
  select * into me from public.fn_me();
  if me.role not in ('MANAGER','ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN'; end if;
  v_new := upper(trim(p_new));
  if v_new = '' then raise exception 'THIEU_SO_KHUNG'; end if;
  select * into u from public.vehicle_units where frame_number = p_old for update;
  if u is null then raise exception 'SO_KHUNG_KHONG_CO'; end if;
  if u.status = 'DA_BAN' then raise exception 'XE_KHONG_SAN_SANG: xe đã bán, không sửa số khung'; end if;
  if exists (select 1 from public.vehicle_units where frame_number = v_new) then raise exception 'SO_KHUNG_TON_TAI: % đã có trên hệ thống', v_new; end if;
  update public.vehicle_units set frame_number = v_new, is_placeholder = false, updated_at = now() where frame_number = p_old;
end $$;

-- ---- DANH MUC HANG / XE / IMPORT ----
create or replace function public.fn_them_hang(p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare me record;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN'; end if;
  insert into public.brands(name) values (trim(p_name)) on conflict do nothing;
end $$;

create or replace function public.fn_them_xe(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare me record; v_id text;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN'; end if;
  if not exists (select 1 from public.brands where name = trim(p->>'brand')) then
    insert into public.brands(name) values (trim(p->>'brand'));
  end if;
  v_id := upper(replace(trim(p->>'brand')||'_'||trim(p->>'name')||'_'||trim(p->>'color'), ' ', '_'));
  insert into public.vehicles (id, mfr_code, brand, name, color, list_price, min_stock)
  values (v_id, coalesce(p->>'mfr_code',''), trim(p->>'brand'), trim(p->>'name'), trim(p->>'color'),
          coalesce((p->>'list_price')::bigint,0), coalesce((p->>'min_stock')::int,2))
  on conflict (id) do update set mfr_code = excluded.mfr_code, list_price = excluded.list_price, min_stock = excluded.min_stock, updated_at = now();
  return v_id;
end $$;

create or replace function public.fn_import_xe(p jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare me record; r jsonb; n int := 0;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN'; end if;
  for r in select jsonb_array_elements(p) loop
    if coalesce(r->>'brand','')='' or coalesce(r->>'name','')='' or coalesce(r->>'color','')='' then continue; end if;
    perform public.fn_them_xe(r);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---- CAI DAT & TRUONG TUY CHINH ----
create or replace function public.fn_set_setting(p_key text, p_value text)
returns void language plpgsql security definer set search_path = public as $$
declare me record;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN'; end if;
  insert into public.app_settings(key, value) values (p_key, p_value)
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;

create or replace function public.fn_save_custom_field(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN'; end if;
  if coalesce(p->>'id','') <> '' then
    update public.custom_fields set label = p->>'label', field_type = p->>'field_type',
      options = coalesce(p->'options','[]'::jsonb), formula = p->'formula',
      required = coalesce((p->>'required')::boolean,false), active = coalesce((p->>'active')::boolean,true),
      sort = coalesce((p->>'sort')::int,0)
    where id = (p->>'id')::bigint;
  else
    insert into public.custom_fields(entity, label, field_key, field_type, options, formula, required, sort)
    values ('sales_order', p->>'label',
      lower(regexp_replace(trim(p->>'label'), '[^a-zA-Z0-9]+', '_', 'g')) || '_' || floor(random()*1000)::text,
      p->>'field_type', coalesce(p->'options','[]'::jsonb), p->'formula',
      coalesce((p->>'required')::boolean,false), coalesce((p->>'sort')::int,0));
  end if;
end $$;

create or replace function public.fn_delete_custom_field(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare me record;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN'; end if;
  update public.custom_fields set active = false where id = p_id;
end $$;

-- ---- RLS cho bang moi ----
alter table public.brands enable row level security;
alter table public.app_settings enable row level security;
alter table public.custom_fields enable row level security;
alter table public.vehicle_units enable row level security;
create policy "read_brands" on public.brands for select to authenticated using (true);
create policy "read_settings" on public.app_settings for select to authenticated using (true);
create policy "read_cfields" on public.custom_fields for select to authenticated using (true);
create policy "read_units" on public.vehicle_units for select to authenticated using (true);
