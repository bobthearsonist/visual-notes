import type { VisualNotesEdge, VisualNotesNode, VisualNotesSidecar } from "./schema";

const READABLE_CARD_WIDTH = 1120;
const READABLE_CARD_HEIGHT = 520;
const FIT_PADDING_X = 100;
const FIT_PADDING_Y = 100;
const COLLISION_RADIUS_X = 140;
const COLLISION_RADIUS_Y = 70;
// Matches renderer.ts node style "font-size": 11. Used by calculateLayoutMetrics
// to estimate effective font size after cardFitScale; keep these in sync.
const NODE_FONT_SIZE = 11;
const SCHEMA_MIN_X = -200;
const SCHEMA_MAX_X = 5000;
const SCHEMA_MIN_Y = -200;
const SCHEMA_MAX_Y = 3000;

type NodeType = "system" | "task" | "decision";
type NodeStatus = "completed" | "active" | "context" | "blocked";

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

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
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
  maxOutlierRatio: number;
  minNodeDistance: number;
  closePairCount: number;
  edgeCrossingCount: number;
  averagePrimaryEdgeLength: number;
  maxPrimaryEdgeLength: number;
  maxWeakEdgeLength: number;
  weakEdgeLengthBudget: number;
  maxComponentWidth: number;
  maxComponentHeight: number;
  cardFitScale: number;
  estimatedDefaultNodeFontPx: number;
}

export function applyDeterministicLayout(sidecar: VisualNotesSidecar): VisualNotesSidecar {
  if (sidecar._pinned) {
    return sidecar;
  }

  return { ...sidecar, nodes: repairNodes(sidecar.nodes) };
}

function repairNodes(nodes: VisualNotesNode[]): VisualNotesNode[] {
  return resolveCollisions(clampOffCanvas(assignMissingPositions(nodes)));
}

function assignMissingPositions(nodes: VisualNotesNode[]): VisualNotesNode[] {
  const placed = nodes.filter((node) => !isMissingPosition(node.position));
  const missing = nodes.filter((node) => isMissingPosition(node.position));

  if (missing.length === 0) {
    return nodes;
  }

  const anchor = centroidOrDefault(placed.map((n) => n.position));
  let cursor = 0;

  const assigned = new Map<string, { x: number; y: number }>();
  for (const node of missing) {
    const slot = findFreeSlot(anchor, cursor, [...placed, ...nodesFromAssigned(assigned, nodes)]);
    assigned.set(node.data.id, slot);
    cursor += 1;
  }

  return nodes.map((node) => {
    const slot = assigned.get(node.data.id);
    return slot ? { ...node, position: slot } : node;
  });
}

function isMissingPosition(position: { x: number; y: number }): boolean {
  return position.x === 0 && position.y === 0;
}

function centroidOrDefault(positions: { x: number; y: number }[]): { x: number; y: number } {
  if (positions.length === 0) {
    return { x: 400, y: 300 };
  }
  return calculateCentroid(positions);
}

function findFreeSlot(
  anchor: { x: number; y: number },
  cursor: number,
  placed: VisualNotesNode[],
): { x: number; y: number } {
  // Spiral outwards from the anchor in COLLISION_RADIUS_X increments
  // until we find a slot the collision pass would accept.
  const radii = [0, 1, 2, 3, 4, 5];
  for (const radius of radii) {
    const candidates = ringCandidates(anchor, radius);
    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[(cursor + i) % candidates.length];
      const clamped = {
        x: clamp(Math.round(candidate.x), SCHEMA_MIN_X, SCHEMA_MAX_X),
        y: clamp(Math.round(candidate.y), SCHEMA_MIN_Y, SCHEMA_MAX_Y),
      };
      if (!hasCollision(clamped, placed)) {
        return clamped;
      }
    }
  }
  // Last-resort fallback: drop on the anchor (collisions later resolved by resolveCollisions).
  return {
    x: clamp(Math.round(anchor.x), SCHEMA_MIN_X, SCHEMA_MAX_X),
    y: clamp(Math.round(anchor.y), SCHEMA_MIN_Y, SCHEMA_MAX_Y),
  };
}

