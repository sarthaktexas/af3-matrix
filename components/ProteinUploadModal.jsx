import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Upload } from "lucide-react";
function ProteinUploadModal({ open, onClose, onAddProteins }) {
  const [proteinType, setProteinType] = useState("bait");
  const handleTextareaSubmit = (e) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const text = formData.get("sequences");
    if (!text.trim()) return;
    const proteins = parseFasta(text);
    if (proteins.length > 0) {
      onAddProteins(proteins);
      e.currentTarget.reset();
      onClose();
    }
  };
  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result;
      const proteins = file.name.endsWith(".csv") ? parseCsv(text) : parseFasta(text);
      if (proteins.length > 0) {
        onAddProteins(proteins);
        onClose();
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };
  const parseFasta = (text) => {
    const proteins = [];
    const lines = text.split("\n");
    let currentName = "";
    let currentSeq = "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith(">")) {
        if (currentName && currentSeq) {
          proteins.push({
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: currentName,
            sequence: currentSeq.replace(/\s/g, ""),
            type: proteinType
          });
        }
        currentName = trimmed.substring(1).trim();
        currentSeq = "";
      } else if (trimmed) {
        currentSeq += trimmed;
      }
    }
    if (currentName && currentSeq) {
      proteins.push({
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: currentName,
        sequence: currentSeq.replace(/\s/g, ""),
        type: proteinType
      });
    }
    return proteins;
  };
  const parseCsv = (text) => {
    const proteins = [];
    const lines = text.split("\n");
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(",");
      if (parts.length >= 2) {
        const name = parts[0].trim();
        const sequence = parts[1].trim().replace(/\s/g, "");
        if (name && sequence) {
          proteins.push({
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name,
            sequence,
            type: proteinType
          });
        }
      }
    }
    return proteins;
  };
  return <Dialog.Root open={open} onOpenChange={onClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
          {
    /* Header */
  }
          <div className="flex items-start justify-between p-6 border-b border-gray-200">
            <div>
              <Dialog.Title className="text-xl font-semibold text-gray-900">
                Upload Proteins
              </Dialog.Title>
              <Dialog.Description className="text-sm text-gray-500 mt-1">
                Add bait or prey proteins for interaction screening
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
          <div className="p-6">
            <form onSubmit={handleTextareaSubmit} className="space-y-4">
              {
    /* Protein Type Selector */
  }
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Protein Type
                </label>
                <div className="flex gap-3">
                  <button
    type="button"
    onClick={() => setProteinType("bait")}
    className={`
                      flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors
                      ${proteinType === "bait" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}
                    `}
  >
                    Bait Proteins
                  </button>
                  <button
    type="button"
    onClick={() => setProteinType("prey")}
    className={`
                      flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors
                      ${proteinType === "prey" ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}
                    `}
  >
                    Prey Proteins
                  </button>
                </div>
              </div>

              {
    /* Textarea for sequences */
  }
              <div>
                <label htmlFor="sequences" className="block text-sm font-medium text-gray-700 mb-2">
                  Paste Sequences (FASTA format)
                </label>
                <textarea
    id="sequences"
    name="sequences"
    rows={8}
    placeholder=">BRCA1
MDLSALRVEEVQNVINAMQKILECPICLELIKEPVSTKCDHIFCKFCMLKLLNQKKGPSQCPLCKNDITKRS
>TP53
MEEPQSDPSVEPPLSQETFSDLWKLLPENNVLSPLPSQAMDDLMLSPDDIEQWFTEDPGPDEAPRMPEAAP"
    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
  />
              </div>

              {
    /* File upload */
  }
              <div>
                <label htmlFor="file" className="block text-sm font-medium text-gray-700 mb-2">
                  Or Upload File (CSV or FASTA)
                </label>
                <label className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-50 border-2 border-dashed border-gray-300 text-gray-700 rounded-md hover:bg-gray-100 transition-colors cursor-pointer">
                  <Upload className="w-4 h-4" />
                  <span className="text-sm">Choose File (.csv, .fasta, .fa, .txt)</span>
                  <input
    id="file"
    type="file"
    accept=".csv,.fasta,.fa,.txt"
    onChange={handleFileUpload}
    className="hidden"
  />
                </label>
              </div>

              {
    /* Actions */
  }
              <div className="flex gap-3 pt-4">
                <button
    type="submit"
    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium"
  >
                  Add Proteins
                </button>
                <button
    type="button"
    onClick={onClose}
    className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors text-sm font-medium"
  >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>;
}
export {
  ProteinUploadModal
};
