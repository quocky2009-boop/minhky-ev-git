export const CUSTOMER_TYPES = ["Khách lẻ", "Khách buôn", "Khách CBNV", "Khách cũ", "Đối tác", "O2O"];
export const CUSTOMER_SOURCES = ["Khách vãng lai", "Tự tìm kiếm", "Facebook/Tiktok", "Zalo", "Khách cũ giới thiệu", "ĐL bán buôn", "Công ty giao", "Telesale", "Khác"];
export const PAYMENT_METHODS = ["Chuyển khoản", "Tiền mặt", "Cả CK và TM", "Trả góp"];
export const DOC_STATUSES = ["Đủ hồ sơ", "Thiếu CCCD", "Thiếu địa chỉ", "Đang làm đăng ký", "Đã xong đăng ký", "Không làm đăng ký"];
export const ADJUST_REASONS = ["Kiểm kê lệch", "Nhập sai mã xe", "Nhập sai màu", "Sai vị trí kho", "Xe hỏng", "Xe trưng bày", "Xe giữ cho khách", "Lý do khác"];
export const ROLES = { CEO: "CEO / BGĐ", MANAGER: "Quản lý cửa hàng", SALES: "Sales", ADMIN: "Admin / Kế toán / Kho" };

export const NAV = [
  { href: "/dashboard", label: "Tổng quan", icon: "▦", roles: ["CEO", "MANAGER", "ADMIN"] },
  { href: "/tra-cuu", label: "Tra cứu tồn", icon: "⌕", roles: ["CEO", "MANAGER", "SALES", "ADMIN"] },
  { href: "/ban-hang", label: "Bán hàng", icon: "₫", roles: ["CEO", "MANAGER", "SALES", "ADMIN"] },
  { href: "/nhap-hang", label: "Nhập hàng", icon: "⇩", roles: ["CEO", "ADMIN"] },
  { href: "/dieu-chuyen", label: "Điều chuyển", icon: "⇄", roles: ["CEO", "MANAGER", "SALES", "ADMIN"] },
  { href: "/dieu-chinh", label: "Điều chỉnh tồn", icon: "±", roles: ["CEO", "MANAGER", "ADMIN"] },
  { href: "/kiem-ke", label: "Kiểm kê", icon: "☑", roles: ["CEO", "MANAGER", "ADMIN"] },
  { href: "/lich-su", label: "Lịch sử giao dịch", icon: "≡", roles: ["CEO", "MANAGER", "ADMIN"] },
  { href: "/ton-tong-hop", label: "Bảng tồn tổng hợp", icon: "▦", roles: ["CEO", "MANAGER", "ADMIN"] },
  { href: "/danh-muc-xe", label: "Danh mục xe", icon: "◈", roles: ["CEO", "ADMIN"] },
  { href: "/kho", label: "Kho / Cửa hàng", icon: "⌂", roles: ["CEO", "ADMIN"] },
  { href: "/bao-cao", label: "Báo cáo", icon: "▤", roles: ["CEO", "MANAGER", "ADMIN"] },
  { href: "/nguoi-dung", label: "Người dùng", icon: "◉", roles: ["CEO"] },
  { href: "/cai-dat", label: "Cài đặt", icon: "⚙", roles: ["CEO", "ADMIN"] },
];
