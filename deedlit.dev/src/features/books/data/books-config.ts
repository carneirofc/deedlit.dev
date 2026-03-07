/**
 * Books Configuration
 * 
 * Add Goodreads URLs here to fetch book metadata automatically.
 * Run `npm run scrape-goodreads` after adding new URLs to update metadata.
 * 
 * The scraper will fetch: title, author, rating, genres, tags, cover, etc.
 */

export const bookUrls = [
  "https://www.goodreads.com/book/show/400906.The_White_Rose",
];

/**
 * Optional: Add manual overrides or additional metadata here
 * Use the book URL as the key
 */
export const bookOverrides: Record<string, Partial<{
  year: number;
  note: string;
  tags: string[];
}>> = {
  "https://www.goodreads.com/book/show/400906.The_White_Rose": {
    year: 1985,
    note: "Third book in The Black Company series. Published April 15, 1985 by Tor Fantasy. A dark military fantasy masterpiece.",
    tags: ["owned", "physical-copy"]
  },
};
