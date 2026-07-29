-- ============================================================
-- Migration 075 — HỢP NHẤT CƠ HỘI VÀO KHÁCH HÀNG
--  Cơ hội bán hàng không còn là thực thể riêng — trở thành
--  pipeline stage của khách hàng. Thêm cột pipeline vào customers,
--  migrate du lieu tu co_hoi sang, chuyen co_hoi_logs -> customer_care_logs.
-- Chạy SAU 074. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

-- ===================== 1) THÊM CỘT PIPELINE VÀO customers =====================
alter table public.customers add column if not exists pipeline_stage text
  check (pipeline_stage in (
    'Mới tiếp nhận','Đã liên hệ','Có nhu cầu','Hẹn tới cửa hàng',
    'Đã lái thử','Đang báo giá','Đã cọc','Đã bán','Mất khách'
  ));
alter table public.customers add column if not exists heat text default 'Trung bình'
  check (heat in ('Nóng','Trung bình','Lạnh'));
alter table public.customers add column if not exists lost_reason text default '';
alter table public.customers add column if not exists next_call_date date;
alter table public.customers add column if not exists mua_cho text default '';
alter table public.customers add column if not exists need_loan boolean default false;
alter table public.customers add column if not exists current_vehicle text default '';
alter table public.customers add column if not exists competitor text default '';

create index if not exists customers_pipeline_idx on public.customers (pipeline_stage) where pipeline_stage is not null;
create index if not exists customers_next_call_idx on public.customers (next_call_date) where next_call_date is not null;

-- ===================== 2) MIGRATE DỮ LIỆU TỪ co_hoi =====================
-- Voi moi co_hoi: neu da co customer_id -> cap nhat; neu chua -> tao khach moi
do $mig$
declare c record; v_cust bigint;
begin
  -- Chi chay neu bang co_hoi ton tai va con du lieu chua migrate
  if exists (select 1 from information_schema.tables where table_name = 'co_hoi') then
    for c in select * from public.co_hoi where coalesce(migrated, false) = false loop
      -- Tim hoac tao khach
      if c.customer_id is not null then
        v_cust := c.customer_id;
      else
        -- Tim theo SDT
        select id into v_cust from public.customers where phone = c.customer_phone limit 1;
        if v_cust is null then
          insert into public.customers (code, name, phone, customer_type, source,
            assigned_to, assigned_name, location_code, interested_vehicle_id,
            interested_products, budget, buy_timeline, status, created_by, created_by_name, created_at)
          values (
            coalesce(public.fn_gen_code('KH'), 'KH'||c.id),
            c.customer_name, c.customer_phone,
            'Khách lẻ', c.source, c.assigned_to, c.assigned_name, c.location_code,
            c.interested_vehicle_id, coalesce(c.interested_vehicle_name,''),
            c.budget, c.buy_timeline, 'Lead mới', c.created_by, c.created_by_name, c.created_at)
          returning id into v_cust;
        end if;
      end if;

      -- Cap nhat thong tin pipeline vao khach
      update public.customers set
        pipeline_stage = c.stage,
        heat = c.heat,
        lost_reason = coalesce(c.lost_reason,''),
        next_call_date = c.next_call_date,
        mua_cho = coalesce(c.mua_cho,''),
        need_loan = coalesce(c.need_loan,false),
        current_vehicle = coalesce(c.current_vehicle,''),
        competitor = coalesce(c.competitor,''),
        source = coalesce(nullif(source,''), c.source),
        interested_vehicle_id = coalesce(interested_vehicle_id, c.interested_vehicle_id),
        budget = coalesce(nullif(budget,0), c.budget),
        updated_at = now()
      where id = v_cust;

      -- Danh dau da migrate
      update public.co_hoi set migrated = true, customer_id = v_cust where id = c.id;
    end loop;
  end if;
exception when undefined_column then
  -- Cot 'migrated' chua ton tai — them roi bao chay lai
  alter table public.co_hoi add column if not exists migrated boolean default false;
  raise notice 'Đã thêm cột migrated. Chạy lại migration 075 để hoàn tất migrate.';
end $mig$;

-- Dam bao cot migrated ton tai cho lan chay sau
do $$ begin
  if exists (select 1 from information_schema.tables where table_name = 'co_hoi') then
    alter table public.co_hoi add column if not exists migrated boolean default false;
  end if;
end $$;

-- ===================== 3) HÀM CẬP NHẬT PIPELINE KHÁCH =====================
create or replace function public.fn_doi_pipeline_khach(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; c record; v_stage text;
begin
  select * into me from public.fn_me_mkt();
  select * into c from public.customers where id = (p->>'id')::bigint for update;
  if c is null then raise exception 'KHONG_TIM_THAY'; end if;

  v_stage := p->>'pipeline_stage';
  if v_stage = 'Mất khách' and coalesce(trim(p->>'lost_reason'),'') = '' then
    raise exception 'BAT_BUOC: phải nhập lý do mất khách';
  end if;

  update public.customers set
    pipeline_stage = v_stage,
    heat = coalesce(nullif(p->>'heat',''), heat),
    next_call_date = coalesce(nullif(p->>'next_call_date','')::date, next_call_date),
    lost_reason = coalesce(nullif(p->>'lost_reason',''), lost_reason),
    status = case
      when v_stage = 'Đã bán' then 'Đã mua'
      when v_stage = 'Mất khách' then 'Không mua'
      else status end,
    updated_at = now()
  where id = c.id;

  -- Ghi log vao customer_care_logs
  insert into public.customer_care_logs (customer_id, care_date, contact_at, channel, content, result, created_by, created_by_name)
  values (c.id, current_date, now(), 'Cập nhật pipeline',
    'Chuyển giai đoạn: ' || coalesce(c.pipeline_stage,'(mới)') || ' → ' || v_stage,
    coalesce(p->>'note',''), me.uid, me.name);
end $$;

do $do$
begin
  raise notice 'XONG 075: hop nhat co_hoi vao customers (pipeline_stage, heat...); migrate du lieu';
end $do$;
