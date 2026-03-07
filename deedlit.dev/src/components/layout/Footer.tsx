export function Footer() {
  return (
    <footer
      id="contact"
      className="section-anchor mx-auto mt-6 max-w-7xl border-t border-line/80 px-4 py-8 sm:px-6 lg:px-8"
    >
      <div className="flex flex-col gap-4 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
        <p>deedlit.dev</p>
        <div className="flex flex-wrap items-center gap-4">
          <a href="#top" className="focus-ring rounded-md hover:text-text">
            Home
          </a>
          <a href="#gallery" className="focus-ring rounded-md hover:text-text">
            Gallery
          </a>
          <a href="#books" className="focus-ring rounded-md hover:text-text">
            Books
          </a>
          <a href="#services" className="focus-ring rounded-md hover:text-text">
            Services
          </a>
          <a
            href="https://github.com/yourname/deedlit.dev"
            className="focus-ring rounded-md hover:text-text"
          >
            GitHub
          </a>
          <a href="mailto:hello@deedlit.dev" className="focus-ring rounded-md hover:text-text">
            hello@deedlit.dev
          </a>
          <p>© {new Date().getFullYear()} deedlit.dev</p>
        </div>
      </div>
    </footer>
  );
}

