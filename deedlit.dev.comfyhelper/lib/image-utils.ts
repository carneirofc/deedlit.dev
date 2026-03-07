const NEXT_IMAGE_PREFETCH_QUALITY = 75;

export function toGalleryImageSrc(imagePath: string): string {
  return `/api/image?path=${encodeURIComponent(imagePath)}`;
}

export function toNextImagePrefetchSrc(imagePath: string, width: number, quality?: number): string {
  const imageSrc = toGalleryImageSrc(imagePath);
  if (quality !== undefined && (quality < 1 || quality > 100)) {
    console.warn(`Invalid quality value ${quality} provided to toNextImagePrefetchSrc. Quality should be between 1 and 100. Falling back to default quality of ${NEXT_IMAGE_PREFETCH_QUALITY}.`);
    quality = NEXT_IMAGE_PREFETCH_QUALITY;
  }
  const q = quality ?? NEXT_IMAGE_PREFETCH_QUALITY;
  return `/_next/image?url=${encodeURIComponent(imageSrc)}&w=${width}&q=${q}`;
}