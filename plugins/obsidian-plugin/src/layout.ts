import type { VisualNotesEdge, VisualNotesNode, VisualNotesSidecar } from "./schema";

const CLUSTER_START_X = 260;
const CLUSTER_START_Y = 150;
const CLUSTER_SPACING_X = 450;
const CLUSTER_GAP_Y = 170;
const MAX_CLUSTER_COLUMNS = 2;
const COLLISION_RADIUS_X = 120;
const COLLISION_RADIUS_Y = 92;
const VISIBLE_MIN_X = 20;
const VISIBLE_MIN_Y = 40;
const MAX_X = 5000;
const MAX_Y = 3000;

type NodeType = "system" | "task" | "decision";
type NodeStatus = "completed" | "active" | "context" | "blocked";
type SlotBucket = "systems" | "outcomes" | "decisions" | "blocked" | "context" | "other";

interface Position {
  x: number;
  y: number;
}

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

export interface LayoutMetrics {
  nodeCount: number;
  edgeCount: number;
  componentCount: number;
  weakEdgeCount: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
  aspectRatio: number;
  averageDistanceFromCentroid: number;
  maxDistanceFromCentroid: number;
}

const PREFERRED_SLOTS: Record<SlotBucket, Position[]> = {
  systems: [
    { x: -120, y: -105 },
    { x: -120, y: 105 },
    { x: -245, y: -20 },
    { x: -245, y: -150 },
    { x: -245, y: 150 },
    { x: -120, y: -235 },
    { x: -120, y: 235 },
  ],
  outcomes: [
    { x: 200, y: -75 },
    { x: 200, y: 75 },
    { x: 220, y: -205 },
    { x: 220, y: 205 },
    { x: 345, y: -20 },
    { x: 345, y: -150 },
    { x: 345, y: 150 },
  ],
  decisions: [
    { x: 100, y: 200 },
    { x: -45, y: 255 },
    { x: 245, y: 255 },
    { x: 100, y: 350 },
    { x: -45, y: 405 },
    { x: 245, y: 405 },
  ],
  blocked: [
    { x: 0, y: 285 },
    { x: -145, y: 330 },
    { x: 145, y: 330 },
    { x: -290, y: 330 },
    { x: 290, y: 330 },
  ],
  context: [
    { x: -245, y: 275 },
    { x: -245, y: 405 },
    { x: 0, y: -235 },
    { x: 145, y: -235 },
    { x: -145, y: -365 },
    { x: 145, y: -365 },
  ],
  other: [
    { x: 0, y: -235 },
    { x: 145, y: -235 },
    { x: -145, y: -365 },
    { x: 145, y: -365 },
    { x: 0, y: 480 },
  ],
};

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

export function calculateLayoutMetrics(sidecar: VisualNotesSidecar): LayoutMetrics {
  const positions = sidecar.nodes.map((node) => node.position);
  const minX = Math.min(...positions.map((position) => position.x));
  const maxX = Math.max(...positions.map((position) => position.x));
  const minY = Math.min(...positions.map((position) => position.y));
  const maxY = Math.max(...positions.map((position) => position.y));
  const centroid = {
    x: positions.reduce((sum, position) => sum + position.x, 0) / positions.length,
    y: positions.reduce((sum, position) => sum + position.y, 0) / positions.length,
  };
  const distances = positions.map((position) => distance(position, centroid));
  const infoById = buildInfoById(sidecar.nodes, sidecar.edges);
  const components = findComponents(sidecar.nodes, sidecar.edges, infoById);
  const width = maxX - minX;
  const height = maxY - minY;

  return {
    nodeCount: sidecar.nodes.length,
    edgeCount: sidecar.edges.length,
    componentCount: components.length,
    weakEdgeCount: sidecar.edges.filter((edge) => edge.classes === "weak-edge").length,
    minX,
    maxX,
    minY,
    maxY,
    width,
    height,
    aspectRatio: height === 0 ? width : width / height,
    averageDistanceFromCentroid:
      distances.reduce((sum, current) => sum + current, 0) / Math.max(distances.length, 1),
    maxDistanceFromCentroid: Math.max(...distances),
  };
}

function layoutNodes(nodes: VisualNotesNode[], edges: VisualNotesEdge[]): VisualNotesNode[] {
  const infoById = buildInfoById(nodes, edges);
  const positionById = new Map<string, Position>();
  const components = findComponents(nodes, edges, infoById);
  const columnCount = Math.min(MAX_CLUSTER_COLUMNS, Math.max(components.length, 1));
  const columnBottoms = Array.from({ length: columnCount }, () => CLUSTER_START_Y);

  components.forEach((component, componentIndex) => {
    const column = columnForComponent(componentIndex, columnBottoms);
    const anchor = {
      x: CLUSTER_START_X + column * CLUSTER_SPACING_X,
      y: columnBottoms[column],
    };
    const extent = layoutComponent(component, anchor, positionById);
    columnBottoms[column] = extent.maxY + CLUSTER_GAP_Y;
  });

  return nodes.map((node) => ({
    ...node,
    position: positionById.get(node.data.id) ?? node.position,
  }));
}

