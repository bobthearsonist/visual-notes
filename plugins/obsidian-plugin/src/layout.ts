import type { VisualNotesEdge, VisualNotesNode, VisualNotesSidecar } from "./schema";

const CLUSTER_START_X = 220;
const CLUSTER_START_Y = 120;
const CLUSTER_SPACING_X = 470;
const CLUSTER_SPACING_Y = 580;
const TIER_GAP_Y = 48;
const NODE_GAP_X = 170;
const NODE_GAP_Y = 128;
const MAX_COLUMNS = 10;
const MAX_X = 5000;
const MAX_Y = 3000;
const MIN_X = -200;
const MIN_Y = -200;

type NodeType = "system" | "task" | "decision";
type NodeStatus = "completed" | "active" | "context" | "blocked";

interface NodeInfo {
  node: VisualNotesNode;
  id: string;
  type: NodeType;
  status: NodeStatus;
  degree: number;
  index: number;
}

interface Component {
  nodes: NodeInfo[];
  score: number;
  anchorId: string;
}

export function applyDeterministicLayout(sidecar: VisualNotesSidecar): VisualNotesSidecar {
  if (sidecar._pinned) {
    return sidecar;
  }

  const positionedNodes = layoutNodes(sidecar.nodes, sidecar.edges);

  return {
    ...sidecar,
    nodes: positionedNodes,
  };
}

function layoutNodes(nodes: VisualNotesNode[], edges: VisualNotesEdge[]): VisualNotesNode[] {
  const degreeById = calculateDegree(nodes, edges);
  const infoById = new Map(
    nodes.map((node, index): [string, NodeInfo] => {
      const classes = parseNodeClasses(node.classes);
      const id = node.data.id;
      return [
        id,
        {
          node,
          id,
          type: classes.type,
          status: classes.status,
          degree: degreeById.get(id) ?? 0,
          index,
        },
      ];
    }),
  );
  const positionById = new Map<string, { x: number; y: number }>();
  const components = findComponents(nodes, edges, infoById);

  components.forEach((component, componentIndex) => {
    const column = componentIndex % MAX_COLUMNS;
    const row = Math.floor(componentIndex / MAX_COLUMNS);
    const centerX = CLUSTER_START_X + column * CLUSTER_SPACING_X;
    const topY = CLUSTER_START_Y + row * CLUSTER_SPACING_Y;
    const maxDegree = Math.max(...component.nodes.map((node) => node.degree), 0);
    const tieredNodes = groupByTier(component.nodes, maxDegree);
    const nodesPerRow = nodesPerRowForComponent(component.nodes.length, components.length);
    let yCursor = topY;

    tieredNodes.forEach((tierNodes) => {
      if (tierNodes.length === 0) {
        return;
      }

      const rowCount = Math.ceil(tierNodes.length / nodesPerRow);
      tierNodes.forEach((node, index) => {
        const rowIndex = Math.floor(index / nodesPerRow);
        const itemsInRow = Math.min(nodesPerRow, tierNodes.length - rowIndex * nodesPerRow);
        const columnIndex = index % nodesPerRow;
        const centeredColumn = columnIndex - (itemsInRow - 1) / 2;

        positionById.set(node.id, {
          x: clamp(centerX + centeredColumn * NODE_GAP_X, MIN_X, MAX_X),
          y: clamp(yCursor + rowIndex * NODE_GAP_Y, MIN_Y, MAX_Y),
        });
      });

      yCursor += rowCount * NODE_GAP_Y + TIER_GAP_Y;
    });
  });

  return nodes.map((node) => ({
    ...node,
    position: positionById.get(node.data.id) ?? node.position,
  }));
}

function calculateDegree(nodes: VisualNotesNode[], edges: VisualNotesEdge[]): Map<string, number> {
  const ids = new Set(nodes.map((node) => node.data.id));
  const degreeById = new Map(nodes.map((node): [string, number] => [node.data.id, 0]));

  edges.forEach((edge) => {
    const { source, target } = edge.data;
    if (!ids.has(source) || !ids.has(target)) {
      return;
    }

    degreeById.set(source, (degreeById.get(source) ?? 0) + 1);
    degreeById.set(target, (degreeById.get(target) ?? 0) + 1);
  });

  return degreeById;
}

