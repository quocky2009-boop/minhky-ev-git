# HƯỚNG DẪN TRIỂN KHAI LÊN HAWKHOST — TỪNG BƯỚC

Áp dụng cho gói Shared Hosting của HawkHost (Launch/Primary...), dùng cPanel.
Thời gian: khoảng 45–60 phút lần đầu.

**Kiến trúc:** HawkHost chỉ chạy phần website (Next.js). Dữ liệu nằm trên
Supabase (PostgreSQL, miễn phí) — vì shared hosting của HawkHost không chạy
được PostgreSQL riêng. Hai bên nói chuyện với nhau qua Internet, an toàn qua HTTPS.

---

## PHẦN A — CHUẨN BỊ DATABASE SUPABASE (nếu chưa làm)

Làm theo Bước 1 → Bước 4 trong file `README.md`:
1. Tạo project Supabase miễn phí (region Singapore).
2. SQL Editor: chạy lần lượt 4 file trong thư mục `supabase/`.
3. Authentication: tạo tài khoản CEO, chạy 1 câu SQL nâng quyền.
4. Ghi lại 2 giá trị ở Project Settings → API:
   - Project URL  (dạng https://abcxyz.supabase.co)
   - anon public key (chuỗi dài bắt đầu bằng eyJ...)

---

## PHẦN B — TRIỂN KHAI TRÊN HAWKHOST

### Bước 1. Đăng nhập cPanel
- Vào https://my.hawkhost.com → đăng nhập → Services → chọn gói hosting → nút **Login to cPanel**.
- (Hoặc vào thẳng https://tenmien-cua-anh:2083)

### Bước 2. (Khuyên dùng) Tạo subdomain riêng cho app
Để web kho chạy ở địa chỉ riêng, ví dụ `kho.tenmien.com`:
- cPanel → **Domains** → **Create a New Domain**
- Nhập `kho.tenmien.com`, bỏ tick "Share document root", bấm Submit.
(Nếu muốn chạy thẳng trên tên miền chính thì bỏ qua bước này.)

### Bước 3. Tạo ứng dụng Node.js
- cPanel → mục **Software** → **Setup Node.js App** → **Create Application**
- Điền như sau:
  - **Node.js version**: chọn bản 20.x (không có thì chọn 18.x — tối thiểu 18.17)
  - **Application mode**: Production
  - **Application root**: `minhky-ev`
  - **Application URL**: chọn `kho.tenmien.com` (hoặc tên miền chính)
  - **Application startup file**: `server.js`
- Bấm **Create**. Trạng thái sẽ báo app đã tạo (mở URL lúc này sẽ thấy trang "It works!" mặc định — đúng, vì chưa có code).

### Bước 4. Upload mã nguồn
- cPanel → **File Manager** → vào thư mục gốc `/home/tên-user` (KHÔNG vào public_html)
- Bấm **Upload** → chọn file `minhky-ev-inventory.zip`
- Upload xong quay lại File Manager → chuột phải file zip → **Extract** → giải nén tại `/home/tên-user`
- Kết quả: các file nằm trong `/home/tên-user/minhky-ev/` — trùng với Application root ở Bước 3. Kiểm tra thấy có `package.json`, `server.js`, thư mục `app/` là đúng.
- Xóa file zip cho gọn.

### Bước 5. Tạo file cấu hình kết nối Supabase
- Trong File Manager, vào thư mục `minhky-ev` → bấm **+ File** → đặt tên `.env.production`
  (Nếu không thấy file sau khi tạo: File Manager → Settings góc phải trên → tick **Show Hidden Files**.)
- Chuột phải file → **Edit**, dán vào 2 dòng (thay bằng giá trị thật ở Phần A):

```
NEXT_PUBLIC_SUPABASE_URL=https://abcxyz.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...khóa-của-anh...
```

- Save. (Khóa anon là khóa công khai, dữ liệu vẫn được bảo vệ bởi phân quyền RLS phía Supabase.)

### Bước 6. Cài thư viện
- Quay lại **Setup Node.js App** → bấm biểu tượng cây bút (Edit) ở app vừa tạo
- Bấm nút **Run NPM Install** → chờ 2–5 phút đến khi báo thành công.

### Bước 7. Build website (bước quan trọng nhất)
- Ở trang Edit app, trên cùng có 1 dòng lệnh dạng:
  `source /home/tên-user/nodevenv/minhky-ev/20/bin/activate && cd /home/tên-user/minhky-ev`
  → bấm vào để copy.
- cPanel → mục **Advanced** → **Terminal** → dán lệnh vừa copy, Enter.
  (Dấu nhắc lệnh sẽ đổi, hiện tên môi trường — là đã vào đúng chỗ.)
- Chạy tiếp:

```
npm run build
```

- Chờ 3–7 phút. Thành công khi thấy bảng liệt kê các Route (/dashboard, /tra-cuu, ...).
- Nếu báo lỗi hết bộ nhớ (heap out of memory), chạy lại bằng:

```
NODE_OPTIONS="--max-old-space-size=2048" npm run build
```

### Bước 8. Khởi động
- Quay lại **Setup Node.js App** → bấm **Restart** ở app.
- Mở trình duyệt vào `https://kho.tenmien.com` → thấy trang đăng nhập MINH KỲ EV là thành công.
- Đăng nhập bằng tài khoản CEO đã tạo ở Supabase.

### Bước 9. Bật khóa SSL (ổ khóa https)
- Thường HawkHost tự cấp AutoSSL sau 15–60 phút.
- Muốn nhanh: cPanel → **SSL/TLS Status** → tick domain `kho.tenmien.com` → **Run AutoSSL**.

---

## KHI CẬP NHẬT PHIÊN BẢN MỚI SAU NÀY
1. Upload đè các file code mới vào `minhky-ev`
2. Terminal: vào môi trường (lệnh source như Bước 7) → `npm run build`
3. Setup Node.js App → **Restart**

## XỬ LÝ LỖI THƯỜNG GẶP
| Hiện tượng | Cách xử lý |
|---|---|
| Lỗi 503 khi mở web | App chưa build hoặc crash. Xem file `stderr.log` trong thư mục `minhky-ev` (File Manager). Kiểm tra đã chạy `npm run build` thành công và Startup file đúng là `server.js`, rồi Restart. |
| "It works!" thay vì web | Passenger chưa nhận code: kiểm tra Application root đúng `minhky-ev`, startup file `server.js`, bấm Restart. |
| Trang trắng / lỗi kết nối dữ liệu | Sai 2 giá trị trong `.env.production`. Sửa lại → build lại (Bước 7) → Restart. Lưu ý: đổi file .env bắt buộc phải build lại. |
| npm install/build bị "Killed" | Hết RAM tạm thời: chạy lại với `NODE_OPTIONS="--max-old-space-size=2048"`. Vẫn lỗi thì mở ticket nhờ HawkHost tăng tạm LVE. |
| Web vào lần đầu chậm 3–5 giây | Bình thường trên shared hosting: Passenger tắt app khi lâu không có người dùng, lần truy cập đầu phải khởi động lại. Các lần sau nhanh. |
| Không thấy mục "Setup Node.js App" | Mở ticket hỏi HawkHost support yêu cầu bật Node.js selector (các gói shared đều được hỗ trợ). |
