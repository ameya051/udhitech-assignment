"use client";

// Shows one AI-generated SVG as a thumbnail, with a large view in a modal dialog. Used by DiagramRow.
// The SVG goes in an <img> data URL, never into the page DOM: browsers don't run scripts
// inside an <img> SVG, but they still play its SMIL and CSS animations.

import { useRef, type MouseEvent, type ReactNode } from "react";

interface SvgPreviewProps {
  svg: string | null;
  conceptName: string;
  children?: ReactNode; // extra links shown on the same line as "Expand" (e.g. View source)
}

export default function SvgPreview({ svg, conceptName, children }: SvgPreviewProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // max-w-none: Tailwind's base styles cap images at 100% width, which let the table squash
  // the thumbnail to a sliver. The diagram is what's being reviewed, so it keeps its full size.
  if (svg === null) {
    return (
      <div className="flex h-[200px] w-[320px] max-w-none shrink-0 items-center justify-center border border-gray-200 bg-gray-100 text-gray-500">
        No diagram
      </div>
    );
  }

  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const openDialog = () => dialogRef.current?.showModal();
  const closeDialog = () => dialogRef.current?.close();

  // The dialog has no padding, so a click whose target is the dialog itself landed on the backdrop.
  function handleDialogClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) closeDialog();
  }

  return (
    <>
      <button type="button" className="block cursor-zoom-in" aria-label={`Expand diagram: ${conceptName}`} onClick={openDialog}>
        {/* next/image can't optimise a data URL and would add nothing here, so a plain <img> is the right tool. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="h-[200px] w-[320px] max-w-none border border-gray-200 bg-white"
          src={dataUrl}
          alt={`Diagram: ${conceptName}`}
          width={320}
          height={200}
        />
      </button>
      <div className="mt-1 flex items-start gap-3 text-xs">
        <button type="button" className="text-blue-600 hover:underline" onClick={openDialog}>
          Expand
        </button>
        {children}
      </div>

      {/* Native modal: Esc closes it and focus stays inside. m-auto centres it, since Tailwind resets margins. */}
      <dialog ref={dialogRef} className="m-auto rounded p-0 backdrop:bg-black/60" onClick={handleDialogClick}>
        <div className="flex flex-col gap-2 p-4">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-semibold">{conceptName}</h2>
            <button type="button" className="rounded border border-gray-300 px-3 py-1 text-sm" onClick={closeDialog}>
              Close
            </button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="h-auto max-h-[80vh] w-[min(90vw,1000px)] bg-white" src={dataUrl} alt={`Diagram: ${conceptName}, large view`} />
        </div>
      </dialog>
    </>
  );
}