function findComponents(
  nodes: VisualNotesNode[],
  edges: VisualNotesEdge[],
  infoById: Map<string, NodeInfo>,
): Component[] {
  const ids = nodes.map((node) => node.data.id);
  const parentById = new Map(ids.map((id): [string, string] => [id, id]));
  const idSet = new Set(ids);

  edges.forEach((edge) => {
    const { source, target } = edge.data;
    if (edge.classes === "weak-edge" || !idSet.has(source) || !idSet.has(target)) {
      return;
    }

    union(parentById, source, target);
  });

  const nodesByRoot = new Map<string, NodeInfo[]>();
  ids.forEach((id) => {
    const info = infoById.get(id);
    if (!info) {
      return;
    }

    const root = find(parentById, id);
    const componentNodes = nodesByRoot.get(root) ?? [];
    componentNodes.push(info);
    nodesByRoot.set(root, componentNodes);
  });

  return Array.from(nodesByRoot.values())
    .map((componentNodes) => {
      const sortedNodes = sortNodes(componentNodes);
      return {
        nodes: sortedNodes,
        score: Math.max(...sortedNodes.map(scoreNode), 0),
        anchorId: sortedNodes[0]?.id ?? "",
      };
    })
    .sort((a, b) => b.score - a.score || a.anchorId.localeCompare(b.anchorId));
}

function groupByTier(nodes: NodeInfo[], maxDegree: number): NodeInfo[][] {
  const tiers: NodeInfo[][] = [[], [], [], [], [], [], []];

  nodes.forEach((node) => {
    tiers[tierForNode(node, maxDegree)].push(node);
  });

  tiers.forEach((tier) => tier.sort((a, b) => scoreNode(b) - scoreNode(a) || a.id.localeCompare(b.id)));

  return tiers;
}

function tierForNode(node: NodeInfo, maxDegree: number): number {
  const isHub = node.degree > 1 && (node.degree === maxDegree || node.degree >= 3);
  if (isHub || (node.degree >= 2 && (node.type === "system" || node.type === "decision"))) {
    return 0;
  }

  if (node.type === "system") {
    return 1;
  }

  if (node.status === "active") {
    return 2;
  }

  if (node.type === "decision") {
    return 3;
  }

  if (node.status === "completed") {
    return 4;
  }

  if (node.status === "blocked") {
    return 5;
  }

  return 6;
}

function sortNodes(nodes: NodeInfo[]): NodeInfo[] {
  return [...nodes].sort((a, b) => scoreNode(b) - scoreNode(a) || a.id.localeCompare(b.id));
}

function scoreNode(node: NodeInfo): number {
  return (
    node.degree * 10 +
    typeWeight(node.type) +
    statusWeight(node.status) -
    Math.min(node.index, 100) / 1000
  );
}

function typeWeight(type: NodeType): number {
  switch (type) {
    case "system":
      return 5;
    case "decision":
      return 4;
    case "task":
      return 1;
  }
}

function statusWeight(status: NodeStatus): number {
  switch (status) {
    case "active":
      return 4;
    case "context":
      return 3;
    case "blocked":
      return 2;
    case "completed":
      return 1;
  }
}

function nodesPerRowForComponent(componentSize: number, componentCount: number): number {
  if (componentSize >= 10 || componentCount <= 2) {
    return 3;
  }

  if (componentSize >= 5) {
    return 2;
  }

  return 1;
}

function parseNodeClasses(classes: string): { type: NodeType; status: NodeStatus } {
  const [type, status] = classes.split(" ");
  return {
    type: isNodeType(type) ? type : "task",
    status: isNodeStatus(status) ? status : "context",
  };
}

function isNodeType(value: string | undefined): value is NodeType {
  return value === "system" || value === "task" || value === "decision";
}

function isNodeStatus(value: string | undefined): value is NodeStatus {
  return value === "completed" || value === "active" || value === "context" || value === "blocked";
}

function find(parentById: Map<string, string>, id: string): string {
  const parent = parentById.get(id);
  if (!parent || parent === id) {
    return id;
  }

  const root = find(parentById, parent);
  parentById.set(id, root);
  return root;
}

function union(parentById: Map<string, string>, left: string, right: string): void {
  const leftRoot = find(parentById, left);
  const rightRoot = find(parentById, right);

  if (leftRoot !== rightRoot) {
    parentById.set(rightRoot, leftRoot);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
