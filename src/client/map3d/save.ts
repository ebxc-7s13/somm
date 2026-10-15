/**
 * Saving the poster. Browsers download the PNG; phones with the Web Share API
 * can share it; the Android app writes it to the app cache and opens the system
 * share sheet (Save to device, Photos, Drive, messaging…).
 */
import { isNativeApp } from '../install';

export type SaveResult = 'downloaded' | 'shared' | 'cancelled';

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the image.'))), 'image/png'));
}

export function canShareFiles(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function' || typeof File === 'undefined') return false;
  try {
    return navigator.canShare({ files: [new File([new Uint8Array([137, 80, 78, 71])], 'probe.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
}

async function saveNative(canvas: HTMLCanvasElement, fileName: string): Promise<SaveResult> {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
  const data = canvas.toDataURL('image/png').split(',')[1] ?? '';
  const written = await Filesystem.writeFile({ path: fileName, data, directory: Directory.Cache });
  try {
    await Share.share({ title: 'My Sound of My Mind map', dialogTitle: 'Save or share your map', files: [written.uri] });
    return 'shared';
  } catch (err) {
    if (err instanceof Error && /cancel/i.test(err.message)) return 'cancelled';
    throw err;
  }
}

/** Saves or shares the poster. `share` asks for the share sheet where the browser supports it. */
export async function savePoster(canvas: HTMLCanvasElement, fileName: string, share = false): Promise<SaveResult> {
  if (isNativeApp()) return saveNative(canvas, fileName);
  const blob = await canvasBlob(canvas);
  if (share && canShareFiles()) {
    try {
      await navigator.share({ files: [new File([blob], fileName, { type: 'image/png' })], title: 'My Sound of My Mind map' });
      return 'shared';
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return 'cancelled';
      throw err;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'downloaded';
}
