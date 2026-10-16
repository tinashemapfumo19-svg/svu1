export async function populatedPreviewFiles(browser) {
  const page = await browser.newPage({viewport:{width:600,height:400}});
  try {
    await page.setContent('<!doctype html><style>body{margin:0;background:white;font:24px Arial;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact}h1{font-size:24px;margin:24px}.marker{margin:24px;width:200px;height:180px;background:#169b45}p{margin:24px;font-size:16px}</style><h1>SAMPLE POPULATED PREVIEW</h1><div class="marker"></div><p>Synthetic document. No university records.</p>');
    return {pdf:await page.pdf({width:'600px',height:'400px',printBackground:true}),png:await page.screenshot()};
  } finally { await page.close(); }
}

export async function previewGreenPixels(page,screenshot) {
  return page.evaluate(async source => {
    const image = new Image(); image.src = source; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width=image.width; canvas.height=image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image,0,0);
    const pixels = ctx.getImageData(0,0,canvas.width,canvas.height).data;
    let count=0;
    for(let i=0;i<pixels.length;i+=4)if(Math.abs(pixels[i]-22)<12 && Math.abs(pixels[i+1]-155)<12 && Math.abs(pixels[i+2]-69)<12)count++;
    return count;
  },`data:image/png;base64,${screenshot.toString('base64')}`);
}
