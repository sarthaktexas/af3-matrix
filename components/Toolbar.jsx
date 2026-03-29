import { Upload, Sparkles, FileUp, List } from "lucide-react";
function Toolbar({ onUploadProteins, onManageProteins, onGenerateJobs, onUploadResults, proteinCount }) {
  return <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-3">
        <button
    onClick={onUploadProteins}
    className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors text-sm font-medium"
  >
          <Upload className="w-4 h-4" />
          Upload Proteins
        </button>
        <button
    onClick={onGenerateJobs}
    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium"
  >
          <Sparkles className="w-4 h-4" />
          Generate AF3 Jobs
        </button>
        <button
    onClick={onUploadResults}
    className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors text-sm font-medium"
  >
          <FileUp className="w-4 h-4" />
          Upload Results
        </button>
      </div>

      <div className="flex items-center gap-4">
        <div className="text-sm text-gray-600">
          <span className="font-medium text-blue-600">{proteinCount.bait}</span> baits × 
          <span className="font-medium text-purple-600 ml-1">{proteinCount.prey}</span> preys
        </div>
        <button
    onClick={onManageProteins}
    className="flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors text-sm"
  >
          <List className="w-4 h-4" />
          Manage
        </button>
      </div>
    </div>;
}
export {
  Toolbar
};