function ringCandidates(
  anchor: { x: number; y: number },
  radius: number,
): { x: number; y: number }[] {
  if (radius === 0) {
    return [{ x: anchor.x, y: anchor.y }];
  }
  const stepX = COLLISION_RADIUS_X;
  const stepY = COLLISION_RADIUS_Y;
  const candidates: { x: number; y: number }[] = [];
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) {
        continue;
      }
      candidates.push({ x: anchor.x + dx * stepX, y: anchor.y + dy * stepY });
    }
  }
  return candidates;
}

function nodesFromAssigned(
  assigned: Map<string, { x: number; y: number }>,
  originals: VisualNotesNode[],
): VisualNotesNode[] {
  // Wrap assigned coordinates as VisualNotesNode-shaped objects so hasCollision can use them.
  return Array.from(assigned.entries()).map(([id, position]) => {
    const original = originals.find((node) => node.data.id === id);
    return original ? { ...original, position } : ({ data: { id, label: id }, classes: "", position } as VisualNotesNode);
  });
}

function clampOffCanvas(nodes: VisualNotesNode[]): VisualNotesNode[] {
  return nodes.map((node) => {
    const x = clamp(node.position.x, SCHEMA_MIN_X, SCHEMA_MAX_X);
    const y = clamp(node.position.y, SCHEMA_MIN_Y, SCHEMA_MAX_Y);
    if (x === node.position.x && y === node.position.y) {
      return node;
    }
    return { ...node, position: { x, y } };
  });
}

function resolveCollisions(nodes: VisualNotesNode[]): VisualNotesNode[] {
  const repaired: VisualNotesNode[] = [];

  for (const node of nodes) {
    let position = { ...node.position };

    let attempts = 0;
    while (attempts < 12 && hasCollision(position, repaired)) {
      position = nudgeAway(position, repaired);
      // Clamp after each nudge so we don't push off-canvas.
      position = {
        x: clamp(position.x, SCHEMA_MIN_X, SCHEMA_MAX_X),
        y: clamp(position.y, SCHEMA_MIN_Y, SCHEMA_MAX_Y),
      };
      attempts += 1;
    }

    repaired.push(
      position.x === node.position.x && position.y === node.position.y
        ? node
        : { ...node, position },
    );
  }

  return repaired;
}

function hasCollision(
  position: { x: number; y: number },
  placed: VisualNotesNode[],
): boolean {
  return placed.some(
    (other) =>
      Math.abs(other.position.x - position.x) < COLLISION_RADIUS_X &&
      Math.abs(other.position.y - position.y) < COLLISION_RADIUS_Y,
  );
}

function nudgeAway(
  position: { x: number; y: number },
  placed: VisualNotesNode[],
): { x: number; y: number } {
  // Push along the dominant gap direction so we exit the envelope in one step.
  const colliding = placed.find(
    (other) =>
      Math.abs(other.position.x - position.x) < COLLISION_RADIUS_X &&
      Math.abs(other.position.y - position.y) < COLLISION_RADIUS_Y,
  );
  if (!colliding) {
    return position;
  }

  const dx = position.x - colliding.position.x;
  const dy = position.y - colliding.position.y;

  // Pick the axis with more available room to push along.
  if (Math.abs(dx) >= Math.abs(dy)) {
    const sign = dx >= 0 ? 1 : -1;
    return { x: colliding.position.x + sign * COLLISION_RADIUS_X, y: position.y };
  }
  const sign = dy >= 0 ? 1 : -1;
  return { x: position.x, y: colliding.position.y + sign * COLLISION_RADIUS_Y };
}

