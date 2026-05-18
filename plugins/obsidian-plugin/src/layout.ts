import type { VisualNotesEdge, VisualNotesNode, VisualNotesSidecar } from "./schema";

const CANVAS_START_X = 110;
const CANVAS_START_Y = 110;
const COMPONENT_GAP_X = 220;
const COMPONENT_GAP_Y = 160;
const COMPONENT_ROW_WIDTH = 1100;
const NODE_GAP_X = 170;
const NODE_GAP_Y = 125;
const FLAT_BOARD_MAX_NODES = 28;
const FLAT_BOARD_TARGET_ROWS = 4;
const FLAT_BOARD_MAX_COLUMNS = 6;
const READABLE_CARD_WIDTH = 1120;
const READABLE_CARD_HEIGHT = 520;
const FIT_PADDING_X = 100;
const FIT_PADDING_Y = 100;
const COLLISION_RADIUS_X = 120;
const COLLISION_RADIUS_Y = 95;
const NODE_FONT_SIZE = 13;
const VISIBLE_MIN_X = 20;
const VISIBLE_MIN_Y = 40;
const MAX_X = 5000;
const MAX_Y = 3000;

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

interface ComponentLayout {
  positions: Map<string, Position>;
  width: number;
  height: number;
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
  // Repair pipeline grows in later tasks. For now, pass through.
  return nodes;
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

function layoutNodes(nodes: VisualNotesNode[], edges: VisualNotesEdge[]): VisualNotesNode[] {
  if (nodes.length === 0) {
    return [];
  }

  const infoById = buildInfoById(nodes, edges);
  if (nodes.length <= FLAT_BOARD_MAX_NODES) {
    const components = buildVisualComponents(nodes, edges, infoById);
    const orderedNodes = components.flatMap((component) => orderComponentNodes(component.nodes, edges));
    const flatPositions = layoutFlatBoard(orderedNodes, edges);
    return nodes.map((node) => ({
      ...node,
      position: flatPositions.get(node.data.id) ?? node.position,
    }));
  }

  const components = buildVisualComponents(nodes, edges, infoById);
  const packedPositions = packComponents(components.map((component) => layoutComponent(component, edges)));

  return nodes.map((node) => ({
    ...node,
    position: packedPositions.get(node.data.id) ?? node.position,
  }));
}

function layoutFlatBoard(nodes: NodeInfo[], edges: VisualNotesEdge[]): Map<string, Position> {
  const positions = new Map<string, Position>();
  const columns = Math.min(
    FLAT_BOARD_MAX_COLUMNS,
    Math.max(1, Math.ceil(nodes.length / FLAT_BOARD_TARGET_ROWS)),
  );
  const slots = nodes.map((_, index): Position => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    return {
      x: CANVAS_START_X + column * NODE_GAP_X,
      y: CANVAS_START_Y + row * NODE_GAP_Y,
    };
  });
  const orderedNodes = optimizeFlatBoardOrder(nodes, slots, edges);

  orderedNodes.forEach((node, index) => {
    positions.set(node.id, slots[index] ?? node.node.position);
  });

  return positions;
}

function optimizeFlatBoardOrder(
  nodes: NodeInfo[],
  slots: Position[],
  edges: VisualNotesEdge[],
): NodeInfo[] {
  const seeds = [
    nodes,
    [...nodes].sort((left, right) => left.index - right.index),
    [...nodes].sort((left, right) => scoreNode(right) - scoreNode(left) || left.index - right.index),
  ];

  return seeds
    .map((seed) => improveFlatBoardOrder(seed, slots, edges))
    .sort((left, right) => flatBoardCost(left, slots, edges) - flatBoardCost(right, slots, edges))[0];
}

function improveFlatBoardOrder(
  seed: NodeInfo[],
  slots: Position[],
  edges: VisualNotesEdge[],
): NodeInfo[] {
  const order = [...seed];
  let currentCost = flatBoardCost(order, slots, edges);
  let improved = true;
  let pass = 0;

  while (improved && pass < 8) {
    improved = false;
    pass += 1;

    for (let left = 0; left < order.length - 1; left += 1) {
      for (let right = left + 1; right < order.length; right += 1) {
        [order[left], order[right]] = [order[right], order[left]];
        const nextCost = flatBoardCost(order, slots, edges);
        if (nextCost < currentCost) {
          currentCost = nextCost;
          improved = true;
        } else {
          [order[left], order[right]] = [order[right], order[left]];
        }
      }
    }
  }

  return order;
}

