/**
 * Load the game-data-only bundle from this deployment. The returned File has
 * the same folder structure as the game IPA so the established local importer
 * can decode it and save it for offline play. No executable is included.
 */
export async function fetchBundledGame(): Promise<File> {
  const url = new URL('game/harbor-hd-assets.zip', document.baseURI);
  let response: Response;
  try {
    response = await fetch(url, { credentials: 'same-origin' });
  } catch (cause) {
    throw new Error('The game files could not be downloaded. Please check your connection and try again.', { cause });
  }
  if (!response.ok) throw new Error('The game files could not be downloaded. Please try again.');
  const blob = await response.blob();
  if (blob.size < 22 || blob.size > 30 * 1024 * 1024) throw new Error('The game files are incomplete or invalid.');
  const header = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  // ZIP local-file header. Also rejects successful HTML sign-in/error pages.
  if (header[0] !== 0x50 || header[1] !== 0x4b || header[2] !== 0x03 || header[3] !== 0x04) {
    throw new Error('The game files are incomplete or invalid.');
  }
  return new File([blob], 'harbor-hd-assets.zip', { type: 'application/zip' });
}