export function calculateLayoutMetrics(sidecar: VisualNotesSidecar): LayoutMetrics {
  const positions = sidecar.nodes.map((node) => node.position);
  const primaryEdges = getPrimaryEdges(sidecar.edges);
  const weakEdges = sidecar.edges.filter((edge) => edge.classes === "weak-edge");

  if (positions.length === 0) {
    return emptyMetrics(sidecar.edges.length, weakEdges.length);
  }

  const bounds = boundsForPositions(positions);
  const centroid = calculateCentroid(positions);
  const distances = positions.map((position) => distance(position, centroid));
  const averageDistanceFromCentroid = average(distances);
  const infoById = buildInfoById(sidecar.nodes, sidecar.edges);
  const components = buildVisualComponents(sidecar.nodes, sidecar.edges, infoById);
  const proximity = calculateProximityStats(positions);
  const primaryEdgeLengths = calculateEdgeLengths(sidecar.nodes, primaryEdges);
  const weakEdgeLengths = calculateEdgeLengths(sidecar.nodes, weakEdges);
  const componentStats = calculateComponentStats(components);
  const cardFitScale = Math.min(
    READABLE_CARD_WIDTH / Math.max(bounds.width + FIT_PADDING_X, 1),
    READABLE_CARD_HEIGHT / Math.max(bounds.height + FIT_PADDING_Y, 1),
  );

  return {
    nodeCount: sidecar.nodes.length,
    edgeCount: sidecar.edges.length,
    componentCount: components.length,
    weakEdgeCount: weakEdges.length,
    minX: bounds.minX,
    maxX: bounds.maxX,
    minY: bounds.minY,
    maxY: bounds.maxY,
    width: bounds.width,
    height: bounds.height,
    aspectRatio: bounds.height === 0 ? bounds.width : bounds.width / bounds.height,
    averageDistanceFromCentroid,
    maxDistanceFromCentroid: Math.max(...distances),
    maxOutlierRatio: Math.max(...distances) / Math.max(averageDistanceFromCentroid, 1),
    minNodeDistance: proximity.minNodeDistance,
    closePairCount: proximity.closePairCount,
    edgeCrossingCount: countEdgeCrossings(sidecar.nodes, primaryEdges),
    averagePrimaryEdgeLength: average(primaryEdgeLengths),
    maxPrimaryEdgeLength: Math.max(...primaryEdgeLengths, 0),
    maxWeakEdgeLength: Math.max(...weakEdgeLengths, 0),
    weakEdgeLengthBudget: weakEdgeLengths.reduce((sum, edgeLength) => sum + edgeLength, 0),
    maxComponentWidth: componentStats.maxWidth,
    maxComponentHeight: componentStats.maxHeight,
    cardFitScale,
    estimatedDefaultNodeFontPx: NODE_FONT_SIZE * Math.min(cardFitScale, 1),
  };
}

function emptyMetrics(edgeCount: number, weakEdgeCount: number): LayoutMetrics {
  return {
    nodeCount: 0,
    edgeCount,
    componentCount: 0,
    weakEdgeCount,
    minX: 0,
    maxX: 0,
    minY: 0,
    maxY: 0,
    width: 0,
    height: 0,
    aspectRatio: 0,
    averageDistanceFromCentroid: 0,
    maxDistanceFromCentroid: 0,
    maxOutlierRatio: 0,
    minNodeDistance: 0,
    closePairCount: 0,
    edgeCrossingCount: 0,
    averagePrimaryEdgeLength: 0,
    maxPrimaryEdgeLength: 0,
    maxWeakEdgeLength: 0,
    weakEdgeLengthBudget: 0,
    maxComponentWidth: 0,
    maxComponentHeight: 0,
    cardFitScale: 1,
    estimatedDefaultNodeFontPx: NODE_FONT_SIZE,
  };
}

function buildInfoById(
  nodes: VisualNotesNode[],
  edges: VisualNotesEdge[],
): Map<string, NodeInfo> {
  const degreeById = calculateDegree(nodes, edges);

  return new Map(
    nodes.map((node, index): [string, NodeInfo] => {
      const classes = parseNodeClasses(node.classes);
      return [
        node.data.id,
        {
          node,
          id: node.data.id,
          type: classes.type,
          status: classes.status,
          degree: degreeById.get(node.data.id) ?? 0,
          index,
        },
      ];
    }),
  );
}

