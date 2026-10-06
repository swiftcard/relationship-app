// "Download QR (PNG)": the same tile Show QR draws — MiniQR's rounded code in
// the card's own colours (use-card-qr-style) on a rounded tile — at 1024px for
// print. The source is a rendered MiniQR <svg>, rasterised on a canvas.

export const QR_PNG_PX = 1024;

export async function renderQrPng(svg: SVGSVGElement, bg: string): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = QR_PNG_PX;
  canvas.height = QR_PNG_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  // The tile: background colour, rounded corners, then the code inside
  // the same padding MiniQR uses (5.5%).
  const radius = QR_PNG_PX * 0.1;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(0, 0, QR_PNG_PX, QR_PNG_PX, radius);
  ctx.fill();
  const pad = QR_PNG_PX * 0.055;
  const inner = QR_PNG_PX - pad * 2;
  const xml = new XMLSerializer().serializeToString(svg);
  const objectUrl = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
  try {
    await new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.onload = () => { ctx.drawImage(img, pad, pad, inner, inner); resolve(); };
      img.onerror = () => reject(new Error("svg"));
      img.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/png"),
  );
}
