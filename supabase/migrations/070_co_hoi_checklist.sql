-- ============================================================
-- Migration 070 — CƠ HỘI BÁN HÀNG + CHECKLIST GIAO XE
--  1) Bang co_hoi: pipeline CRM truoc khi tao don ban
--  2) Bang co_hoi_logs: lich su thay doi tung co hoi
--  3) Them cot checklist_giao_xe vao sales_orders
-- Chạy SAU 069. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

-- ===================== 1) CƠ HỘI BÁN HÀNG =====================
create table if not exists public.co_hoi (
  id bigserial primary key,
  code text unique not null,

  -- Thong tin khach
  customer_id bigint references public.customers(id),
  customer_name text not null default '',
  customer_phone text not null default '',

  -- Nguon & phan loai
  source text not null default 'Khách vãng lai'
    check (source in ('Facebook','TikTok','Zalo','Khách vãng lai','Giới thiệu','Sự kiện','Website','Khác')),
  interested_vehicle_id text references public.vehicles(id),
  interested_vehicle_name text default '',  -- ghi tu do neu khong co trong danh muc
  budget bigint default 0,
  mua_cho text default '',          -- ban than / gia dinh / tang...
  need_loan boolean default false,  -- can tra gop
  current_vehicle text default '',  -- xe dang su dung
  buy_timeline text default '',     -- du kien mua: tuan nay / thang nay / 1-3 thang...
  competitor text default '',       -- doi thu dang so sanh

  -- Trang thai pipeline
  stage text not null default 'Mới tiếp nhận'
    check (stage in (
      'Mới tiếp nhận','Đã liên hệ','Có nhu cầu',
      'Hẹn tới cửa hàng','Đã lái thử','Đang báo giá',
      'Đã cọc','Đã bán','Mất khách'
    )),
  heat text not null default 'Trung bình'
    check (heat in ('Nóng','Trung bình','Lạnh')),

  -- Ket qua
  lost_reason text default '',    -- bat buoc khi stage = Mat khach
  result_note text default '',

  -- Phan cong & theo doi
  assigned_to uuid references public.profiles(id),
  assigned_name text default '',
  next_call_date date,
  location_code text references public.locations(code),

  -- Lien ket
  sale_order_code text,           -- khi chuyen thanh don ban
  deposit_code text,              -- khi da dat coc

  -- Meta
  created_by uuid references public.profiles(id),
  created_by_name text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists co_hoi_stage_idx on public.co_hoi (stage, assigned_to);
create index if not exists co_hoi_next_call_idx on public.co_hoi (next_call_date) where next_call_date is not null;
create index if not exists co_hoi_customer_idx on public.co_hoi (customer_id);

alter table public.co_hoi enable row level security;
create policy "co_hoi_auth" on public.co_hoi for all to authenticated using (true) with check (true);

-- ===================== 2) LOG LỊCH SỬ CƠ HỘI =====================
create table if not exists public.co_hoi_logs (
  id bigserial primary key,
  co_hoi_id bigint not null references public.co_hoi(id),
  action text not null,           -- 'create','stage_change','note','assign'
  from_stage text,
  to_stage text,
  note text default '',
  created_by uuid references public.profiles(id),
  created_by_name text default '',
  created_at timestamptz not null default now()
);
create index if not exists co_hoi_logs_idx on public.co_hoi_logs (co_hoi_id, created_at desc);
alter table public.co_hoi_logs enable row level security;
create policy "co_hoi_logs_auth" on public.co_hoi_logs for all to authenticated using (true) with check (true);

-- ===================== 3) CHECKLIST GIAO XE =====================
-- Luu dang jsonb trong sales_orders: moi key = true/false
-- Keys: da_thu_du_tien, dung_so_khung, ngoai_quan, ac_quy, phu_kien,
--       huong_dan, bao_hanh, bien_ban, anh_khach, lich_cham_soc
alter table public.sales_orders add column if not exists checklist_giao_xe jsonb not null default '{}'::jsonb;
alter table public.sales_orders add column if not exists ngay_giao_du_kien date;
alter table public.sales_orders add column if not exists nguoi_giao_xe uuid references public.profiles(id);
alter table public.sales_orders add column if not exists nguoi_giao_xe_name text default '';

-- ===================== 4) HÀM THAO TÁC CƠ HỘI =====================

