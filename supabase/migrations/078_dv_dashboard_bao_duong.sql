-- ============================================================
-- Migration 078 — DASHBOARD DV + NHẮC BẢO DƯỠNG + LỊCH SỬ THEO SỐ KHUNG
-- Chạy SAU 077. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

-- ===================== 1) NHẮC BẢO DƯỠNG ĐỊNH KỲ =====================
create table if not exists public.maintenance_reminders (
  id bigserial primary key,
  frame_number text not null,
  customer_id bigint references public.customers(id),
  customer_name text default '',
  customer_phone text default '',
  last_service_date date,
  next_due_date date not null,
  interval_months int not null default 6,
  note text default '',
  status text not null default 'Chưa nhắc' check (status in ('Chưa nhắc','Đã nhắc','Đã đến bảo dưỡng','Bỏ qua')),
  created_by uuid references public.profiles(id),
  created_by_name text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists maint_frame_idx on public.maintenance_reminders (frame_number);
create index if not exists maint_due_idx on public.maintenance_reminders (next_due_date) where status not in ('Đã đến bảo dưỡng','Bỏ qua');
alter table public.maintenance_reminders enable row level security;
create policy "maint_auth" on public.maintenance_reminders for all to authenticated using (true) with check (true);

-- Tu dong tao/cap nhat lich nhac bao duong khi phieu DV giao xe xong
create or replace function public._trg_dv_tao_nhac_bao_duong()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_existing_id bigint;
begin
  if NEW.status = 'DA_GIAO' and (OLD.status is distinct from 'DA_GIAO') and coalesce(NEW.frame_number,'') <> '' then
    select id into v_existing_id from public.maintenance_reminders
    where frame_number = NEW.frame_number order by id desc limit 1;

    if v_existing_id is null then
      insert into public.maintenance_reminders (frame_number, customer_id, customer_name, customer_phone,
        last_service_date, next_due_date, interval_months, status)
      values (NEW.frame_number, NEW.customer_id, NEW.customer_name, NEW.customer_phone,
        current_date, current_date + interval '6 months', 6, 'Chưa nhắc');
    else
      update public.maintenance_reminders set
        last_service_date = current_date,
        next_due_date = current_date + (interval_months || ' months')::interval,
        status = 'Chưa nhắc', updated_at = now()
      where id = v_existing_id;
    end if;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_dv_tao_nhac_bao_duong on public.dv_tickets;
create trigger trg_dv_tao_nhac_bao_duong
  after update on public.dv_tickets
  for each row execute function public._trg_dv_tao_nhac_bao_duong();

-- Ham cap nhat trang thai nhac bao duong
create or replace function public.fn_cap_nhat_nhac_bao_duong(p_id bigint, p_status text, p_next_due date)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.maintenance_reminders set
    status = p_status,
    next_due_date = coalesce(p_next_due, next_due_date),
    updated_at = now()
  where id = p_id;
end $$;

-- ===================== 2) VIEW LỊCH SỬ SỬA CHỮA THEO SỐ KHUNG =====================
create or replace view public.v_dv_lich_su_xe as
select t.id, t.code, t.frame_number, t.vehicle_desc, t.customer_name, t.customer_phone,
  t.status, t.request_note, t.odo_km, t.created_at as ngay_tiep_nhan,
  t.qc_at as ngay_nghiem_thu, t.received_by_name, t.ktv_id, t.ktv_name,
  (select coalesce(sum(l.amount),0) from public.dv_ticket_lines l where l.ticket_id = t.id) as tong_tien,
  (select string_agg(l.name, ', ') from public.dv_ticket_lines l where l.ticket_id = t.id and l.line_type = 'CONG') as cac_hang_muc_cong,
  (select string_agg(l.name, ', ') from public.dv_ticket_lines l where l.ticket_id = t.id and l.line_type = 'PHU_TUNG') as cac_phu_tung_thay
from public.dv_tickets t
where coalesce(t.frame_number,'') <> '';

grant select on public.v_dv_lich_su_xe to authenticated;

-- ===================== 3) VIEW DASHBOARD DỊCH VỤ =====================
create or replace view public.v_dv_dashboard as
select
  t.id, t.code, t.location_code, t.region, t.status, t.created_at, t.qc_at,
  t.received_by_name, t.ktv_id, t.ktv_name,
  (select coalesce(sum(l.amount),0) from public.dv_ticket_lines l where l.ticket_id = t.id) as tong_tien,
  -- Qua han: tiep nhan qua 3 ngay ma chua nghiem thu/giao xe
  (t.status not in ('DA_GIAO','HUY') and t.created_at < now() - interval '3 days') as qua_han
from public.dv_tickets t;

grant select on public.v_dv_dashboard to authenticated;

do $do$
begin
  raise notice 'XONG 078: maintenance_reminders + trigger tu tao nhac bao duong; v_dv_lich_su_xe; v_dv_dashboard';
end $do$;