// Retained for calculateLayoutMetrics' component stats. The repair pass
// added in #21 does not lay out by component; this function is only
// reached through metrics calculation.
function buildVisualComponents(
  nodes: VisualNotesNode[],
  edges: VisualNotesEdge[],
  infoById: Map<string, NodeInfo>,
): Component[] {
  const primaryComponents = findComponents(nodes, getPrimaryEdges(edges), infoById);
  const storyComponents = primaryComponents.filter((component) => component.nodes.length > 1);
  const singletonComponents = primaryComponents.filter((component) => component.nodes.length === 1);

  if (storyComponents.length === 0) {
    return primaryComponents;
  }

  const storyByAnchorId = new Map(
    storyComponents.map((component): [string, NodeInfo[]] => [component.anchorId, [...component.nodes]]),
  );
  const componentByNodeId = new Map<string, Component>();
  storyComponents.forEach((component) => {
    component.nodes.forEach((node) => componentByNodeId.set(node.id, component));
  });

  singletonComponents.forEach((component) => {
    const singleton = component.nodes[0];
    if (!singleton) {
      return;
    }

    const target = findSingletonStoryTarget(singleton, storyComponents, componentByNodeId, edges);
    storyByAnchorId.get(target.anchorId)?.push(singleton);
  });

  return Array.from(storyByAnchorId.entries())
    .map(([anchorId, componentNodes]) => ({
      nodes: sortNodes(componentNodes),
      score: componentScore(componentNodes),
      anchorId,
    }))
    .sort(
      (a, b) =>
        minNodeIndex(a) - minNodeIndex(b) ||
        b.nodes.length - a.nodes.length ||
        b.score - a.score ||
        a.anchorId.localeCompare(b.anchorId),
    );
}

function findSingletonStoryTarget(
  node: NodeInfo,
  storyComponents: Component[],
  componentByNodeId: Map<string, Component>,
  edges: VisualNotesEdge[],
): Component {
  const connectedStory = edges
    .map((edge) => {
      if (edge.data.source === node.id) {
        return componentByNodeId.get(edge.data.target);
      }
      if (edge.data.target === node.id) {
        return componentByNodeId.get(edge.data.source);
      }
      return undefined;
    })
    .filter((component): component is Component => Boolean(component))
    .sort((a, b) => b.score - a.score)[0];

  if (connectedStory) {
    return connectedStory;
  }

  return (
    [...storyComponents]
      .filter((component) => minNodeIndex(component) <= node.index)
      .sort(
        (a, b) =>
          Math.abs(node.index - maxNodeIndex(a)) - Math.abs(node.index - maxNodeIndex(b)) ||
          b.score - a.score,
      )[0] ?? storyComponents[0]
  );
}

function getPrimaryEdges(edges: VisualNotesEdge[]): VisualNotesEdge[] {
  return edges.filter((edge) => edge.classes !== "weak-edge");
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
    if (idSet.has(edge.data.source) && idSet.has(edge.data.target)) {
      union(parentById, edge.data.source, edge.data.target);
    }
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
        score: componentScore(sortedNodes),
        anchorId: sortedNodes[0]?.id ?? "",
      };
    })
    .sort(
      (a, b) =>
        minNodeIndex(a) - minNodeIndex(b) ||
        b.nodes.length - a.nodes.length ||
        b.score - a.score ||
        a.anchorId.localeCompare(b.anchorId),
    );
}

function sortNodes(nodes: NodeInfo[]): NodeInfo[] {
  return [...nodes].sort((a, b) => scoreNode(b) - scoreNode(a) || a.index - b.index);
}

function componentScore(nodes: NodeInfo[]): number {
  return nodes.reduce((sum, node) => sum + scoreNode(node), 0);
}

