import * as Dialog from "@radix-ui/react-dialog";
import { X, Trash2 } from "lucide-react";
function ProteinListModal({ open, onClose, proteins, onDeleteProtein }) {
  const baitProteins = proteins.filter((p) => p.type === "bait");
  const preyProteins = proteins.filter((p) => p.type === "prey");
  return <Dialog.Root open={open} onOpenChange={onClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
          {
    /* Header */
  }
          <div className="flex items-start justify-between p-6 border-b border-gray-200">
            <div>
              <Dialog.Title className="text-xl font-semibold text-gray-900">
                Manage Proteins
              </Dialog.Title>
              <Dialog.Description className="text-sm text-gray-500 mt-1">
                View and manage uploaded bait and prey proteins
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button className="text-gray-400 hover:text-gray-600 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </Dialog.Close>
          </div>

          {
    /* Content */
  }
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {
    /* Bait Proteins */
  }
            <div>
              <h3 className="text-sm font-semibold text-blue-900 mb-3 flex items-center gap-2">
                <span className="px-2 py-1 bg-blue-100 rounded text-xs">BAIT</span>
                {baitProteins.length} proteins
              </h3>
              {baitProteins.length === 0 ? <p className="text-sm text-gray-500 italic">No bait proteins uploaded</p> : <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-blue-50 border-b border-blue-200">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-blue-700">Name</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-blue-700">Sequence</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-blue-700">Length</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-blue-700">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {baitProteins.map((protein) => <tr key={protein.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">{protein.name}</td>
                          <td className="px-4 py-3 text-xs text-gray-600 font-mono max-w-md">
                            <div className="truncate">{protein.sequence}</div>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">{protein.sequence.length} aa</td>
                          <td className="px-4 py-3">
                            <button
    onClick={() => onDeleteProtein(protein.id)}
    className="text-gray-400 hover:text-red-600 transition-colors"
  >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>)}
                    </tbody>
                  </table>
                </div>}
            </div>

            {
    /* Prey Proteins */
  }
            <div>
              <h3 className="text-sm font-semibold text-purple-900 mb-3 flex items-center gap-2">
                <span className="px-2 py-1 bg-purple-100 rounded text-xs">PREY</span>
                {preyProteins.length} proteins
              </h3>
              {preyProteins.length === 0 ? <p className="text-sm text-gray-500 italic">No prey proteins uploaded</p> : <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-purple-50 border-b border-purple-200">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-purple-700">Name</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-purple-700">Sequence</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-purple-700">Length</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-purple-700">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {preyProteins.map((protein) => <tr key={protein.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">{protein.name}</td>
                          <td className="px-4 py-3 text-xs text-gray-600 font-mono max-w-md">
                            <div className="truncate">{protein.sequence}</div>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">{protein.sequence.length} aa</td>
                          <td className="px-4 py-3">
                            <button
    onClick={() => onDeleteProtein(protein.id)}
    className="text-gray-400 hover:text-red-600 transition-colors"
  >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>)}
                    </tbody>
                  </table>
                </div>}
            </div>
          </div>

          {
    /* Footer */
  }
          <div className="p-6 border-t border-gray-200 bg-gray-50">
            <button
    onClick={onClose}
    className="w-full px-4 py-2 bg-gray-700 text-white rounded-md hover:bg-gray-800 transition-colors text-sm font-medium"
  >
              Close
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>;
}
export {
  ProteinListModal
};
