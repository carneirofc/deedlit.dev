export type GenerationDetails = {
  positivePrompt?: string;
  negativePrompt?: string;
  model?: string;
  sampler?: string;
  scheduler?: string;
  cfgScale?: string;
  steps?: string;
  seed?: string;
  size?: string;
  metadataSource?: string;
  additional: Array<{ label: string; value: string }>;
};

export type WorkflowInputEntry = {
  index: number;
  name: string;
  type?: string;
  value?: string;
};

export type WorkflowNodeEntry = {
  id: string;
  title: string;
  type: string;
  note?: string;
  inputs: WorkflowInputEntry[];
  searchText: string;
  x: number;
  y: number;
  width: number;
  height: number;
  outputCount: number;
};

export type WorkflowEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  toInputName: string;
  fromOutputIndex: number;
  toInputIndex: number;
};

export type WorkflowDetails = {
  workflowId?: string;
  nodes: WorkflowNodeEntry[];
  edges: WorkflowEdge[];
  noteNodeCount: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type WorkflowNodePalette = {
  bg: string;
  border: string;
  text: string;
  edge: string;
  selectedBg: string;
  selectedBorder: string;
};

export type PathTreeNode = {
  key: string;
  label: string;
  displayPath: string;
  imageCount: number;
  parentKey: string | null;
  children: PathTreeNode[];
};

export type MutablePathTreeNode = {
  key: string;
  label: string;
  displayPath: string;
  imageCount: number;
  parentKey: string | null;
  childrenMap: Map<string, MutablePathTreeNode>;
};

export type PathLevel = {
  key: string;
  label: string;
  displayPath: string;
};

export type TagCount = {
  tag: string;
  count: number;
};
