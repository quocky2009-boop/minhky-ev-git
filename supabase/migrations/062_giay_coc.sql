-- ============================================================
-- Migration 062 — THEO DÕI GIẤY COC (chứng nhận xuất xưởng) THEO TỪNG XE & TỪNG LÔ
--  Nghiep vu:
--   * VinFast: COC ve CUNG xe  -> nhap xe la tu dong 'Đã về'.
--   * TAILG / hang khac: xe ve truoc, COC ve sau 1-2 tuan -> mac dinh 'Chưa về',
--     khi hang gui COC ve thi danh dau hang loat theo lo.
--  Trang thai COC tren tung chiec (theo so khung):
--     CHUA_VE  — chưa có giấy
--     DA_VE    — đã nhận về kho
--     DA_GIAO  — đã giao cho khách (tự động khi bán xe)
--     THAT_LAC — thất lạc / cần cấp lại
--  "Lo" dung luon vehicle_units.import_doc (ma phieu nhap san co).
--  Nguong canh bao: 7 ngay ke tu ngay nhap ma chua co COC -> bao do.
-- Chạy SAU 061. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

-- ===================== 1) CỘT DỮ LIỆU =====================
alter table public.vehicle_units add column if not exists coc_status text not null default 'CHUA_VE';
alter table public.vehicle_units add column if not exists coc_received_at date;
alter table public.vehicle_units add column if not exists coc_note text default '';
create index if not exists vehicle_units_coc_idx on public.vehicle_units (coc_status, imported_at);

-- Hang nao COC ve cung xe? (VinFast = true)
alter table public.brands add column if not exists coc_theo_xe boolean not null default false;
update public.brands set coc_theo_xe = true where lower(name) like '%vinfast%' and coc_theo_xe = false;

-- ===================== 2) TỰ ĐỘNG THEO HÃNG KHI NHẬP XE =====================
-- Xe moi nhap: neu hang co coc_theo_xe = true thi danh dau 'Đã về' luon.
create or replace function public._coc_mac_dinh() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_theo_xe boolean;
begin
  if coalesce(new.coc_status,'') = '' or new.coc_status = 'CHUA_VE' then
    select b.coc_theo_xe into v_theo_xe
    from public.vehicles v join public.brands b on b.name = v.brand
    where v.id = new.vehicle_id;
    if coalesce(v_theo_xe,false) then
      new.coc_status := 'DA_VE';
      new.coc_received_at := coalesce(new.coc_received_at, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_coc_mac_dinh on public.vehicle_units;
create trigger trg_coc_mac_dinh before insert on public.vehicle_units
for each row execute function public._coc_mac_dinh();

-- ===================== 3) TỰ ĐỘNG KHI BÁN / HỦY ĐƠN =====================
-- Ban xe (DA_BAN): COC 'Đã về' -> 'Đã giao khách'.
-- Huy don / tra hang (ve TON_KHO): 'Đã giao khách' -> quay lai 'Đã về'.
create or replace function public._coc_theo_ban() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'DA_BAN' and old.status <> 'DA_BAN' and new.coc_status = 'DA_VE' then
    new.coc_status := 'DA_GIAO';
  elsif new.status = 'TON_KHO' and old.status = 'DA_BAN' and new.coc_status = 'DA_GIAO' then
    new.coc_status := 'DA_VE';
  end if;
  return new;
end $$;

drop trigger if exists trg_coc_theo_ban on public.vehicle_units;
create trigger trg_coc_theo_ban before update of status on public.vehicle_units
for each row execute function public._coc_theo_ban();

-- ===================== 4) HÀM ĐÁNH DẤU NHẬN COC (HÀNG LOẠT) =====================
-- p = { frames: ["SK1","SK2",...], received_at: "2026-07-26", note: "" }
create or replace function public.fn_coc_nhan(p jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare me record; v_frames text[]; v_ngay date; v_n int;
begin
  select * into me from public.fn_me();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if me.role not in ('CEO','MANAGER','ADMIN') then
    raise exception 'KHONG_CO_QUYEN: chỉ Admin/Quản lý/BGĐ được cập nhật giấy COC';
  end if;
  v_frames := coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'frames','[]'::jsonb)) x), '{}');
  if array_length(v_frames,1) is null then raise exception 'THIEU_THONG_TIN: chưa chọn xe nào'; end if;
  v_ngay := coalesce(nullif(p->>'received_at','')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date);

  update public.vehicle_units set
    coc_status = case when status = 'DA_BAN' then 'DA_GIAO' else 'DA_VE' end,
    coc_received_at = v_ngay,
    coc_note = coalesce(nullif(p->>'note',''), coc_note),
    updated_at = now()
  where frame_number = any(v_frames) and coc_status in ('CHUA_VE','THAT_LAC');
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Dat trang thai COC thu cong (VD: bao that lac, hoac tra ve chua co)
-- p = { frames: [...], status: 'CHUA_VE'|'DA_VE'|'DA_GIAO'|'THAT_LAC', note: "" }
create or replace function public.fn_coc_dat_trang_thai(p jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare me record; v_frames text[]; v_tt text; v_n int;
begin
  select * into me from public.fn_me();
  if me.role not in ('CEO','MANAGER','ADMIN') then
    raise exception 'KHONG_CO_QUYEN: chỉ Admin/Quản lý/BGĐ được cập nhật giấy COC';
  end if;
  v_tt := coalesce(p->>'status','');
  if v_tt not in ('CHUA_VE','DA_VE','DA_GIAO','THAT_LAC') then raise exception 'TRANG_THAI_SAI'; end if;
  v_frames := coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'frames','[]'::jsonb)) x), '{}');
  if array_length(v_frames,1) is null then raise exception 'THIEU_THONG_TIN: chưa chọn xe nào'; end if;

  update public.vehicle_units set
    coc_status = v_tt,
    coc_received_at = case when v_tt in ('DA_VE','DA_GIAO') then coalesce(coc_received_at, (now() at time zone 'Asia/Ho_Chi_Minh')::date) else null end,
    coc_note = coalesce(nullif(p->>'note',''), coc_note),
    updated_at = now()
  where frame_number = any(v_frames);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ===================== 5) VIEW THEO LÔ NHẬP =====================
drop view if exists public.v_coc_lo;
create view public.v_coc_lo as
select
  coalesce(nullif(u.import_doc,''), '(không rõ lô)') as lo,
  min(u.imported_at)                                  as ngay_nhap,
  v.brand                                             as hang,
  u.location_code,
  count(*)                                            as tong_xe,
  count(*) filter (where u.coc_status = 'CHUA_VE')    as chua_ve,
  count(*) filter (where u.coc_status = 'DA_VE')      as da_ve,
  count(*) filter (where u.coc_status = 'DA_GIAO')    as da_giao,
  count(*) filter (where u.coc_status = 'THAT_LAC')   as that_lac,
  (extract(day from now() - min(u.imported_at)))::int as so_ngay
from public.vehicle_units u
join public.vehicles v on v.id = u.vehicle_id
where u.status <> 'DA_XOA'
group by 1, 3, 4;

do $do$
begin
  raise notice 'XONG 062: theo doi giay COC theo tung xe + theo lo (v_coc_lo, fn_coc_nhan, fn_coc_dat_trang_thai)';
end $do$;
