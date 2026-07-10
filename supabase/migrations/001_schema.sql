-- ============================================================
-- MINH KY EV - HE THONG QUAN LY XUAT NHAP TON XE MAY DIEN
-- Migration 001: Schema
-- ============================================================

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  role text not null default 'SALES' check (role in ('CEO','MANAGER','SALES','ADMIN')),
  region text check (region in ('Thành phố','Hàm Yên')),
  status text not null default 'Hoạt động',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.locations (
  code text primary key,
  name text not null,
  region text not null check (region in ('Thành phố','Hàm Yên','Khác')),
  type text not null check (type in ('Cửa hàng','Kho','Showroom','Trạm dịch vụ')),
  address text default '',
  status text not null default 'Hoạt động',
  created_at timestamptz not null default now()
);

create table public.vehicles (
  id text primary key,
  mfr_code text default '',
  brand text not null,
  name text not null,
  version text default '',
  color text not null,
  list_price bigint not null default 0,
  suggested_price bigint,
  min_stock int not null default 2,
  status text not null default 'Đang bán' check (status in ('Đang bán','Ngừng bán','Xe hot','Tồn chậm')),
  image_url text,
  note text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.inventory (
  vehicle_id text not null references public.vehicles(id),
  location_code text not null references public.locations(code),
  quantity int not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (vehicle_id, location_code)
);

-- Lich su giao dich (append-only)
create table public.inventory_txns (
  id bigserial primary key,
  txn_type text not null check (txn_type in ('Nhập hàng','Bán hàng','Điều chuyển','Điều chỉnh','Kiểm kê')),
  vehicle_id text not null references public.vehicles(id),
  from_location text references public.locations(code),
  to_location text references public.locations(code),
  qty int not null,
  stock_before int not null,
  stock_after int not null,
  doc_code text default '',
  note text default '',
  created_by uuid references public.profiles(id),
  created_by_name text default '',
  created_at timestamptz not null default now()
);
create index on public.inventory_txns (created_at desc);
create index on public.inventory_txns (vehicle_id);
create index on public.inventory_txns (txn_type);

create table public.sales_orders (
  id bigserial primary key,
  code text unique not null,
  sale_date date not null default current_date,
  location_code text not null references public.locations(code),
  vehicle_id text not null references public.vehicles(id),
  quantity int not null check (quantity > 0),
  frame_number text default '',
  engine_number text default '',
  customer_name text not null,
  customer_phone text not null,
  customer_cccd text default '',
  customer_address text default '',
  customer_type text default 'Khách lẻ',
  customer_source text default 'Khách vãng lai',
  list_price bigint not null default 0,
  sale_price bigint not null default 0,
  payment_method text default 'Chuyển khoản',
  seller_id uuid references public.profiles(id),
  seller_name text default '',
  document_status text not null default 'Đang làm đăng ký',
  warranty_status text not null default 'Chưa kích hoạt',
  vinfast_app_status text not null default 'Chưa liên kết',
  note text default '',
  status text not null default 'Đã trừ tồn',
  created_at timestamptz not null default now()
);
create index on public.sales_orders (sale_date desc);
create index on public.sales_orders (seller_id);

create table public.transfer_orders (
  id bigserial primary key,
  code text unique not null,
  from_location text not null references public.locations(code),
  to_location text not null references public.locations(code),
  vehicle_id text not null references public.vehicles(id),
  quantity int not null check (quantity > 0),
  requested_by uuid references public.profiles(id),
  requested_by_name text default '',
  confirmed_by uuid references public.profiles(id),
  confirmed_by_name text default '',
  requested_at timestamptz not null default now(),
  confirmed_at timestamptz,
  status text not null default 'Đang chuyển' check (status in ('Nháp','Đang chuyển','Đã nhận','Đã hủy','Lỗi/chênh lệch')),
  note text default ''
);

create table public.stock_adjustments (
  id bigserial primary key,
  code text unique not null,
  location_code text not null references public.locations(code),
  vehicle_id text not null references public.vehicles(id),
  system_qty int not null,
  actual_qty int not null,
  diff_qty int not null,
  reason text not null,
  requested_by uuid references public.profiles(id),
  requested_by_name text default '',
  approved_by uuid references public.profiles(id),
  approved_by_name text default '',
  status text not null default 'Chờ duyệt' check (status in ('Chờ duyệt','Đã duyệt','Từ chối')),
  note text default '',
  created_at timestamptz not null default now(),
  approved_at timestamptz
);

-- Tu dong tao profile khi user dang ky (mac dinh SALES, CEO nang quyen sau)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)), 'SALES');
  return new;
end; $$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
