export type PrerenderOptions = {
  canvas: HTMLCanvasElement;
  totalFrames: number;
  fps: number;
  locatorId: string;
  applyFrame: (t: number) => Promise<void>;
  onProgress?: (frame: number, total: number) => void;
  signal?: { cancelled: boolean };
  settleMs?: number;
};

type FSDirHandle = {
  getFileHandle: (name: string, opts?: { create?: boolean }) => Promise<FSFileHandle>;
};
type FSFileHandle = { createWritable: () => Promise<FSWritable> };
type FSWritable = { write: (data: Blob) => Promise<void>; close: () => Promise<void> };

async function writeBlob(dir: FSDirHandle, name: string, blob: Blob) {
  const h = await dir.getFileHandle(name, { create: true });
  const w = await h.createWritable();
  await w.write(blob);
  await w.close();
}

function pad(n: number, w: number): string {
  return n.toString().padStart(w, '0');
}

export async function prerender(opts: PrerenderOptions): Promise<void> {
  const showPicker = (window as unknown as {
    showDirectoryPicker?: (o?: { mode?: string }) => Promise<FSDirHandle>;
  }).showDirectoryPicker;

  if (!showPicker) {
    throw new Error(
      'File System Access API unavailable. Use Chrome, Edge, Arc, or Brave.',
    );
  }

  const dir = await showPicker({ mode: 'readwrite' });

  for (let i = 0; i < opts.totalFrames; i++) {
    if (opts.signal?.cancelled) throw new Error('cancelled');
    const t = opts.totalFrames <= 1 ? 0 : i / (opts.totalFrames - 1);

    await opts.applyFrame(t);
    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => requestAnimationFrame(r));
    if (opts.settleMs && opts.settleMs > 0) {
      await new Promise(r => setTimeout(r, opts.settleMs));
    }

    const blob = await new Promise<Blob>((resolve, reject) => {
      opts.canvas.toBlob(
        b => (b ? resolve(b) : reject(new Error('toBlob returned null'))),
        'image/png',
      );
    });

    await writeBlob(dir, `frame_${pad(i + 1, 6)}.png`, blob);
    opts.onProgress?.(i + 1, opts.totalFrames);
  }

  const ffmpegCmd =
    `ffmpeg -y -framerate ${opts.fps} -i frame_%06d.png ` +
    `-c:v libx264 -pix_fmt yuv420p -crf 16 -preset slow -movflags +faststart ` +
    `${opts.locatorId}.mp4`;

  const meta = {
    locator: opts.locatorId,
    fps: opts.fps,
    frames: opts.totalFrames,
    pattern: 'frame_%06d.png',
    ffmpeg: ffmpegCmd,
    renderedAt: new Date().toISOString(),
  };

  await writeBlob(
    dir,
    'render.json',
    new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' }),
  );

  const sh = `#!/usr/bin/env bash\nset -euo pipefail\n${ffmpegCmd}\necho "Wrote ${opts.locatorId}.mp4"\n`;
  await writeBlob(dir, 'encode.sh', new Blob([sh], { type: 'text/plain' }));
}
