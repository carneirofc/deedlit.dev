import { NextResponse } from "next/server";
import { getGalleryData } from "@/features/gallery/server/gallery-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const isDev = process.env.NODE_ENV === 'development';
const log = (...args: any[]) => isDev && console.log('[GALLERY_API]', ...args);

// Security headers for API responses
const API_SECURITY_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, private",
  "X-Content-Type-Options": "nosniff",
  "Content-Type": "application/json; charset=utf-8",
};

export async function GET(request: Request) {
  log('[DEBUG] Gallery API request received');
  const startTime = performance.now();
  
  try {
    // Validate request method
    if (request.method !== 'GET') {
      return NextResponse.json(
        { error: 'Method not allowed' },
        { status: 405, headers: API_SECURITY_HEADERS }
      );
    }

    const data = await getGalleryData();
    const endTime = performance.now();
    const duration = (endTime - startTime).toFixed(2);
    
    log(`[SUCCESS] Gallery data loaded in ${duration}ms:`, {
      assets: data.assets.length,
      tags: data.tags.length,
      stats: data.stats
    });
    
    return NextResponse.json(data, {
      headers: API_SECURITY_HEADERS
    });
  } catch (error) {
    log('[ERROR] Gallery API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: API_SECURITY_HEADERS }
    );
  }
}
