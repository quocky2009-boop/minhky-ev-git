# MINH KỲ EV — Hệ thống quản lý xuất nhập tồn xe máy điện

Website quản lý tồn kho xe máy điện VinFast & TAILG cho hệ thống Minh Kỳ (Tuyên Quang), thay thế file Excel "Sổ tổng hợp VinFast MK".

**Công nghệ:** Next.js 14 (App Router) · Supabase (PostgreSQL + Auth) · Tailwind CSS.

**Nguyên tắc cứng đã cài vào database (không lách được từ giao diện):**
- Tồn kho chỉ thay đổi qua 4 loại giao dịch: nhập hàng, bán hàng, điều chuyển đã xác nhận, điều chỉnh đã duyệt.
- Bán vượt tồn bị chặn ngay tại database (hàm `fn_ban_hang` khóa dòng tồn và kiểm tra trước khi trừ).
- Điều chuyển 2 bước: tạo phiếu → bên nhận xác nhận thì tồn mới di chuyển.
- Điều chỉnh tồn bắt buộc có lý do và phải được Admin/BGĐ duyệt.
- Lịch sử giao dịch append-only, ghi tồn trước/sau, người thao tác, thời gian. Không có quyền xóa/sửa.
- Sales chỉ tra cứu, tạo đơn bán, tạo yêu cầu điều chuyển và chỉ xem đơn của mình (RLS).

---

## TRIỂN KHAI TỪNG BƯỚC (khoảng 30–45 phút)

### Bước 1 — Tạo project Supabase (miễn phí)
1. Vào https://supabase.com → Sign up → **New project**.
2. Đặt tên `minhky-ev`, chọn region **Southeast Asia (Singapore)**, đặt mật khẩu database (lưu lại).
3. Đợi ~2 phút cho project khởi tạo.

### Bước 2 — Chạy SQL khởi tạo
Vào **SQL Editor** (menu trái) → chạy lần lượt 4 file, mỗi file 1 lần bấm **Run**:
1. `supabase/migrations/001_schema.sql` — tạo bảng
2. `supabase/migrations/002_functions.sql` — hàm nghiệp vụ
3. `supabase/migrations/003_rls.sql` — phân quyền bảo mật
4. `supabase/seed.sql` — nạp 49 mã xe + tồn kho thật từ file Excel 06/2026

### Bước 3 — Tạo tài khoản người dùng
1. Vào **Authentication → Users → Add user → Create new user**.
2. Tạo tài khoản đầu tiên cho CEO (vd `ky@minhky.vn` + mật khẩu). Tick **Auto Confirm User**.
3. Nâng quyền CEO: vào **SQL Editor** chạy:
   ```sql
   update public.profiles set role = 'CEO', name = 'Anh Kỳ'
   where id = (select id from auth.users where email = 'ky@minhky.vn');
   ```
4. Các tài khoản sau (quản lý, sales, kế toán) cũng tạo trong Authentication; mặc định là Sales — CEO đăng nhập vào app, vào màn **Người dùng** để phân quyền, không cần SQL nữa.

### Bước 4 — Lấy khóa kết nối
Vào **Project Settings → API**, copy 2 giá trị:
- `Project URL` → NEXT_PUBLIC_SUPABASE_URL
- `anon public` key → NEXT_PUBLIC_SUPABASE_ANON_KEY

### Bước 5 — Deploy web lên Vercel (miễn phí)
1. Đưa thư mục này lên GitHub (repo private).
2. Vào https://vercel.com → **Add New Project** → import repo.
3. Ở mục **Environment Variables**, thêm 2 biến ở Bước 4.
4. Bấm **Deploy**. Xong sẽ có link dạng `https://minhky-ev.vercel.app`.
5. (Tuỳ chọn) Gắn tên miền riêng, vd `kho.minhky.vn`, trong Settings → Domains.

### Chạy thử trên máy (tuỳ chọn)
```bash
npm install
cp .env.example .env.local   # điền 2 giá trị Supabase
npm run dev                   # mở http://localhost:3000
```

---

## PHÂN QUYỀN

| Vai trò | Quyền |
|---|---|
| CEO / BGĐ | Toàn bộ + duyệt điều chỉnh + phân quyền người dùng |
| Quản lý cửa hàng | Dashboard theo khu vực, xác nhận điều chuyển, đề xuất điều chỉnh, kiểm kê, báo cáo |
| Sales | Tra cứu tồn, tạo đơn bán (chỉ xem đơn của mình), yêu cầu điều chuyển |
| Admin / Kế toán / Kho | Nhập hàng, duyệt điều chỉnh, xác nhận điều chuyển, danh mục, báo cáo |

## CẤU TRÚC DỮ LIỆU
`profiles` (người dùng + vai trò) · `locations` (11 điểm kho) · `vehicles` (danh mục xe, mã chuẩn HÃNG_TÊN_MÀU) · `inventory` (tồn theo xe × kho) · `inventory_txns` (lịch sử, append-only) · `sales_orders` · `transfer_orders` · `stock_adjustments`.

## LỘ TRÌNH TIẾP THEO
- GĐ2: khóa Excel, thông báo Zalo khi có phiếu chờ duyệt, xuất .xlsx có định dạng, ảnh xe.
- GĐ3: nối sang CRM (đã cùng nền Supabase — dùng chung bảng khách hàng), hoa hồng sales, nhắc kích hoạt bảo hành.
- GĐ4: mở rộng phụ tùng, gara, xe cũ trên cùng nền tảng.

---

## TRIỂN KHAI TRÊN HAWKHOST (Shared Hosting, cPanel)

Xem hướng dẫn chi tiết từng bước trong file `HUONG-DAN-HAWKHOST.md` kèm theo.
Tóm tắt: cPanel → Setup Node.js App (Node 18/20, startup file `server.js`) → upload code → tạo `.env.production` → Run NPM Install → Terminal chạy `npm run build` → Restart.


---

## PHIEN BAN V2 (07/2026) - QUAN LY THEO SO KHUNG
- Ton kho chuan TUNG CHIEC theo so khung (vehicle_units). Nhap hang bat buoc dan danh sach so khung.
- Ban hang / dieu chuyen / dieu chinh / kiem ke deu chon dich danh so khung.
- Ton cu tu Excel duoc chuyen thanh so khung TAM (SKT-...) -> vao Kho > chon kho > "Sua SK" de thay so that.
- Truong tuy chinh dong tren don ban (Cai dat > Truong tuy chinh), thue suat chinh duoc (mac dinh 8%).
- Danh muc hang xe rieng; Danh muc xe co tim kiem + import/export CSV.
- Trang chi tiet kho (so ngay ton tung chiec) va Bang ton tong hop ma tran xe x kho.
- NANG CAP TU V1: chay them file supabase/migrations/004_units_v2.sql trong SQL Editor (1 lan duy nhat), sau do cap nhat code moi len GitHub.
