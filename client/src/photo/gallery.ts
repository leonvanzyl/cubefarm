// The shots and clips taken in this tab: held in memory as blobs (about 200 MB at most, the oldest dropped first) and
// never sent anywhere. Photo mode's panel lists them; instant replays land here too.
import { create } from 'zustand';
import { repoOnFloor, useStore } from '../store';
import { download } from './media';
import { GALLERY_BYTES, overBudget } from './shots';

export interface GalleryItem {
  id: number;
  kind: 'shot' | 'clip' | 'replay';
  name: string;
  /** Object URL of the file itself. */
  url: string;
  /** Object URL of a small picture for the list (shots); clips show their own first frame. */
  thumb: string | null;
  type: string;
  bytes: number;
  width: number;
  height: number;
  /** Clips: roughly how long. */
  seconds: number | null;
  at: number;
}

export const useGallery = create<{ items: GalleryItem[] }>(() => ({ items: [] }));

let seq = 1;

function release(i: GalleryItem) {
  URL.revokeObjectURL(i.url);
  if (i.thumb) URL.revokeObjectURL(i.thumb);
}

/** Keeps a file (newest last), dropping the oldest when the gallery is over its budget. */
export function addToGallery(blob: Blob, meta: Omit<GalleryItem, 'id' | 'url' | 'thumb' | 'type' | 'bytes' | 'at'>, thumb: Blob | null = null): GalleryItem {
  const item: GalleryItem = { ...meta, id: seq++, url: URL.createObjectURL(blob), thumb: thumb ? URL.createObjectURL(thumb) : null, type: blob.type, bytes: blob.size, at: Date.now() };
  const items = [...useGallery.getState().items, item];
  const drop = new Set(overBudget(items, GALLERY_BYTES));
  for (const i of items) if (drop.has(i.id)) release(i);
  useGallery.setState({ items: items.filter((i) => !drop.has(i.id)) });
  return item;
}

export function removeFromGallery(id: number) {
  const items = useGallery.getState().items;
  const gone = items.find((i) => i.id === id);
  if (gone) release(gone);
  useGallery.setState({ items: items.filter((i) => i.id !== id) });
}

export const saveItem = (i: GalleryItem) => download(i.url, i.name);

/** Where you are, for file names and the caption: the floor's repo, or the company's lobby. */
export function here(): { label: string; floor: number } {
  const s = useStore.getState();
  const repo = s.floor === 0 ? null : repoOnFloor(s.repos, s.floor);
  return { label: repo?.fullName ?? (s.settings.companyName || 'cubefarm'), floor: repo ? repo.floor : 0 };
}
