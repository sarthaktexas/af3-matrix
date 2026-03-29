import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, CheckCircle2, AlertCircle, XCircle, Target, Layers } from "lucide-react";
function DetailPanel({ data, open, onClose }) {
  const [selectedModel, setSelectedModel] = useState(1);
  const [targetRegion, setTargetRegion] = useState(null);
  if (!data) return null;
  const models = [
    { id: 1, ipTM: 0.87, ranking: 0.92, contacts: 45, interfaceSize: 1250, clashScore: 0.02, isBest: true },
    { id: 2, ipTM: 0.85, ranking: 0.89, contacts: 42, interfaceSize: 1180, clashScore: 0.03, isBest: false },
    { id: 3, ipTM: 0.84, ranking: 0.88, contacts: 44, interfaceSize: 1220, clashScore: 0.04, isBest: false },
    { id: 4, ipTM: 0.82, ranking: 0.85, contacts: 40, interfaceSize: 1150, clashScore: 0.05, isBest: false },
    { id: 5, ipTM: 0.79, ranking: 0.81, contacts: 38, interfaceSize: 1100, clashScore: 0.06, isBest: false }
  ];
  const currentModel = models[selectedModel - 1];
  const modelsInAgreement = 4;
  const getConfidenceLevel = (ipTM) => {
    if (ipTM > 0.8) return { label: "High", color: "bg-green-100 text-green-700 border-green-200", icon: CheckCircle2 };
    if (ipTM > 0.5) return { label: "Medium", color: "bg-yellow-100 text-yellow-700 border-yellow-200", icon: AlertCircle };
    return { label: "Low", color: "bg-red-100 text-red-700 border-red-200", icon: XCircle };
  };
  const confidence = getConfidenceLevel(currentModel.ipTM);
  const ConfidenceIcon = confidence.icon;
  const mockRegionStart = 820;
  const mockRegionEnd = 950;
  const regionLength = mockRegionEnd - mockRegionStart + 1;
  const regionInvolved = 78;
  const interfaceInRegion = 65;
  return <Dialog.Root open={open} onOpenChange={onClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-2xl w-full max-w-7xl max-h-[90vh] overflow-hidden flex flex-col">
          {
    /* Header */
  }
          <div className="flex items-start justify-between p-6 border-b border-gray-200">
            <div>
              <Dialog.Title className="text-xl font-semibold text-gray-900">
                Interaction Details
              </Dialog.Title>
              <Dialog.Description className="text-sm text-gray-500 mt-1">
                {data.bait} × {data.prey}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button className="text-gray-400 hover:text-gray-600 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </Dialog.Close>
          </div>

          {
    /* Main Content */
  }
          <div className="flex-1 overflow-y-auto">
            <div className="grid grid-cols-2 gap-6 p-6">
              {
    /* Left: 3D Viewer */
  }
              <div className="space-y-4">
                <div className="bg-gray-100 rounded-lg border-2 border-gray-300 aspect-square flex items-center justify-center">
                  <div className="text-center">
                    <Layers className="w-16 h-16 text-gray-400 mx-auto mb-3" />
                    <p className="text-lg font-medium text-gray-600">Structure Viewer</p>
                    <p className="text-sm text-gray-500 mt-1">Model {selectedModel}</p>
                    {currentModel.isBest && <span className="inline-block mt-2 px-3 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">
                        Best Model
                      </span>}
                  </div>
                </div>

                {
    /* Model Selector */
  }
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select Model
                  </label>
                  <div className="flex gap-2">
                    {models.map((model) => <button
    key={model.id}
    onClick={() => setSelectedModel(model.id)}
    className={`
                          flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors relative
                          ${selectedModel === model.id ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}
                        `}
  >
                        {model.id}
                        {model.isBest && <span className="absolute -top-1 -right-1 w-3 h-3 bg-yellow-400 rounded-full border-2 border-white" />}
                      </button>)}
                  </div>
                </div>

                {
    /* Region Targeting Input */
  }
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <div className="flex items-center gap-2 mb-3">
                    <Target className="w-4 h-4 text-gray-600" />
                    <label className="text-sm font-medium text-gray-700">
                      Target Region Analysis
                    </label>
                  </div>
                  <div className="flex gap-2">
                    <input
    type="number"
    placeholder="Start"
    defaultValue={mockRegionStart}
    className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
  />
                    <span className="text-gray-400 self-center">–</span>
                    <input
    type="number"
    placeholder="End"
    defaultValue={mockRegionEnd}
    className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
  />
                    <button
    onClick={() => setTargetRegion({ start: mockRegionStart, end: mockRegionEnd })}
    className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700"
  >
                      Analyze
                    </button>
                  </div>
                </div>
              </div>

              {
    /* Right: Metrics Panel */
  }
              <div className="space-y-4">
                {
    /* Protein Names */
  }
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
                    <p className="text-xs text-blue-600 font-medium mb-1">Protein A (Bait)</p>
                    <p className="text-lg font-semibold text-blue-900">{data.bait}</p>
                  </div>
                  <div className="bg-purple-50 rounded-lg p-3 border border-purple-200">
                    <p className="text-xs text-purple-600 font-medium mb-1">Protein B (Prey)</p>
                    <p className="text-lg font-semibold text-purple-900">{data.prey}</p>
                  </div>
                </div>

                {
    /* 1. Confidence */
  }
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Confidence Metrics</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">ipTM</span>
                      <span className="text-sm font-semibold text-gray-900">{currentModel.ipTM.toFixed(3)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Ranking Score</span>
                      <span className="text-sm font-semibold text-gray-900">{currentModel.ranking.toFixed(3)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Confidence Level</span>
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-xs font-medium ${confidence.color}`}>
                        <ConfidenceIcon className="w-3 h-3" />
                        {confidence.label}
                      </span>
                    </div>
                  </div>
                </div>

                {
    /* 2. Interface Metrics */
  }
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Interface Metrics</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Number of Contacts</span>
                      <span className="text-sm font-semibold text-gray-900">{currentModel.contacts}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Interface Size</span>
                      <span className="text-sm font-semibold text-gray-900">{currentModel.interfaceSize} Ų</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Clash Score</span>
                      <span className="text-sm font-semibold text-gray-900">{currentModel.clashScore.toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                {
    /* 3. Region Targeting */
  }
                {targetRegion && <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-lg border border-blue-200 p-4">
                    <h3 className="text-sm font-semibold text-gray-900 mb-3">Region Targeting</h3>
                    <div className="space-y-3">
                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-sm text-gray-600">Highlighted Region</span>
                          <span className="text-sm font-semibold text-gray-900">
                            {targetRegion.start}–{targetRegion.end}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500">{regionLength} residues</div>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">Region in Binding</span>
                        <span className="text-sm font-semibold text-blue-600">{regionInvolved}%</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">Interface in Region</span>
                        <span className="text-sm font-semibold text-purple-600">{interfaceInRegion}%</span>
                      </div>
                      <div className="pt-2 mt-2 border-t border-blue-200">
                        <div className="flex items-center gap-2">
                          {interfaceInRegion > 50 ? <>
                              <CheckCircle2 className="w-4 h-4 text-green-600" />
                              <span className="text-sm font-medium text-green-700">
                                Strong binding in target region
                              </span>
                            </> : <>
                              <AlertCircle className="w-4 h-4 text-yellow-600" />
                              <span className="text-sm font-medium text-yellow-700">
                                Limited binding in target region
                              </span>
                            </>}
                        </div>
                      </div>
                    </div>
                  </div>}

                {
    /* 4. Model Consistency */
  }
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Model Consistency</h3>
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      {models.map((model) => {
    const agrees = model.ipTM > 0.8;
    return <div
      key={model.id}
      className={`
                              flex-1 h-12 rounded-md border-2 flex items-center justify-center text-xs font-medium
                              ${agrees ? "bg-green-50 border-green-500 text-green-700" : "bg-gray-50 border-gray-300 text-gray-500"}
                              ${selectedModel === model.id ? "ring-2 ring-blue-500" : ""}
                            `}
    >
                            {model.id}
                            {agrees && <CheckCircle2 className="w-3 h-3 ml-1" />}
                          </div>;
  })}
                    </div>
                    <div className="text-sm text-gray-600 text-center">
                      <span className="font-semibold text-gray-900">{modelsInAgreement}/5</span> models agree on high confidence
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {
    /* Footer Actions */
  }
          <div className="flex gap-3 p-6 border-t border-gray-200 bg-gray-50">
            <button className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium">
              Export Structure (PDB)
            </button>
            <button className="flex-1 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors text-sm font-medium">
              Download Metrics (CSV)
            </button>
            <button className="flex-1 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors text-sm font-medium">
              Generate Report
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>;
}
export {
  DetailPanel
};
