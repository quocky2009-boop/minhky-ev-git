-- ============================================================
-- Migration 044 — ĐỐI SOÁT CUỐI NGÀY DÙNG CHUNG
-- Gop doanh thu BAN XE + DICH VU vao 1 bien ban chot ngay theo diem.
-- Thay cho dv_eod (chi rieng dich vu) — bang cu giu lai de tra cuu.
-- Chay SAU 043. Chay lai nhieu lan van an toan.
-- ============================================================

create table if not exists public.doi_soat_ngay (
  id bigserial primary key,
  location_code text not null references public.locations(code),
  ngay date not null,
  -- Ban xe
  so_don_ban int not null default 0,
  dt_ban_xe bigint not null default 0,
  thu_ban_xe bigint not null default 0,
  -- Dich vu
  so_phieu_dv int not null default 0,
  dt_dich_vu bigint not null default 0,
  thu_dich_vu bigint not null default 0,
  -- Tien khac
  thu_coc bigint not null default 0,
  thu_khac bigint not null default 0,
  chi_trong_ngay bigint not null default 0,
  -- Tong hop theo hinh thuc
  thu_tien_mat bigint not null default 0,
  thu_chuyen_khoan bigint not null default 0,
  cong_no bigint not null default 0,
  -- Doi chieu thuc te
  tien_mat_thuc_te bigint,
  lech bigint not null default 0,
  xe_luu int not null default 0,
  bien_ban_note text default '',
  -- 2 chu ky
  confirmed_thu_by uuid references public.profiles(id),
  confirmed_thu_name text default '',
  confirmed_thu_at timestamptz,
  confirmed_cht_by uuid references public.profiles(id),
  confirmed_cht_name text default '',
  confirmed_cht_at timestamptz,
  status text not null default 'MO' check (status in ('MO','DA_CHOT')),
  updated_at timestamptz not null default now(),
  unique (location_code, ngay)
);
create index if not exists doi_soat_idx on public.doi_soat_ngay (ngay desc, location_code);

drop trigger if exists trg_touch_doi_soat on public.doi_soat_ngay;
create trigger trg_touch_doi_soat before update on public.doi_soat_ngay
  for each row execute function public._touch_updated_at();

alter table public.doi_soat_ngay enable row level security;
drop policy if exists "read_doi_soat" on public.doi_soat_ngay;
create policy "read_doi_soat" on public.doi_soat_ngay for select to authenticated using (
  public.my_role() in ('ADMIN','CEO') or public.my_region() is null
  or exists (select 1 from public.locations l where l.code = location_code and l.region = public.my_region())
);

-- ===================== TÍNH SỐ LIỆU NGÀY =====================
create or replace function public.fn_doi_soat_tinh(p_loc text, p_date date)
returns public.doi_soat_ngay language plpgsql security definer set search_path = public as $$
declare me record; e public.doi_soat_ngay;
  v_don int; v_dt_xe bigint; v_thu_xe bigint;
  v_pdv int; v_dt_dv bigint; v_thu_dv bigint;
  v_coc bigint; v_khac bigint; v_chi bigint;
  v_tm bigint; v_ck bigint; v_no bigint; v_luu int;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('thu_chi_xem') then raise exception 'KHONG_CO_QUYEN'; end if;

  -- 1) BAN XE trong ngay
  select count(*),
         coalesce(sum(o.sale_price * o.quantity
           + coalesce((select sum(i.amount) from public.sale_items i where i.sale_code = o.code),0)), 0),
         coalesce(sum(o.paid_amount), 0)
    into v_don, v_dt_xe, v_thu_xe
  from public.sales_orders o
  where o.location_code = p_loc and o.sale_date = p_date;

  -- 2) DICH VU giao trong ngay
  select count(*), coalesce(sum(v.tong),0), coalesce(sum(v.debt_approved),0)
    into v_pdv, v_dt_dv, v_no
  from public.dv_tickets t join public.v_dv_ticket_tong v on v.ticket_id = t.id
  where t.location_code = p_loc and t.status = 'DA_GIAO'
    and (t.delivered_at at time zone 'Asia/Ho_Chi_Minh')::date = p_date;

  select coalesce(sum(p.amount), 0) into v_thu_dv
  from public.dv_payments p join public.dv_tickets t on t.id = p.ticket_id
  where t.location_code = p_loc and (p.created_at at time zone 'Asia/Ho_Chi_Minh')::date = p_date;

  -- 3) TIEN COC nhan trong ngay
  select coalesce(sum(d.amount), 0) into v_coc
  from public.deposits d
  where d.location_code = p_loc and (d.created_at at time zone 'Asia/Ho_Chi_Minh')::date = p_date;

  -- 4) SO QUY: thu/chi theo hinh thuc (quy gan voi diem nay)
  select coalesce(sum(t.amount) filter (where t.direction='Thu' and a.type='Tiền mặt'), 0),
         coalesce(sum(t.amount) filter (where t.direction='Thu' and a.type='Ngân hàng'), 0),
         coalesce(sum(t.amount) filter (where t.direction='Chi'), 0),
         coalesce(sum(t.amount) filter (where t.direction='Thu'
                  and t.category not in ('Bán xe','Thu dịch vụ','Thu tiền cọc','Thu công nợ bán xe')), 0)
    into v_tm, v_ck, v_chi, v_khac
  from public.cash_txns t join public.cash_accounts a on a.id = t.account_id
  where t.txn_date = p_date and (a.location_code = p_loc or a.location_code is null);

  -- 5) Xe dich vu con luu qua dem
  select count(*) into v_luu from public.dv_tickets
  where location_code = p_loc and status not in ('DA_GIAO','HUY');

  insert into public.doi_soat_ngay (location_code, ngay, so_don_ban, dt_ban_xe, thu_ban_xe,
    so_phieu_dv, dt_dich_vu, thu_dich_vu, thu_coc, thu_khac, chi_trong_ngay,
    thu_tien_mat, thu_chuyen_khoan, cong_no, lech, xe_luu)
  values (p_loc, p_date, v_don, v_dt_xe, v_thu_xe, v_pdv, v_dt_dv, v_thu_dv,
    v_coc, v_khac, v_chi, v_tm, v_ck, v_no,
    (v_thu_xe + v_thu_dv + v_coc + v_khac) - (v_tm + v_ck), v_luu)
  on conflict (location_code, ngay) do update set
    so_don_ban = excluded.so_don_ban, dt_ban_xe = excluded.dt_ban_xe, thu_ban_xe = excluded.thu_ban_xe,
    so_phieu_dv = excluded.so_phieu_dv, dt_dich_vu = excluded.dt_dich_vu, thu_dich_vu = excluded.thu_dich_vu,
    thu_coc = excluded.thu_coc, thu_khac = excluded.thu_khac, chi_trong_ngay = excluded.chi_trong_ngay,
    thu_tien_mat = excluded.thu_tien_mat, thu_chuyen_khoan = excluded.thu_chuyen_khoan,
    cong_no = excluded.cong_no, lech = excluded.lech, xe_luu = excluded.xe_luu, updated_at = now()
  returning * into e;
  return e;
