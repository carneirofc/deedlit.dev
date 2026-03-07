export interface ImageAsset {
  id: string;
  title: string;
  src: string;
  referenceHref: string;
  createdAt: string;
}

export interface GalleryStats {
  totalAssets: number;
  pngCount: number;
  comfyMetadataCount: number;
}

export interface GalleryData {
  assets: ImageAsset[];
  tags: string[];
  stats: GalleryStats;
}
