import "server-only";

import type { GalleryData, ImageAsset } from "@/features/gallery/types";
import { getIndexedImages } from "@/features/gallery/server/image-index";

const isDev = process.env.NODE_ENV === 'development';
const log = (...args: any[]) => isDev && console.log('[GALLERY_DATA]', ...args);

export async function getGalleryData(): Promise<GalleryData> {
  log('[INFO] Loading gallery data...');
  const startTime = performance.now();
  
  try {
    const indexed = await getIndexedImages();
    log(`Found ${indexed.length} indexed images`);
    
    const assets: ImageAsset[] = indexed.map((image, index) => ({
      id: image.id,
      title: `Image ${String(index + 1).padStart(3, "0")}`,
      src: `/image?id=${encodeURIComponent(image.id)}`,
      referenceHref: `/?image=${encodeURIComponent(image.id)}#gallery`,
      createdAt: image.createdAt
    }));

    const pngCount = indexed.filter((asset) => asset.filename.toLowerCase().endsWith(".png")).length;
    const endTime = performance.now();
    const duration = (endTime - startTime).toFixed(2);
    
    const result = {
      assets,
      tags: [],
      stats: {
        totalAssets: assets.length,
        pngCount,
        comfyMetadataCount: 0
      }
    };
    
    log(`[SUCCESS] Gallery data loaded in ${duration}ms:`, result.stats);
    return result;
  } catch (error) {
    log('[ERROR] Error loading gallery data:', error);
    return {
      assets: [],
      tags: [],
      stats: {
        totalAssets: 0,
        pngCount: 0,
        comfyMetadataCount: 0
      }
    };
  }
}
