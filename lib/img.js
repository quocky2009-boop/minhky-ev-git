"use client";

// Nen anh phia trinh duyet truoc khi upload: resize toi da maxW px, xuat JPEG
export function nenAnh(file, maxW = 1280, quality = 0.78) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxW / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      cv.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      cv.toBlob((blob) => resolve(blob || file), "image/jpeg", quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

// Upload danh sach File len bucket 'don-ban' theo ma don, tra ve [{url, path, name}]
export async function uploadAnhDon(supabase, code, files) {
  const out = [];
  for (let i = 0; i < files.length; i++) {
    const blob = await nenAnh(files[i]);
    const path = `${code}/${Date.now()}_${i}.jpg`;
    const { error } = await supabase.storage.from("don-ban").upload(path, blob, { contentType: "image/jpeg", upsert: true });
    if (error) throw error;
    const { data } = supabase.storage.from("don-ban").getPublicUrl(path);
    out.push({ url: data.publicUrl, path, name: files[i].name });
  }
  return out;
}
