import type { Meta, StoryObj } from "@storybook/react-vite";

/**
 * The accent, text and status palettes. Accents drive the neon gradients and
 * focus rings; the ink scale (`--text-*` / `--ui-ink-*`) covers every text
 * weight; the status trio backs success / warning / error UI. Flip the
 * **Theme** toolbar to see the dark-mode values.
 */
const meta: Meta = {
  title: "Foundations/Colors",
  parameters: { layout: "fullscreen", a11y: { test: "off" } },
};

export default meta;
type Story = StoryObj;

function ColorSwatch({ name }: { name: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-ui">
      <div className="h-14 w-full" style={{ background: `var(${name})` }} />
      <div className="bg-[color:var(--ui-bg-card)] px-3 py-2">
        <code className="text-ui-2xs text-[color:var(--ui-ink-strong)]">{name}</code>
      </div>
    </div>
  );
}

function InkRow({ name }: { name: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg bg-[color:var(--ui-bg-card)] px-3 py-2">
      <span className="text-ui-md" style={{ color: `var(${name})` }}>
        The quick brown fox
      </span>
      <code className="text-ui-2xs text-[color:var(--ui-ink-subtle)]">{name}</code>
    </div>
  );
}

const ACCENTS = ["--accent-cyan", "--accent-pink", "--accent-lime", "--accent-warn"];

const INKS = [
  "--text-0",
  "--text-1",
  "--text-2",
  "--ui-ink-strong",
  "--ui-ink-title",
  "--ui-ink",
  "--ui-ink-secondary",
  "--ui-ink-muted",
  "--ui-ink-subtle",
  "--ui-ink-faint",
  "--ui-ink-link",
];

function StatusCard({ bg, edge, ink, label }: { bg: string; edge: string; ink: string; label: string }) {
  return (
    <div
      className="rounded-xl border px-3 py-3 text-ui-sm"
      style={{ background: `var(${bg})`, borderColor: `var(${edge})`, color: `var(${ink})` }}
    >
      <p className="font-semibold">{label}</p>
      <p className="mt-1 text-ui-2xs opacity-80">
        {bg} · {edge} · {ink}
      </p>
    </div>
  );
}

export const Accents: Story = {
  render: () => (
    <div className="p-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {ACCENTS.map((name) => (
          <ColorSwatch key={name} name={name} />
        ))}
      </div>
    </div>
  ),
};

export const TextInk: Story = {
  name: "Text / ink scale",
  render: () => (
    <div className="max-w-xl space-y-2 p-6">
      {INKS.map((name) => (
        <InkRow key={name} name={name} />
      ))}
    </div>
  ),
};

export const Status: Story = {
  render: () => (
    <div className="grid max-w-2xl grid-cols-1 gap-3 p-6 sm:grid-cols-3">
      <StatusCard
        label="Success"
        bg="--ui-bg-prompt-positive"
        edge="--status-success-border"
        ink="--status-success-text"
      />
      <StatusCard
        label="Warning"
        bg="--ui-bg-prompt-note"
        edge="--status-warn-border"
        ink="--status-warn-text"
      />
      <StatusCard
        label="Error"
        bg="--ui-bg-prompt-negative"
        edge="--status-error-border"
        ink="--status-error-text"
      />
    </div>
  ),
};