end $$;

-- ===================== CHỐT NGÀY (2 chữ ký) =====================
create or replace function public.fn_doi_soat_chot(p_loc text, p_date date, p_vai text,
  p_tien_mat_thuc_te bigint, p_bien_ban text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; e record; v_lech bigint;
begin
  select * into me from public.fn_me_mkt();
  perform public.fn_doi_soat_tinh(p_loc, p_date);
  select * into e from public.doi_soat_ngay where location_code = p_loc and ngay = p_date for update;
  if e.status = 'DA_CHOT' then raise exception 'TRANG_THAI_SAI: ngày này đã chốt'; end if;

  -- Neu co nhap tien mat thuc te -> tinh lech theo do
  if p_tien_mat_thuc_te is not null then
    v_lech := p_tien_mat_thuc_te - e.thu_tien_mat;
    update public.doi_soat_ngay set tien_mat_thuc_te = p_tien_mat_thuc_te, lech = v_lech where id = e.id;
  else
    v_lech := e.lech;
  end if;

  if v_lech <> 0 and coalesce(btrim(p_bien_ban),'') = '' and coalesce(btrim(e.bien_ban_note),'') = '' then
    raise exception 'CO_LECH: lệch %đ — bắt buộc ghi biên bản chênh lệch trước khi chốt', v_lech;
  end if;

  if p_vai = 'thu' then
    if not public.fn_co_quyen('thu_chi_ghi') then raise exception 'KHONG_CO_QUYEN'; end if;
    update public.doi_soat_ngay set confirmed_thu_by = me.uid, confirmed_thu_name = me.name,
      confirmed_thu_at = now(), bien_ban_note = coalesce(nullif(p_bien_ban,''), bien_ban_note) where id = e.id;
  elsif p_vai = 'cht' then
    if not public.fn_co_quyen('thu_chi_chot') and not public.fn_co_quyen('dv_eod') then raise exception 'KHONG_CO_QUYEN'; end if;
    update public.doi_soat_ngay set confirmed_cht_by = me.uid, confirmed_cht_name = me.name,
      confirmed_cht_at = now(), bien_ban_note = coalesce(nullif(p_bien_ban,''), bien_ban_note) where id = e.id;
  else
    raise exception 'THAM_SO_SAI: vai phải là thu hoặc cht';
  end if;

  select * into e from public.doi_soat_ngay where id = e.id;
  if e.confirmed_thu_at is not null and e.confirmed_cht_at is not null then
    update public.doi_soat_ngay set status = 'DA_CHOT' where id = e.id;
    perform public._notify_discord(jsonb_build_object('content',
      concat('📋 **ĐỐI SOÁT ', p_loc, ' ngày ', p_date, '**', E'\n',
        '🛵 Bán xe: ', e.so_don_ban, ' đơn · ', to_char(e.dt_ban_xe,'FM999,999,999,999'), 'đ (thu ',
        to_char(e.thu_ban_xe,'FM999,999,999,999'), 'đ)', E'\n',
        '🔧 Dịch vụ: ', e.so_phieu_dv, ' phiếu · ', to_char(e.dt_dich_vu,'FM999,999,999,999'), 'đ (thu ',
        to_char(e.thu_dich_vu,'FM999,999,999,999'), 'đ)', E'\n',
        '💵 Tiền mặt: ', to_char(e.thu_tien_mat,'FM999,999,999,999'), 'đ · 🏦 CK: ',
        to_char(e.thu_chuyen_khoan,'FM999,999,999,999'), 'đ', E'\n',
        '📉 Chi: ', to_char(e.chi_trong_ngay,'FM999,999,999,999'), 'đ · Công nợ: ',
        to_char(e.cong_no,'FM999,999,999,999'), 'đ', E'\n',
        case when e.lech = 0 then '✅ Khớp' else concat('⚠️ LỆCH ', to_char(e.lech,'FM999,999,999,999'), 'đ — xem biên bản') end)));
  end if;
end $$;
