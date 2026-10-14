# Sinh icon ProfileVault từ assets/logo-source.png (logo đen trên nền trắng).
# Nền trắng nối với mép ảnh → trong suốt; phần trắng bên trong logo giữ nguyên.
# Kết quả:
#   assets/profilevault.ico            (16–256 px, cho lối tắt và cửa sổ khởi động)
#   assets/profilevault.png            (256 px, cho toast Windows)
#   apps/dashboard/public/favicon.png  (64 px)
#   apps/service/src/tray-logo.ts      (32×32 alpha + độ đậm, tô màu trạng thái lúc chạy)
# Chạy lại sau khi đổi logo: powershell -NoProfile -File tools/make-icons.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

public static class PvIcons {
  // Ảnh vuông RGBA: nền trắng nối mép → trong suốt, cắt sát logo, chừa lề 4%.
  public static Bitmap Prepare(string path) {
    using (var src = new Bitmap(path)) {
      int w = src.Width, h = src.Height;
      var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
      using (var g = Graphics.FromImage(bmp)) g.DrawImage(src, 0, 0, w, h);
      var bg = new bool[w, h];
      var q = new Queue<Point>();
      Func<int, int, bool> light = (x, y) => { var c = bmp.GetPixel(x, y); return c.R > 200 && c.G > 200 && c.B > 200; };
      for (int x = 0; x < w; x++) { q.Enqueue(new Point(x, 0)); q.Enqueue(new Point(x, h - 1)); }
      for (int y = 0; y < h; y++) { q.Enqueue(new Point(0, y)); q.Enqueue(new Point(w - 1, y)); }
      while (q.Count > 0) {
        var p = q.Dequeue();
        if (p.X < 0 || p.Y < 0 || p.X >= w || p.Y >= h || bg[p.X, p.Y] || !light(p.X, p.Y)) continue;
        bg[p.X, p.Y] = true;
        q.Enqueue(new Point(p.X + 1, p.Y)); q.Enqueue(new Point(p.X - 1, p.Y));
        q.Enqueue(new Point(p.X, p.Y + 1)); q.Enqueue(new Point(p.X, p.Y - 1));
      }
      int minX = w, minY = h, maxX = 0, maxY = 0;
      for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
        if (bg[x, y]) { bmp.SetPixel(x, y, Color.Transparent); continue; }
        minX = Math.Min(minX, x); minY = Math.Min(minY, y); maxX = Math.Max(maxX, x); maxY = Math.Max(maxY, y);
      }
      int cw = maxX - minX + 1, ch = maxY - minY + 1;
      int side = (int)Math.Ceiling(Math.Max(cw, ch) * 1.08);
      var sq = new Bitmap(side, side, PixelFormat.Format32bppArgb);
      using (var g = Graphics.FromImage(sq)) {
        g.Clear(Color.Transparent);
        g.DrawImage(bmp, new Rectangle((side - cw) / 2, (side - ch) / 2, cw, ch), new Rectangle(minX, minY, cw, ch), GraphicsUnit.Pixel);
      }
      bmp.Dispose();
      return sq;
    }
  }

  public static Bitmap Resize(Bitmap src, int size) {
    var b = new Bitmap(size, size, PixelFormat.Format32bppArgb);
    using (var g = Graphics.FromImage(b)) {
      g.Clear(Color.Transparent);
      g.InterpolationMode = InterpolationMode.HighQualityBicubic;
      g.PixelOffsetMode = PixelOffsetMode.HighQuality;
      g.CompositingQuality = CompositingQuality.HighQuality;
      g.DrawImage(src, 0, 0, size, size);
    }
    return b;
  }

  public static byte[] Png(Bitmap b) {
    using (var ms = new MemoryStream()) { b.Save(ms, ImageFormat.Png); return ms.ToArray(); }
  }

  // ICO với các ảnh PNG nhúng (Windows Vista trở lên).
  public static void WriteIco(Bitmap src, int[] sizes, string path) {
    var pngs = new List<byte[]>();
    foreach (var s in sizes) using (var r = Resize(src, s)) pngs.Add(Png(r));
    using (var fs = new FileStream(path, FileMode.Create))
    using (var bw = new BinaryWriter(fs)) {
      bw.Write((ushort)0); bw.Write((ushort)1); bw.Write((ushort)sizes.Length);
      int offset = 6 + 16 * sizes.Length;
      for (int i = 0; i < sizes.Length; i++) {
        bw.Write((byte)(sizes[i] >= 256 ? 0 : sizes[i])); bw.Write((byte)(sizes[i] >= 256 ? 0 : sizes[i]));
        bw.Write((byte)0); bw.Write((byte)0); bw.Write((ushort)1); bw.Write((ushort)32);
        bw.Write(pngs[i].Length); bw.Write(offset); offset += pngs[i].Length;
      }
      foreach (var p in pngs) bw.Write(p);
    }
  }

  // 2 byte/pixel, hàng từ trên xuống: alpha, độ đậm (255 = đen của logo, 0 = trắng).
  public static string TrayMask(Bitmap src, int size) {
    using (var r = Resize(src, size)) {
      var data = new byte[size * size * 2];
      for (int y = 0; y < size; y++) for (int x = 0; x < size; x++) {
        var c = r.GetPixel(x, y);
        int lum = (c.R * 299 + c.G * 587 + c.B * 114) / 1000;
        data[(y * size + x) * 2] = c.A;
        data[(y * size + x) * 2 + 1] = (byte)(255 - lum);
      }
      return Convert.ToBase64String(data);
    }
  }
}
'@

$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$logo = [PvIcons]::Prepare((Join-Path $root 'assets\logo-source.png'))
try {
  [PvIcons]::WriteIco($logo, @(16, 20, 24, 32, 40, 48, 64, 128, 256), (Join-Path $root 'assets\profilevault.ico'))
  $big = [PvIcons]::Resize($logo, 256)
  $big.Save((Join-Path $root 'assets\profilevault.png'), [System.Drawing.Imaging.ImageFormat]::Png)
  $big.Dispose()
  $public = Join-Path $root 'apps\dashboard\public'
  New-Item -ItemType Directory -Force -Path $public | Out-Null
  $fav = [PvIcons]::Resize($logo, 64)
  $fav.Save((Join-Path $public 'favicon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
  $fav.Dispose()
  $mask = [PvIcons]::TrayMask($logo, 32)
  $ts = @"
// Sinh bởi tools/make-icons.ps1 từ assets/logo-source.png — không sửa tay.
/** Logo 32×32: 2 byte/pixel (alpha, độ đậm), hàng từ trên xuống. */
export const TRAY_LOGO_SIZE = 32;
export const TRAY_LOGO_MASK = '$mask';
"@
  [System.IO.File]::WriteAllText((Join-Path $root 'apps\service\src\tray-logo.ts'), $ts + "`n", (New-Object System.Text.UTF8Encoding($false)))
  'Đã sinh assets/profilevault.ico, assets/profilevault.png,apps/dashboard/public/favicon.png, apps/service/src/tray-logo.ts'
} finally {
  $logo.Dispose()
}
