import "./globals.css";

export const metadata = {
  title: "Minh Kỳ EV — Quản lý tồn kho xe máy điện",
  description: "Hệ thống quản lý xuất nhập tồn xe máy điện VinFast & TAILG — Minh Kỳ Tuyên Quang",
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
