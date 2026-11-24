// Shows one AI-generated SVG. Used by DiagramRow.
// The SVG goes in an <img> data URL, never into the page DOM: browsers don't run scripts
// inside an <img> SVG, but they still play its SMIL and CSS animations.

interface SvgPreviewProps {
  svg: string | null;
  conceptName: string;
}

export default function SvgPreview({ svg, conceptName }: SvgPreviewProps) {
  if (svg === null) {
    return (
      <div className="flex h-[200px] w-[320px] items-center justify-center border border-gray-200 bg-gray-100 text-gray-500">
        No diagram
      </div>
    );
  }

  return (
    // next/image can't optimise a data URL and would add nothing here, so a plain <img> is the right tool.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="h-[200px] w-[320px] border border-gray-200 bg-white"
      src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
      alt={`Diagram: ${conceptName}`}
      width={320}
      height={200}
    />
  );
}
