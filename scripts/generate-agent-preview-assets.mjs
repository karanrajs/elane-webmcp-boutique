import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { agentPreviewAssetPath, products, slotForProduct } from '../app/catalog.ts';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));
const outputRoot = fileURLToPath(new URL('../public/agent-preview-assets/', import.meta.url));

const accessoryInteriorSeeds = {
  73: [[0.5, 0.28], [0.5, 0.4]],
  74: [[0.5, 0.31]],
  75: [[0.48, 0.55]],
  77: [[0.5, 0.25], [0.5, 0.42]],
  78: [[0.5, 0.29], [0.5, 0.36]],
  79: [[0.47, 0.55]],
  81: [[0.5, 0.29], [0.5, 0.4]],
  82: [[0.5, 0.3]],
  83: [[0.48, 0.55]],
  85: [[0.5, 0.28], [0.5, 0.36]],
  86: [[0.47, 0.55]],
  88: [[0.5, 0.25], [0.5, 0.42]],
};

function publicFile(pathname) {
  return `${publicRoot}${pathname.replace(/^\//u, '')}`;
}

function removeConnectedBackground(data, width, height, interiorSeeds = [], background = 'checkerboard') {
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  const isBackground = (pixel) => {
    const offset = pixel * 4;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    const tone = (red + green + blue) / 3;
    const neutralChecker = maximum - minimum <= 5 && tone >= 215;
    const warmStudio = background === 'warm-cream'
      && red >= 215
      && green >= 200
      && blue >= 185
      && red >= green
      && green >= blue
      && red - blue <= 45;
    return neutralChecker || warmStudio;
  };
  const enqueue = (pixel) => {
    if (visited[pixel] || !isBackground(pixel)) return;
    visited[pixel] = 1;
    queue[tail] = pixel;
    tail += 1;
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }
  interiorSeeds.forEach(([xRatio, yRatio]) => {
    const x = Math.round((width - 1) * xRatio);
    const y = Math.round((height - 1) * yRatio);
    enqueue(y * width + x);
  });

  while (head < tail) {
    const pixel = queue[head];
    head += 1;
    data[pixel * 4 + 3] = 0;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (x > 0) enqueue(pixel - 1);
    if (x + 1 < width) enqueue(pixel + 1);
    if (y > 0) enqueue(pixel - width);
    if (y + 1 < height) enqueue(pixel + width);
  }
}

function keepLargestForegroundShape(data, width, height) {
  const labels = new Int32Array(width * height);
  const queue = new Int32Array(width * height);
  let nextLabel = 0;
  let largestLabel = 0;
  let largestSize = 0;

  for (let start = 0; start < width * height; start += 1) {
    if (labels[start] || data[start * 4 + 3] === 0) continue;
    nextLabel += 1;
    let head = 0;
    let tail = 1;
    let size = 0;
    labels[start] = nextLabel;
    queue[0] = start;

    const enqueue = (pixel) => {
      if (pixel < 0 || labels[pixel] || data[pixel * 4 + 3] === 0) return;
      labels[pixel] = nextLabel;
      queue[tail] = pixel;
      tail += 1;
    };

    while (head < tail) {
      const pixel = queue[head];
      head += 1;
      size += 1;
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      if (x > 0) enqueue(pixel - 1);
      if (x + 1 < width) enqueue(pixel + 1);
      if (y > 0) enqueue(pixel - width);
      if (y + 1 < height) enqueue(pixel + width);
    }

    if (size > largestSize) {
      largestSize = size;
      largestLabel = nextLabel;
    }
  }

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    if (data[pixel * 4 + 3] > 0 && labels[pixel] !== largestLabel) {
      data[pixel * 4 + 3] = 0;
    }
  }
}

async function exportProductAsset(product) {
  const target = `${publicRoot}${agentPreviewAssetPath(product.id).slice(1)}`;
  const layer = product.garmentBoardAsset;
  if (!layer.sprite) {
    await sharp(publicFile(layer.image)).png({ compressionLevel: 9 }).toFile(target);
    return;
  }

  const source = sharp(publicFile(layer.image));
  const metadata = await source.metadata();
  if (!metadata.width || !metadata.height || metadata.width % 4 || metadata.height % 2) {
    throw new Error(`Sprite sheet ${layer.image} must contain a 4 by 2 grid.`);
  }
  const width = metadata.width / 4;
  const height = metadata.height / 2;
  const { data, info } = await source
    .extract({
      left: layer.sprite.column * width,
      top: layer.sprite.row * height,
      width,
      height,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  removeConnectedBackground(
    data,
    info.width,
    info.height,
    accessoryInteriorSeeds[product.id],
    layer.sprite.background,
  );
  if (slotForProduct(product) !== 'Accessory') {
    keepLargestForegroundShape(data, info.width, info.height);
  }
  await sharp(data, { raw: info }).png({ compressionLevel: 9 }).toFile(target);
}

await mkdir(outputRoot, { recursive: true });
for (const product of products) await exportProductAsset(product);

console.log(`Exported ${products.length} agent-preview assets in ${outputRoot.replace(`${projectRoot}/`, '')}.`);
