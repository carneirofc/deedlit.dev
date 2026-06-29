import {
  CyberPanel,
  CyberSubpanel,
  InfoChip,
  PageHeader,
  PanelSectionHeader,
  SectionLabel,
  StatusBadge,
  SurfacePanel
} from "@carneirofc/ui";
import { BooksSection } from "@/features/books/components/BooksSection";
import { books } from "@/features/books/data/books";
import { GallerySection } from "@/features/gallery/components/GallerySection";
import { getGalleryData } from "@/features/gallery/server/gallery-data";
import { LocalServicesSection } from "@/features/services/components/LocalServicesSection";
import { localServiceApps } from "@/features/services/data/local-services";
import { UiShowcaseSection } from "@/features/showcase/components/UiShowcaseSection";

export default async function HomePage() {
  const { assets } = await getGalleryData();

  return (
    <main className="mx-auto flex w-full max-w-[1700px] flex-col gap-6">
      <CyberPanel id="top" className="scroll-mt-20">
        <PageHeader
          subtitle="deedlit.dev // personal space"
          title="Personal Archive Hub"
          description="Browse local services, generated gallery assets, and a curated reading shelf in one unified interface."
          pills={
            <div className="flex flex-wrap items-center gap-2">
              <InfoChip>{localServiceApps.length} services</InfoChip>
              <InfoChip>{assets.length} gallery assets</InfoChip>
              <InfoChip>{books.length} books</InfoChip>
            </div>
          }
        />
      </CyberPanel>

      <SurfacePanel id="services" tone="soft" padding="none" className="scroll-mt-20 overflow-hidden">
        <LocalServicesSection apps={localServiceApps} />
      </SurfacePanel>

      <SurfacePanel id="gallery" tone="soft" padding="none" className="scroll-mt-20 overflow-hidden">
        <GallerySection assets={assets} />
      </SurfacePanel>

      <SurfacePanel id="books" tone="soft" padding="none" className="scroll-mt-20 overflow-hidden">
        <BooksSection items={books} />
      </SurfacePanel>

      <SurfacePanel id="ui" tone="soft" padding="none" className="scroll-mt-20 overflow-hidden">
        <UiShowcaseSection />
      </SurfacePanel>

      <SurfacePanel id="contact" tone="subtle" className="mb-4 scroll-mt-20">
        <SectionLabel>Contact</SectionLabel>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-ui-xs text-[color:var(--ui-ink-subtle)]">
          <InfoChip>deedlit.dev</InfoChip>
          <InfoChip>
            <a href="#top" className="focus-ring rounded">
              Back to top
            </a>
          </InfoChip>
          <InfoChip>
            <a href="mailto:hello@deedlit.dev" className="focus-ring rounded">
              hello@deedlit.dev
            </a>
          </InfoChip>
          <span className="ml-auto text-ui-xs">© {new Date().getFullYear()} deedlit.dev</span>
        </div>
      </SurfacePanel>
    </main>
  );
}

