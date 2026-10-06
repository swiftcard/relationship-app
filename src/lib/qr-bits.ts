import QRCode from "qrcode";

/**
 * A QR code as its bare module grid: one bit per module, row by row, most
 * significant bit first, base64. A few hundred bytes for even a dense Contact
 * QR, which is how the owner's codes are kept on the device for the no-signal
 * screen (public/offline.html draws them back with MiniQR's look). Level M,
 * like MiniQR, so it is the very same code.
 */
export function qrBits(text: string): { count: number; bits: string } {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const cells = qr.modules.data;
  const bytes = new Uint8Array(Math.ceil((n * n) / 8));
  for (let i = 0; i < n * n; i++) if (cells[i]) bytes[i >> 3] |= 0x80 >> (i & 7);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return { count: n, bits: btoa(bin) };
}
