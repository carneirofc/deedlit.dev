export function HomeImageDisplay() {
  return (
    <section id="top" className="section-anchor mx-auto max-w-7xl px-4 pb-16 pt-14 sm:px-6 lg:px-8">
      <div className="mb-6 max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">A small personal space</h1>
        <p className="mt-3 text-sm text-muted">
          This is a personal website where I share things I find interesting.
          Here you'll find a collection of images I've generated, books I've read, and services I use.
        </p>
        <p className="mt-2 text-sm text-muted">
          This is where I keep track of my hobbies and creative projects. No pretense, just things I enjoy.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <a href="#gallery" className="chip focus-ring">
          Gallery
        </a>
        <a href="#books" className="chip focus-ring">
          Books
        </a>
        <a href="#services" className="chip focus-ring">
          Services
        </a>
      </div>
    </section>
  );
}
