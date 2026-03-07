"use client";

import { useRef, useEffect, useCallback, memo } from "react";
import type { ToolConstructable, ToolSettings } from "@editorjs/editorjs";

type OutputData = {
  time?: number;
  blocks: Array<{ id?: string; type: string; data: Record<string, unknown> }>;
  version?: string;
};

type EditorJsFieldProps = {
  id: string;
  initialData: OutputData;
  onChange: (data: OutputData) => void;
  placeholder?: string;
  readOnly?: boolean;
  toolset?: "prompt" | "full";
  minHeight?: number;
};

function EditorJsFieldInner({
  id,
  initialData,
  onChange,
  placeholder = "Start typing...",
  readOnly = false,
  toolset = "prompt",
  minHeight = 80,
}: EditorJsFieldProps) {
  const holderRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<unknown>(null);
  const onChangeRef = useRef(onChange);
  const isDestroyingRef = useRef(false);
  onChangeRef.current = onChange;

  const initEditor = useCallback(async () => {
    if (editorRef.current || isDestroyingRef.current) return;
    if (!holderRef.current) return;

    const { default: EditorJS } = await import("@editorjs/editorjs");
    const { default: Paragraph } = await import("@editorjs/paragraph");

    const tools: Record<string, ToolConstructable | ToolSettings> = {
      paragraph: { class: Paragraph as unknown as ToolConstructable, inlineToolbar: true },
    };

    if (toolset === "full") {
      const [{ default: Header }, { default: List }, { default: Code }] = await Promise.all([
        import("@editorjs/header"),
        import("@editorjs/list"),
        import("@editorjs/code"),
      ]);
      tools.header = { class: Header as unknown as ToolConstructable, config: { levels: [2, 3], defaultLevel: 2 } };
      tools.list = { class: List as unknown as ToolConstructable, inlineToolbar: true };
      tools.code = { class: Code as unknown as ToolConstructable };
    }

    if (isDestroyingRef.current) return;

    const editor = new EditorJS({
      holder: `editorjs-${id}`,
      data: initialData,
      placeholder,
      readOnly,
      tools,
      onChange: async () => {
        try {
          const data = await (editor as unknown as { save: () => Promise<OutputData> }).save();
          onChangeRef.current(data);
        } catch {
          // Editor may be destroyed during save
        }
      },
      minHeight,
    });

    await (editor as unknown as { isReady: Promise<void> }).isReady;
    editorRef.current = editor;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    void initEditor();

    return () => {
      isDestroyingRef.current = true;
      const editor = editorRef.current;
      if (editor) {
        try {
          (editor as unknown as { destroy: () => void }).destroy();
        } catch {
          // Ignore destroy errors
        }
        editorRef.current = null;
      }
      // Reset for next mount
      setTimeout(() => {
        isDestroyingRef.current = false;
      }, 0);
    };
  }, [initEditor]);

  // Handle readOnly changes dynamically
  useEffect(() => {
    const editor = editorRef.current as unknown as { readOnly?: { toggle: (state?: boolean) => void } } | null;
    if (!editor?.readOnly?.toggle) return;

    try {
      editor.readOnly.toggle(readOnly);
    } catch {
      // Ignore toggle errors
    }
  }, [readOnly]);

  return (
    <div
      ref={holderRef}
      id={`editorjs-${id}`}
      data-testid={`editorjs-${id}`}
      className="editorjs-container rounded-lg border border-ui-border bg-ui-bg p-2"
      style={{ minHeight }}
    />
  );
}

export default memo(EditorJsFieldInner);