function buildInfoById(
  nodes: VisualNotesNode[],
  edges: VisualNotesEdge[],
): Map<string, NodeInfo> {
  const degreeById = calculateDegree(nodes, edges);

  return new Map(
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
}

function layoutComponent(
  component: Component,
  anchor: Position,
  positionById: Map<string, Position>,
): { minY: number; maxY: number } {
  const [anchorNode, ...remainingNodes] = component.nodes;
  const usedPositions: Position[] = [];
  const componentPositions: Position[] = [];

  if (!anchorNode) {
    return { minY: anchor.y, maxY: anchor.y };
  }

  setPosition(anchorNode.id, anchor, positionById, usedPositions, componentPositions);

  const buckets = bucketNodes(remainingNodes);
  const bucketOrder: SlotBucket[] = ["systems", "outcomes", "decisions", "blocked", "context", "other"];

  bucketOrder.forEach((bucket) => {
    buckets[bucket].forEach((node, index) => {
      const position = findOpenSlot(anchor, PREFERRED_SLOTS[bucket], index, usedPositions);
      setPosition(node.id, position, positionById, usedPositions, componentPositions);
    });
  });

  shiftComponentIntoVisibleCanvas(positionById, usedPositions, componentPositions);

  return {
    minY: Math.min(...componentPositions.map((position) => position.y)),
    maxY: Math.max(...componentPositions.map((position) => position.y)),
  };
}

function setPosition(
  id: string,
  position: Position,
  positionById: Map<string, Position>,
  usedPositions: Position[],
  componentPositions: Position[],
): void {
  const clamped = clampPosition(position);

  positionById.set(id, clamped);
  usedPositions.push(clamped);
  componentPositions.push(clamped);
}

function shiftComponentIntoVisibleCanvas(
  positionById: Map<string, Position>,
  usedPositions: Position[],
  componentPositions: Position[],
): void {
  if (componentPositions.length === 0) {
    return;
  }

  const minX = Math.min(...componentPositions.map((position) => position.x));
  const minY = Math.min(...componentPositions.map((position) => position.y));
  const shift = {
    x: Math.max(0, VISIBLE_MIN_X - minX),
    y: Math.max(0, VISIBLE_MIN_Y - minY),
  };

  if (shift.x === 0 && shift.y === 0) {
    return;
  }

  for (const [id, position] of positionById.entries()) {
    if (!componentPositions.includes(position)) {
      continue;
    }

    const shifted = clampPosition({ x: position.x + shift.x, y: position.y + shift.y });
    positionById.set(id, shifted);
    const usedIndex = usedPositions.indexOf(position);
    if (usedIndex >= 0) {
      usedPositions[usedIndex] = shifted;
    }
    const componentIndex = componentPositions.indexOf(position);
    if (componentIndex >= 0) {
      componentPositions[componentIndex] = shifted;
    }
  }
}

function bucketNodes(nodes: NodeInfo[]): Record<SlotBucket, NodeInfo[]> {
  const buckets: Record<SlotBucket, NodeInfo[]> = {
    systems: [],
    outcomes: [],
    decisions: [],
    blocked: [],
    context: [],
    other: [],
  };

  nodes.forEach((node) => {
    buckets[bucketForNode(node)].push(node);
  });

  Object.values(buckets).forEach((bucket) =>
    bucket.sort((a, b) => scoreNode(b) - scoreNode(a) || a.id.localeCompare(b.id)),
  );

  return buckets;
}

function bucketForNode(node: NodeInfo): SlotBucket {
  if (node.type === "system") {
    return "systems";
  }

  if (node.type === "decision") {
    return "decisions";
  }

  if (node.status === "blocked") {
    return "blocked";
  }

  if (node.status === "completed" || node.status === "active") {
    return "outcomes";
  }

  if (node.status === "context") {
    return "context";
  }

  return "other";
}

function findOpenSlot(
  anchor: Position,
  preferredSlots: Position[],
  preferredIndex: number,
  usedPositions: Position[],
): Position {
  for (let offset = 0; offset < preferredSlots.length + 24; offset += 1) {
    const slot = slotAt(preferredSlots, preferredIndex + offset);
    const candidate = { x: anchor.x + slot.x, y: anchor.y + slot.y };

    if (isOpen(candidate, usedPositions)) {
      return candidate;
    }
  }

  const fallback = overflowSlot(preferredIndex + preferredSlots.length + 24);
  return { x: anchor.x + fallback.x, y: anchor.y + fallback.y };
}

function slotAt(preferredSlots: Position[], index: number): Position {
  if (index < preferredSlots.length) {
    return preferredSlots[index];
  }

  return overflowSlot(index - preferredSlots.length);
}

function overflowSlot(index: number): Position {
  const row = Math.floor(index / 4);
  const column = index % 4;

  return {
    x: -210 + column * 140,
    y: 540 + row * 120,
  };
}

function isOpen(candidate: Position, usedPositions: Position[]): boolean {
  return usedPositions.every(
    (used) =>
      Math.abs(candidate.x - used.x) >= COLLISION_RADIUS_X ||
      Math.abs(candidate.y - used.y) >= COLLISION_RADIUS_Y,
  );
}

function columnForComponent(componentIndex: number, columnBottoms: number[]): number {
  if (componentIndex < columnBottoms.length) {
    return componentIndex;
  }

  return columnBottoms.reduce(
    (bestColumn, bottom, column) => (bottom < columnBottoms[bestColumn] ? column : bestColumn),
    0,
  );
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

function distance(left: Position, right: Position): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clampPosition(position: Position): Position {
  return {
    x: clamp(Math.round(position.x), VISIBLE_MIN_X, MAX_X),
    y: clamp(Math.round(position.y), VISIBLE_MIN_Y, MAX_Y),
  };
}