function scoreNode(node: NodeInfo): number {
  return node.degree * 10 + typeWeight(node.type) + statusWeight(node.status) - node.index / 1000;
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

function minNodeIndex(component: Component): number {
  return Math.min(...component.nodes.map((node) => node.index));
}

function maxNodeIndex(component: Component): number {
  return Math.max(...component.nodes.map((node) => node.index));
}

function calculateCentroid(positions: Position[]): Position {
  return {
    x: positions.reduce((sum, position) => sum + position.x, 0) / positions.length,
    y: positions.reduce((sum, position) => sum + position.y, 0) / positions.length,
  };
}

function calculateProximityStats(positions: Position[]): {
  minNodeDistance: number;
  closePairCount: number;
} {
  let minNodeDistance = Number.POSITIVE_INFINITY;
  let closePairCount = 0;

  positions.forEach((left, leftIndex) => {
    positions.slice(leftIndex + 1).forEach((right) => {
      const nodeDistance = distance(left, right);
      minNodeDistance = Math.min(minNodeDistance, nodeDistance);

      if (
        Math.abs(left.x - right.x) < COLLISION_RADIUS_X &&
        Math.abs(left.y - right.y) < COLLISION_RADIUS_Y
      ) {
        closePairCount += 1;
      }
    });
  });

  return {
    minNodeDistance: Number.isFinite(minNodeDistance) ? minNodeDistance : 0,
    closePairCount,
  };
}

function calculateEdgeLengths(nodes: VisualNotesNode[], edges: VisualNotesEdge[]): number[] {
  const positionById = new Map(nodes.map((node): [string, Position] => [node.data.id, node.position]));

  return edges
    .map((edge) => {
      const source = positionById.get(edge.data.source);
      const target = positionById.get(edge.data.target);
      return source && target ? distance(source, target) : null;
    })
    .filter((edgeLength): edgeLength is number => edgeLength !== null);
}

function calculateComponentStats(components: Component[]): { maxWidth: number; maxHeight: number } {
  return components.reduce(
    (stats, component) => {
      const positions = component.nodes.map((node) => node.node.position);
      if (positions.length === 0) {
        return stats;
      }

      const bounds = boundsForPositions(positions);
      return {
        maxWidth: Math.max(stats.maxWidth, bounds.width),
        maxHeight: Math.max(stats.maxHeight, bounds.height),
      };
    },
    { maxWidth: 0, maxHeight: 0 },
  );
}

function countEdgeCrossings(nodes: VisualNotesNode[], edges: VisualNotesEdge[]): number {
  const positionById = new Map(nodes.map((node): [string, Position] => [node.data.id, node.position]));
  return countCrossingsForPositions(positionById, edges);
}

function countCrossingsForPositions(
  positionById: Map<string, Position>,
  edges: VisualNotesEdge[],
): number {
  let crossings = 0;

  edges.forEach((leftEdge, leftIndex) => {
    const leftSource = positionById.get(leftEdge.data.source);
    const leftTarget = positionById.get(leftEdge.data.target);
    if (!leftSource || !leftTarget) {
      return;
    }

    edges.slice(leftIndex + 1).forEach((rightEdge) => {
      if (edgesShareEndpoint(leftEdge, rightEdge)) {
        return;
      }

      const rightSource = positionById.get(rightEdge.data.source);
      const rightTarget = positionById.get(rightEdge.data.target);
      if (rightSource && rightTarget && segmentsCross(leftSource, leftTarget, rightSource, rightTarget)) {
        crossings += 1;
      }
    });
  });

  return crossings;
}

function edgesShareEndpoint(left: VisualNotesEdge, right: VisualNotesEdge): boolean {
  return (
    left.data.source === right.data.source ||
    left.data.source === right.data.target ||
    left.data.target === right.data.source ||
    left.data.target === right.data.target
  );
}

function segmentsCross(a: Position, b: Position, c: Position, d: Position): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);

  return o1 !== o2 && o3 !== o4;
}

function orientation(a: Position, b: Position, c: Position): number {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);

  if (value === 0) {
    return 0;
  }

  return value > 0 ? 1 : 2;
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

function boundsForPositions(positions: Position[]): Bounds {
  const minX = Math.min(...positions.map((position) => position.x));
  const maxX = Math.max(...positions.map((position) => position.x));
  const minY = Math.min(...positions.map((position) => position.y));
  const maxY = Math.max(...positions.map((position) => position.y));

  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function distance(left: Position, right: Position): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