function flatBoardCost(order: NodeInfo[], slots: Position[], edges: VisualNotesEdge[]): number {
  const positionById = new Map(order.map((node, index): [string, Position] => [node.id, slots[index]]));
  const primaryEdges = getPrimaryEdges(edges);
  const weakEdges = edges.filter((edge) => edge.classes === "weak-edge");
  const crossingCost = countCrossingsForPositions(positionById, primaryEdges) * 10000;
  const primaryLengthCost = edgeLengthCost(positionById, primaryEdges) * 5;
  const weakLengthCost = edgeLengthCost(positionById, weakEdges);
  const storyOrderCost = order.reduce(
    (cost, node, index) => cost + Math.abs(node.index - index) * 0.5,
    0,
  );

  return crossingCost + primaryLengthCost + weakLengthCost + storyOrderCost;
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

function layoutComponent(component: Component, edges: VisualNotesEdge[]): ComponentLayout {
  const positions = new Map<string, Position>();
  const orderedNodes = orderComponentNodes(component.nodes, edges);
  const columns = columnCountForComponent(orderedNodes.length);

  orderedNodes.forEach((node, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    positions.set(node.id, {
      x: column * NODE_GAP_X,
      y: row * NODE_GAP_Y,
    });
  });

  const normalized = normalizePositions(positions);
  const bounds = boundsForPositions(Array.from(normalized.values()));

  return {
    positions: normalized,
    width: bounds.width,
    height: bounds.height,
  };
}

function orderComponentNodes(nodes: NodeInfo[], edges: VisualNotesEdge[]): NodeInfo[] {
  const anchor = selectAnchor(nodes);
  const remaining = new Map(nodes.filter((node) => node.id !== anchor.id).map((node) => [node.id, node]));
  const ordered = [anchor];

  while (remaining.size > 0) {
    const next = Array.from(remaining.values()).sort((left, right) => {
      const leftConnected = isConnectedToAny(left, ordered, edges) ? 0 : 1;
      const rightConnected = isConnectedToAny(right, ordered, edges) ? 0 : 1;
      return leftConnected - rightConnected || scoreNode(right) - scoreNode(left) || left.index - right.index;
    })[0];
    ordered.push(next);
    remaining.delete(next.id);
  }

  return ordered;
}

function isConnectedToAny(node: NodeInfo, placedNodes: NodeInfo[], edges: VisualNotesEdge[]): boolean {
  const placedIds = new Set(placedNodes.map((placedNode) => placedNode.id));
  return edges.some(
    (edge) =>
      (edge.data.source === node.id && placedIds.has(edge.data.target)) ||
      (edge.data.target === node.id && placedIds.has(edge.data.source)),
  );
}

function columnCountForComponent(nodeCount: number): number {
  if (nodeCount <= 2) {
    return nodeCount;
  }
  if (nodeCount <= 6) {
    return 3;
  }
  return 4;
}

function selectAnchor(nodes: NodeInfo[]): NodeInfo {
  const systems = nodes.filter((node) => node.type === "system");
  return sortNodes(systems.length > 0 ? systems : nodes)[0];
}

function normalizePositions(positions: Map<string, Position>): Map<string, Position> {
  const bounds = boundsForPositions(Array.from(positions.values()));
  const normalized = new Map<string, Position>();

  positions.forEach((position, id) => {
    normalized.set(id, {
      x: Math.round(position.x - bounds.minX),
      y: Math.round(position.y - bounds.minY),
    });
  });

  return normalized;
}

function packComponents(layouts: ComponentLayout[]): Map<string, Position> {
  const packed = new Map<string, Position>();
  let x = CANVAS_START_X;
  let y = CANVAS_START_Y;
  let rowHeight = 0;

  layouts.forEach((layout) => {
    if (x > CANVAS_START_X && x + layout.width - CANVAS_START_X > COMPONENT_ROW_WIDTH) {
      x = CANVAS_START_X;
      y += rowHeight + COMPONENT_GAP_Y;
      rowHeight = 0;
    }

    layout.positions.forEach((position, id) => {
      packed.set(
        id,
        clampPosition({
          x: x + position.x,
          y: y + position.y,
        }),
      );
    });

    x += Math.max(layout.width, NODE_GAP_X) + COMPONENT_GAP_X;
    rowHeight = Math.max(rowHeight, layout.height);
  });

  return packed;
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

function edgeLengthCost(positionById: Map<string, Position>, edges: VisualNotesEdge[]): number {
  return edges.reduce((sum, edge) => {
    const source = positionById.get(edge.data.source);
    const target = positionById.get(edge.data.target);
    return source && target ? sum + distance(source, target) : sum;
  }, 0);
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

function clampPosition(position: Position): Position {
  return {
    x: clamp(Math.round(position.x), VISIBLE_MIN_X, MAX_X),
    y: clamp(Math.round(position.y), VISIBLE_MIN_Y, MAX_Y),
  };
}
