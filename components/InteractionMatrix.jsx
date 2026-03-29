import { Fragment } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
function InteractionMatrix({ baitProteins, preyProteins, results, onCellClick }) {
  if (baitProteins.length === 0 || preyProteins.length === 0) {
    return <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
        <p className="text-gray-500 text-lg mb-2">No proteins uploaded yet</p>
        <p className="text-gray-400 text-sm">Upload bait and prey proteins to generate the interaction matrix</p>
      </div>;
  }
  const getResultKey = (bait, prey) => `${bait}:${prey}`;
  const getResult = (bait, prey) => {
    return results.get(getResultKey(bait, prey)) || null;
  };
  const getCellColor = (result) => {
    if (!result || !result.hasResult) {
      return "bg-gray-50 text-gray-400 border border-dashed border-gray-300";
    }
    const score = result.score;
    if (score < 0.2) return "bg-gray-100 text-gray-600";
    if (score < 0.4) return "bg-blue-100 text-blue-700";
    if (score < 0.6) return "bg-blue-200 text-blue-800";
    if (score < 0.8) return "bg-blue-400 text-white";
    return "bg-red-500 text-white";
  };
  return <Tooltip.Provider delayDuration={200}>
      <div className="overflow-auto bg-white rounded-lg border border-gray-200 p-4">
        <div className="inline-block min-w-full">
          <div
    className="grid gap-px bg-gray-200 rounded-lg overflow-hidden"
    style={{ gridTemplateColumns: `150px repeat(${preyProteins.length}, 100px)` }}
  >
            {
    /* Header Row */
  }
            <div className="bg-gray-50 p-3 font-medium text-sm text-gray-500 flex items-center">
              <span className="text-xs text-gray-400">Bait \ Prey</span>
            </div>
            {preyProteins.map((prey) => <div
    key={prey.name}
    className="bg-purple-50 p-3 font-medium text-sm text-purple-700 text-center border-b-2 border-purple-200"
  >
                {prey.name}
              </div>)}

            {
    /* Data Rows */
  }
            {baitProteins.map((bait) => <Fragment key={bait.name}>
                <div className="bg-blue-50 p-3 font-medium text-sm text-blue-700 border-r-2 border-blue-200">
                  {bait.name}
                </div>
                {preyProteins.map((prey) => {
    const result = getResult(bait.name, prey.name);
    const colorClass = getCellColor(result);
    const hasResult = result?.hasResult ?? false;
    return <Tooltip.Root key={`${bait.name}-${prey.name}`}>
                      <Tooltip.Trigger asChild>
                        <button
      onClick={() =>
                        hasResult &&
                        onCellClick({
                          bait: bait.name,
                          prey: prey.name,
                          score: result?.score || 0,
                          ipTM: result?.ipTM ?? 0,
                          pairId: result?.pairId ?? null
                        })}
      className={`
                            ${colorClass} p-3 text-sm font-medium 
                            ${hasResult ? "hover:ring-2 hover:ring-blue-500 hover:ring-inset cursor-pointer" : "cursor-default"}
                            transition-all
                            flex items-center justify-center
                          `}
      disabled={!hasResult}
    >
                          {hasResult ? result.score.toFixed(2) : "\u2014"}
                        </button>
                      </Tooltip.Trigger>
                      {hasResult && <Tooltip.Portal>
                          <Tooltip.Content
      className="bg-gray-900 text-white px-3 py-2 rounded-md text-sm shadow-lg z-50"
      sideOffset={5}
    >
                            <div className="space-y-1">
                              <div className="font-medium">
                                {bait.name} × {prey.name}
                              </div>
                              <div className="text-gray-300">
                                ipTM (or pTM if no ipTM): {result.score.toFixed(2)}
                              </div>
                            </div>
                            <Tooltip.Arrow className="fill-gray-900" />
                          </Tooltip.Content>
                        </Tooltip.Portal>}
                    </Tooltip.Root>;
  })}
              </Fragment>)}
          </div>
        </div>
      </div>
    </Tooltip.Provider>;
}
export {
  InteractionMatrix
};
