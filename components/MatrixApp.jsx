import { useState } from "react";
import { InteractionMatrix } from "./InteractionMatrix";
import { DetailPanel } from "./DetailPanel";
import { Toolbar } from "./Toolbar";
import { ProteinUploadModal } from "./ProteinUploadModal";
import { ProteinListModal } from "./ProteinListModal";
function MatrixApp() {
  const [proteins, setProteins] = useState([
    // Default bait proteins
    {
      id: "1",
      name: "BRCA1",
      sequence: "MDLSALRVEEVQNVINAMQKILECPICLELIKEPVSTKCDHIFCKFCMLKLLNQKKGPSQCPLCKNDITKRS",
      type: "bait"
    },
    {
      id: "2",
      name: "TP53",
      sequence: "MEEPQSDPSVEPPLSQETFSDLWKLLPENNVLSPLPSQAMDDLMLSPDDIEQWFTEDPGPDEAPRMPEAAP",
      type: "bait"
    },
    {
      id: "3",
      name: "EGFR",
      sequence: "MRPSGTAGAALLALLAALCPASRALEEKKVCQGTSNKLTQLGTFEDHFLSLQRMFNNCEVVLGNLEITYVQRN",
      type: "bait"
    },
    {
      id: "4",
      name: "KRAS",
      sequence: "MTEYKLVVVGAGGVGKSALTIQLIQNHFVDEYDPTIEDSYRKQVVIDGETCLLDILDTAGQEEYSAMRDQYMRTGEGF",
      type: "bait"
    },
    {
      id: "5",
      name: "MYC",
      sequence: "MDFFRVVENQQPPATMPLNVSVILKKYRKLETEVRKSPPKTKKVSKGGTRDMQVYKQDEPQRRSARLSAKPPAPPPLR",
      type: "bait"
    },
    {
      id: "6",
      name: "PTEN",
      sequence: "MTAIIKEIVSRNKRRYQEDGFDLDLTYIYPNIIAMGFPAERLEGVYRNNIDDVVRFLDSKHKNHYKIYNLCAERHYDT",
      type: "bait"
    },
    // Default prey proteins
    {
      id: "7",
      name: "MDM2",
      sequence: "MCNTNMSVPTDGAVTTSQIPASEQETLVRPKPLLLKLLKSVGAQKDTYTMKEVLFYLGQYIMTKRLYDEKQQHIVIERY",
      type: "prey"
    },
    {
      id: "8",
      name: "BCL2",
      sequence: "MAHAGRTGYDNREIVMKYIHYKLSQRGYEWDAGDVGAAPPGAAPAPGIFSSQPGHTPHPAASRDPVARTSPLQTPAAP",
      type: "prey"
    },
    {
      id: "9",
      name: "STAT3",
      sequence: "MEFSPGRRTPSLRKFQMRPSDYQQYQFQHQQQQQQQQQHPQPHPQQPQQPHLLQQQQQQQQQPQQQPPPPPQQPQQP",
      type: "prey"
    },
    {
      id: "10",
      name: "RAF1",
      sequence: "MEHIQGAWKTISNGFGFKDAVFDGSSCISPTIVQQFGYQRRASDDGKLTDPSKTSNTIRVFLPNKQRTVVNVRNGMSL",
      type: "prey"
    },
    {
      id: "11",
      name: "PIK3CA",
      sequence: "MPPRPSSGELWGIHLMPPRILVECLLPNGMIVTLECLREATLLAGGDGPVSRCLKELSPDDKSPKFETLFLILDDPPD",
      type: "prey"
    },
    {
      id: "12",
      name: "MTOR",
      sequence: "MLGTREQALLQRQSASGSARQVLLQRQAAAGGGLELSDSDLPGVGSPSSGSWGGGGGGGGGGSVSAAEAPADPPGPG",
      type: "prey"
    }
  ]);
  const [results, setResults] = useState(() => {
    const mockResults = /* @__PURE__ */ new Map();
    const resultsData = [
      { bait: "BRCA1", prey: "MDM2", score: 0.45, ipTM: 0.62 },
      { bait: "BRCA1", prey: "BCL2", score: 0.23, ipTM: 0.48 },
      { bait: "BRCA1", prey: "RAF1", score: 0.78, ipTM: 0.85 },
      {
        bait: "BRCA1",
        prey: "PIK3CA",
        score: 0.56,
        ipTM: 0.71
      },
      { bait: "TP53", prey: "MDM2", score: 0.92, ipTM: 0.94 },
      { bait: "TP53", prey: "BCL2", score: 0.67, ipTM: 0.78 },
      { bait: "TP53", prey: "STAT3", score: 0.34, ipTM: 0.55 },
      { bait: "TP53", prey: "MTOR", score: 0.41, ipTM: 0.59 },
      { bait: "EGFR", prey: "STAT3", score: 0.81, ipTM: 0.88 },
      { bait: "EGFR", prey: "RAF1", score: 0.73, ipTM: 0.82 },
      { bait: "EGFR", prey: "PIK3CA", score: 0.89, ipTM: 0.91 },
      { bait: "KRAS", prey: "RAF1", score: 0.95, ipTM: 0.96 },
      { bait: "KRAS", prey: "PIK3CA", score: 0.84, ipTM: 0.87 },
      { bait: "KRAS", prey: "MTOR", score: 0.52, ipTM: 0.68 },
      { bait: "MYC", prey: "MDM2", score: 0.38, ipTM: 0.57 },
      { bait: "MYC", prey: "BCL2", score: 0.71, ipTM: 0.8 },
      { bait: "MYC", prey: "STAT3", score: 0.63, ipTM: 0.74 },
      { bait: "PTEN", prey: "PIK3CA", score: 0.76, ipTM: 0.83 },
      { bait: "PTEN", prey: "MTOR", score: 0.68, ipTM: 0.77 },
      { bait: "PTEN", prey: "RAF1", score: 0.29, ipTM: 0.51 }
    ];
    resultsData.forEach(({ bait, prey, score, ipTM }) => {
      mockResults.set(`${bait}:${prey}`, {
        score,
        ipTM,
        hasResult: true
      });
    });
    return mockResults;
  });
  const [selectedInteraction, setSelectedInteraction] = useState(null);
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [manageModalOpen, setManageModalOpen] = useState(false);
  const handleAddProteins = (newProteins) => {
    setProteins([...proteins, ...newProteins]);
  };
  const handleDeleteProtein = (id) => {
    setProteins(proteins.filter((p) => p.id !== id));
  };
  const handleCellClick = (data) => {
    setSelectedInteraction(data);
    setDetailPanelOpen(true);
  };
  const handleCloseDetail = () => {
    setDetailPanelOpen(false);
  };
  const baitProteins = proteins.filter(
    (p) => p.type === "bait"
  );
  const preyProteins = proteins.filter(
    (p) => p.type === "prey"
  );
  return <div className="flex h-screen bg-gray-50">
      {
    /* Main Content */
  }
      <div className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto p-8">
          {
    /* Toolbar */
  }
          <Toolbar
    onUploadProteins={() => setUploadModalOpen(true)}
    onManageProteins={() => setManageModalOpen(true)}
    onGenerateJobs={() => alert(
      "Generate jobs functionality - integrate with your backend"
    )}
    onUploadResults={() => alert(
      "Upload results functionality - integrate with your backend"
    )}
    proteinCount={{
      bait: baitProteins.length,
      prey: preyProteins.length
    }}
  />

          {
    /* Matrix */
  }
          <InteractionMatrix
    baitProteins={baitProteins}
    preyProteins={preyProteins}
    results={results}
    onCellClick={handleCellClick}
  />
        </div>
      </div>

      {
    /* Modals */
  }
      <ProteinUploadModal
    open={uploadModalOpen}
    onClose={() => setUploadModalOpen(false)}
    onAddProteins={handleAddProteins}
  />

      <ProteinListModal
    open={manageModalOpen}
    onClose={() => setManageModalOpen(false)}
    proteins={proteins}
    onDeleteProtein={handleDeleteProtein}
  />

      {
    /* Detail Panel */
  }
      <DetailPanel
    data={selectedInteraction}
    open={detailPanelOpen}
    onClose={handleCloseDetail}
  />
    </div>;
}
export {
  MatrixApp as default
};
