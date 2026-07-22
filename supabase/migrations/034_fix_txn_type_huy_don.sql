-- ============================================================
-- Migration 034 — FIX: xoa don ban bao loi constraint
-- Loi: fn_xoa_don (028) ghi lich su loai 'Hủy đơn bán' nhung
-- bang inventory_txns chi cho phep 5 loai cu.
-- Sua: mo rong danh sach loai giao dich hop le.
-- Chay 1 lan la xong, chay lai nhieu lan van an toan.
-- ============================================================

alter table public.inventory_txns drop constraint if exists inventory_txns_txn_type_check;
alter table public.inventory_txns add constraint inventory_txns_txn_type_check
  check (txn_type in ('Nhập hàng','Bán hàng','Điều chuyển','Điều chỉnh','Kiểm kê','Hủy đơn bán'));