-- Tao co hoi moi
create or replace function public.fn_tao_co_hoi(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare me record; v_id bigint; v_code text;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if coalesce(trim(p->>'customer_name'),'') = '' then raise exception 'THIEU_THONG_TIN: nhập tên khách'; end if;
  if coalesce(trim(p->>'customer_phone'),'') = '' then raise exception 'THIEU_THONG_TIN: nhập SĐT khách'; end if;

  v_code := public.fn_gen_code('CH');
  insert into public.co_hoi (code, customer_id, customer_name, customer_phone,
    source, interested_vehicle_id, interested_vehicle_name, budget, mua_cho,
    need_loan, current_vehicle, buy_timeline, competitor, stage, heat,
    assigned_to, assigned_name, next_call_date, location_code,
    created_by, created_by_name)
  values (v_code,
    nullif(p->>'customer_id','')::bigint,
    trim(p->>'customer_name'), trim(p->>'customer_phone'),
    coalesce(nullif(p->>'source',''),'Khách vãng lai'),
    nullif(p->>'interested_vehicle_id',''),
    coalesce(p->>'interested_vehicle_name',''),
    coalesce((p->>'budget')::bigint, 0),
    coalesce(p->>'mua_cho',''), coalesce((p->>'need_loan')::boolean, false),
    coalesce(p->>'current_vehicle',''), coalesce(p->>'buy_timeline',''),
    coalesce(p->>'competitor',''),
    coalesce(nullif(p->>'stage',''), 'Mới tiếp nhận'),
    coalesce(nullif(p->>'heat',''), 'Trung bình'),
    coalesce(nullif(p->>'assigned_to','')::uuid, me.uid),
    coalesce(nullif(p->>'assigned_name',''), me.name),
    nullif(p->>'next_call_date','')::date,
    nullif(p->>'location_code',''),
    me.uid, me.name)
  returning id into v_id;

  insert into public.co_hoi_logs (co_hoi_id, action, to_stage, note, created_by, created_by_name)
  values (v_id, 'create', 'Mới tiếp nhận', coalesce(p->>'note',''), me.uid, me.name);

  return v_id;
end $$;

-- Cap nhat stage co hoi (bat buoc ly do khi mat khach)
create or replace function public.fn_doi_stage_co_hoi(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; v record; v_stage text;
begin
  select * into me from public.fn_me_mkt();
  select * into v from public.co_hoi where id = (p->>'id')::bigint for update;
  if v is null then raise exception 'KHONG_TIM_THAY'; end if;

  v_stage := p->>'stage';
  if v_stage = 'Mất khách' and coalesce(trim(p->>'lost_reason'),'') = '' then
    raise exception 'BAT_BUOC: phải nhập lý do mất khách';
  end if;

  update public.co_hoi set
    stage = v_stage,
    heat  = coalesce(nullif(p->>'heat',''), heat),
    next_call_date = coalesce(nullif(p->>'next_call_date','')::date, next_call_date),
    lost_reason = coalesce(nullif(p->>'lost_reason',''), lost_reason),
    result_note = coalesce(nullif(p->>'result_note',''), result_note),
    updated_at = now()
  where id = v.id;

  insert into public.co_hoi_logs (co_hoi_id, action, from_stage, to_stage, note, created_by, created_by_name)
  values (v.id, 'stage_change', v.stage, v_stage, coalesce(p->>'note',''), me.uid, me.name);
end $$;

-- Cap nhat thong tin co hoi
create or replace function public.fn_sua_co_hoi(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record;
begin
  select * into me from public.fn_me_mkt();
  update public.co_hoi set
    customer_name = coalesce(nullif(p->>'customer_name',''), customer_name),
    customer_phone = coalesce(nullif(p->>'customer_phone',''), customer_phone),
    source = coalesce(nullif(p->>'source',''), source),
    interested_vehicle_id = coalesce(nullif(p->>'interested_vehicle_id',''), interested_vehicle_id),
    interested_vehicle_name = coalesce(p->>'interested_vehicle_name', interested_vehicle_name),
    budget = coalesce(nullif(p->>'budget','')::bigint, budget),
    mua_cho = coalesce(p->>'mua_cho', mua_cho),
    need_loan = coalesce((p->>'need_loan')::boolean, need_loan),
    current_vehicle = coalesce(p->>'current_vehicle', current_vehicle),
    buy_timeline = coalesce(p->>'buy_timeline', buy_timeline),
    competitor = coalesce(p->>'competitor', competitor),
    heat = coalesce(nullif(p->>'heat',''), heat),
    next_call_date = coalesce(nullif(p->>'next_call_date','')::date, next_call_date),
    assigned_to = coalesce(nullif(p->>'assigned_to','')::uuid, assigned_to),
    assigned_name = coalesce(nullif(p->>'assigned_name',''), assigned_name),
    location_code = coalesce(nullif(p->>'location_code',''), location_code),
    updated_at = now()
  where id = (p->>'id')::bigint;

  insert into public.co_hoi_logs (co_hoi_id, action, note, created_by, created_by_name)
  values ((p->>'id')::bigint, 'update', coalesce(p->>'note','Cập nhật thông tin'), me.uid, me.name);
end $$;

-- View tong hop co hoi
create or replace view public.v_co_hoi as
select c.*,
  v.name as vehicle_name_cat, v.brand as vehicle_brand,
  l.name as location_name,
  (select count(*) from public.co_hoi_logs g where g.co_hoi_id = c.id) as so_log,
  (select max(g.created_at) from public.co_hoi_logs g where g.co_hoi_id = c.id) as last_activity
from public.co_hoi c
left join public.vehicles v on v.id = c.interested_vehicle_id
left join public.locations l on l.code = c.location_code;

grant select on public.v_co_hoi to authenticated;

do $do$
begin
  raise notice 'XONG 070: co_hoi + co_hoi_logs + checklist_giao_xe + fn_tao/doi_stage/sua_co_hoi';
end $do$;
