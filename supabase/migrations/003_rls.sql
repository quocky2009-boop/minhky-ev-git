-- ============================================================
-- Migration 003: Row Level Security
-- Nguyen tac: moi nguoi dang nhap DOC duoc du lieu;
-- KHONG ai ghi truc tiep vao bang - moi thay doi qua RPC.
-- ============================================================

alter table public.profiles enable row level security;
alter table public.locations enable row level security;
alter table public.vehicles enable row level security;
alter table public.inventory enable row level security;
alter table public.inventory_txns enable row level security;
alter table public.sales_orders enable row level security;
alter table public.transfer_orders enable row level security;
alter table public.stock_adjustments enable row level security;

-- Doc: tat ca nguoi dung da dang nhap
create policy "read_profiles" on public.profiles for select to authenticated using (true);
create policy "read_locations" on public.locations for select to authenticated using (true);
create policy "read_vehicles" on public.vehicles for select to authenticated using (true);
create policy "read_inventory" on public.inventory for select to authenticated using (true);
create policy "read_txns" on public.inventory_txns for select to authenticated using (true);
create policy "read_transfers" on public.transfer_orders for select to authenticated using (true);
create policy "read_adjustments" on public.stock_adjustments for select to authenticated using (true);

-- Don ban: Sales chi xem don cua minh; Manager/Admin/CEO xem tat ca
create policy "read_sales" on public.sales_orders for select to authenticated
using (
  seller_id = auth.uid()
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('CEO','MANAGER','ADMIN'))
);

-- Nguoi dung duoc sua ten cua chinh minh
create policy "update_own_profile" on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()));

-- Khong tao policy insert/update/delete nao khac
-- => ghi du lieu bat buoc di qua cac ham SECURITY DEFINER o migration 002.
