import dynamic from "next/dynamic";

const MolstarCanvas = dynamic(() => import("./MolstarCanvas"), {
  ssr: false,
  loading: () => (
    <div
      className="rounded-md border border-gray-200 bg-gray-50 text-gray-600 text-sm flex items-center justify-center"
      style={{ minHeight: 420 }}
    >
      Initializing structure viewer…
    </div>
  )
});

/**
 * Mol* viewer wrapper (no SSR). Pass structureUrl or rely on parent fallback UI when absent.
 */
export default function MolViewer(props) {
  const { structureUrl } = props;
  if (!structureUrl) {
    return (
      <div
        className="rounded-md border border-gray-200 bg-gray-50 text-gray-600 text-sm px-3 py-8 text-center"
        style={{ minHeight: props.height ?? 420 }}
      >
        No structure file is available for this model (upload results and pick a pair with an
        mmCIF path).
      </div>
    );
  }
  return <MolstarCanvas {...props} />;
}
