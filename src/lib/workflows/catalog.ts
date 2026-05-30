import type { WorkflowCategory } from "@/types/domain";

export interface CatalogEntry {
  key: string;
  name: string;
  description: string;
  category: WorkflowCategory;
  steps: number;
  agents: number;
}

/** Display catalog of the pre-built workflows, mirroring the product surface. */
export const WORKFLOW_CATALOG: CatalogEntry[] = [
  {
    key: "ind_assembly",
    name: "IND Workspace",
    description: "Create and manage IND application workspaces end to end.",
    category: "ind_assembly",
    steps: 12,
    agents: 4,
  },
  {
    key: "patent_prior_art",
    name: "Prior Art Analysis",
    description: "Analyze compounds against patents and clinical-trial insights.",
    category: "patent_prior_art",
    steps: 8,
    agents: 3,
  },
  {
    key: "patent_extraction",
    name: "Patent Extraction",
    description: "Extract and structure claims from patent documents.",
    category: "patent_prior_art",
    steps: 6,
    agents: 2,
  },
  {
    key: "tabular_review",
    name: "Tabular Review",
    description: "Ask questions across PDFs and map answers to a custom schema.",
    category: "tabular_review",
    steps: 9,
    agents: 3,
  },
  {
    key: "drug_hypothesis",
    name: "Drug Design",
    description: "Test hypotheses against predictive models and optimize candidates.",
    category: "drug_hypothesis",
    steps: 14,
    agents: 5,
  },
  {
    key: "doc_classification",
    name: "Document Processing",
    description: "Classify, label, extract, and route CSRs, patents, and internal reports.",
    category: "doc_classification",
    steps: 7,
    agents: 3,
  },
  {
    key: "dashboard",
    name: "On-Demand Dashboards",
    description: "Generate real-time analytics across CMC, regulatory, or clinical data.",
    category: "dashboard",
    steps: 5,
    agents: 2,
  },
  {
    key: "knowledge_hub",
    name: "Knowledge Hub",
    description: "Connect every document, decision, and dataset into one searchable layer.",
    category: "knowledge_hub",
    steps: 10,
    agents: 4,
  },
];
