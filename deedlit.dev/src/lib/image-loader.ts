/**
 * Custom image loader for Next.js Image component
 * Handles our custom /image route with query parameters
 */
export default function imageLoader({ src }: { src: string; width?: number; quality?: number }) {
  // If src already has the /image route, return as is
  if (src.startsWith('/image?id=')) {
    return src;
  }
  
  // Otherwise assume it's a direct path
  return src;
}
