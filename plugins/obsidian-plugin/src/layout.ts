import type { VisualNotesEdge, VisualNotesNode, VisualNotesSidecar } from "./schema";

const CANVAS_START_X = 80;
const CANVAS_START_Y = 90;
const STORY_SLOT_X = 200;
const STORY_SLOT_Y = 140;
const COMPONENT_GAP_X = 190;
const COMPONENT_GAP_Y = 110;
const READABLE_CARD_WIDTH = 880;
const READABLE_CARD_HEIGHT = 700;
const FIT_PADDING_X = 80;
const FIT_PADDING_Y = 90;
const COLLISION_RADIUS_X = 170;
const COLLISION_RADIUS_Y = 105;
const NODE_FONT_SIZE = 17;
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

interface LaidOutComponent {
  component: Component;
  layout: ComponentLayout;
}

interface StorySlot extends Position {
  column: number;
  row: number;
  order: number;
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

  return {
    ...sidecar,
    nodes: layoutNodes(sidecar.nodes, sidecar.edges),
  };
}

export function calculateLayoutMetrics(sidecar: VisualNotesSidecar): LayoutMetrics {
  const positions = sidecar.nodes.map((node) => node.position);
  const primaryEdges = getPrimaryEdges(sidecar.edges);
  const weakEdges = sidecar.edges.filter((edge) => edge.classes === "weak-edge");

  if (positions.length === 0) {
    return {
      nodeCount: 0,
      edgeCount: sidecar.edges.length,
      componentCount: 0,
      weakEdgeCount: weakEdges.length,
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

  const minX = Math.min(...positions.map((position) => position.x));
  const maxX = Math.max(...positions.map((position) => position.x));
  const minY = Math.min(...positions.map((position) => position.y));
  const maxY = Math.max(...positions.map((position) => position.y));
  const width = maxX - minX;
  const height = maxY - minY;
  const centroid = calculateCentroid(positions);
  const distances = positions.map((position) => distance(position, centroid));
  const averageDistanceFromCentroid =
    distances.reduce((sum, current) => sum + current, 0) / Math.max(distances.length, 1);
  const infoById = buildInfoById(sidecar.nodes, sidecar.edges);
  const components = findComponents(sidecar.nodes, primaryEdges, infoById);
  const proximity = calculateProximityStats(positions);
  const primaryEdgeLengths = calculateEdgeLengths(sidecar.nodes, primaryEdges);
  const weakEdgeLengths = calculateEdgeLengths(sidecar.nodes, weakEdges);
  const componentStats = calculateComponentStats(components);
  const cardFitScale = Math.min(
    READABLE_CARD_WIDTH / Math.max(width + FIT_PADDING_X, 1),
    READABLE_CARD_HEIGHT / Math.max(height + FIT_PADDING_Y, 1),
  );

  return {
    nodeCount: sidecar.nodes.length,
    edgeCount: sidecar.edges.length,
    componentCount: components.length,
    weakEdgeCount: weakEdges.length,
    minX,
    maxX,
    minY,
    maxY,
    width,
    height,
    aspectRatio: height === 0 ? width : width / height,
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
    estimatedDefaultNodeFontPx: NODE_FONT_SIZE * cardFitScale,
  };
}

function layoutNodes(nodes: VisualNotesNode[], edges: VisualNotesEdge[]): VisualNotesNode[] {
  if (nodes.length === 0) {
    return [];
  }

  const primaryEdges = getPrimaryEdges(edges);
  const infoById = buildInfoById(nodes, edges);
  const components = buildVisualComponents(nodes, primaryEdges, edges, infoById);
  const packedPositions = packStoryClusters(
    components.map((component) => ({
      component,
      layout: layoutStoryCluster(component, primaryEdges),
    })),
  );
  pullWeakAttachmentsClose(packedPositions, components, edges);

  return nodes.map((node) => ({
    ...node,
    position: packedPositions.get(node.data.id) ?? node.position,
  }));
}

function getPrimaryEdges(edges: VisualNotesEdge[]): VisualNotesEdge[] {
  return edges.filter((edge) => edge.classes !== "weak-edge");
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

function layoutStoryCluster(component: Component, edges: VisualNotesEdge[]): ComponentLayout {
  const positions = new Map<string, Position>();

  if (component.nodes.length === 0) {
    return { positions, width: 0, height: 0 };
  }

  const columns = columnCountForComponent(component.nodes.length);
  const rows = Math.ceil(component.nodes.length / columns);
  const slots = createStorySlots(columns, rows);
  const remainingSlots = [...slots];
  const placedSlots = new Map<string, StorySlot>();
  const componentIds = new Set(component.nodes.map((node) => node.id));
  const localEdges = edges.filter(
    (edge) => componentIds.has(edge.data.source) && componentIds.has(edge.data.target),
  );

  orderNodesForStory(component.nodes).forEach((node) => {
    const slot = chooseStorySlot(node, remainingSlots, placedSlots, localEdges);
    remainingSlots.splice(remainingSlots.indexOf(slot), 1);
    placedSlots.set(node.id, slot);
    positions.set(node.id, { x: slot.x, y: slot.y });
  });

  return {
    positions,
    width: Math.max(0, (columns - 1) * STORY_SLOT_X),
    height: Math.max(0, (rows - 1) * STORY_SLOT_Y),
  };
}

function columnCountForComponent(nodeCount: number): number {
  if (nodeCount <= 1) {
    return 1;
  }

  if (nodeCount <= 6) {
    return 2;
  }

  return 3;
}

function createStorySlots(columns: number, rows: number): StorySlot[] {
  const slots: StorySlot[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      slots.push({
        x: column * STORY_SLOT_X,
        y: row * STORY_SLOT_Y,
        column,
        row,
        order: row * columns + column,
      });
    }
  }

  return slots;
}

function chooseStorySlot(
  node: NodeInfo,
  slots: StorySlot[],
  placedSlots: Map<string, StorySlot>,
  edges: VisualNotesEdge[],
): StorySlot {
  const placedNeighborSlots = edges
    .map((edge) => {
      if (edge.data.source === node.id) {
        return placedSlots.get(edge.data.target);
      }

      if (edge.data.target === node.id) {
        return placedSlots.get(edge.data.source);
      }

      return undefined;
    })
    .filter((slot): slot is StorySlot => Boolean(slot));

  if (placedNeighborSlots.length === 0) {
    return [...slots].sort((left, right) => storyLaneCost(node, left) - storyLaneCost(node, right))[0];
  }

  return [...slots].sort((left, right) => {
    const leftCost = storySlotCost(node, left, placedNeighborSlots);
    const rightCost = storySlotCost(node, right, placedNeighborSlots);
    return leftCost - rightCost || left.order - right.order;
  })[0];
}

function storySlotCost(node: NodeInfo, slot: StorySlot, neighborSlots: StorySlot[]): number {
  return (
    neighborSlots.reduce((sum, neighborSlot) => {
      const alignmentPenalty =
        slot.column !== neighborSlot.column && slot.row !== neighborSlot.row ? 85 : 0;
      return sum + distance(slot, neighborSlot) + alignmentPenalty;
    }, 0) +
    storyLaneCost(node, slot) +
    slot.order * 10
  );
}

function storyLaneCost(node: NodeInfo, slot: StorySlot): number {
  const preferredColumn = preferredColumnForNode(node, slot);
  const statusRowPenalty = statusRowPreference(node.status) * slot.row * 8;
  return Math.abs(slot.column - preferredColumn) * 160 + statusRowPenalty;
}

function preferredColumnForNode(node: NodeInfo, slot: StorySlot): number {
  const lastColumn = Math.max(slot.column, 1);
  switch (node.type) {
    case "system":
      return 0;
    case "decision":
      return Math.min(2, lastColumn);
    case "task":
      return Math.min(1, lastColumn);
  }
}

function statusRowPreference(status: NodeStatus): number {
  switch (status) {
    case "active":
      return 0;
    case "context":
      return 1;
    case "blocked":
      return 2;
    case "completed":
      return 3;
  }
}

function packStoryClusters(layouts: LaidOutComponent[]): Map<string, Position> {
  const packedPositions = new Map<string, Position>();
  let rowX = CANVAS_START_X;
  let rowY = CANVAS_START_Y;
  let rowHeight = 0;

  layouts.forEach(({ layout }) => {
    const advanceWidth = Math.max(layout.width, STORY_SLOT_X);
    const wouldExceedRow =
      rowX > CANVAS_START_X && rowX + advanceWidth - CANVAS_START_X > READABLE_CARD_WIDTH;

    if (wouldExceedRow) {
      rowX = CANVAS_START_X;
      rowY += rowHeight + COMPONENT_GAP_Y;
      rowHeight = 0;
    }

    for (const [id, position] of layout.positions.entries()) {
      packedPositions.set(
        id,
        clampPosition({
          x: rowX + position.x,
          y: rowY + position.y,
        }),
      );
    }

    rowX += advanceWidth + COMPONENT_GAP_X;
    rowHeight = Math.max(rowHeight, layout.height);
  });

  return packedPositions;
}

function buildVisualComponents(
  nodes: VisualNotesNode[],
  primaryEdges: VisualNotesEdge[],
  edges: VisualNotesEdge[],
  infoById: Map<string, NodeInfo>,
): Component[] {
  const components = findComponents(nodes, primaryEdges, infoById);
  const storyComponents = components.filter((component) => component.nodes.length > 1);
  const singletonNodes = components
    .filter((component) => component.nodes.length === 1)
    .flatMap((component) => component.nodes);

  if (singletonNodes.length === 0 || storyComponents.length === 0) {
    return components;
  }

  const storyByAnchorId = new Map(
    storyComponents.map((component): [string, NodeInfo[]] => [component.anchorId, [...component.nodes]]),
  );
  const componentByNodeId = new Map<string, Component>();
  storyComponents.forEach((component) => {
    component.nodes.forEach((node) => componentByNodeId.set(node.id, component));
  });

  singletonNodes.forEach((node) => {
    const target = findSingletonStoryTarget(node, storyComponents, componentByNodeId, edges);
    storyByAnchorId.get(target.anchorId)?.push(node);
  });

  return Array.from(storyByAnchorId.entries()).map(([anchorId, storyNodes]) => ({
    nodes: sortNodes(storyNodes),
    score: componentScore(storyNodes),
    anchorId,
  })).sort(
    (a, b) =>
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
      .filter((component) => Math.min(...component.nodes.map((storyNode) => storyNode.index)) <= node.index)
      .sort(
        (a, b) =>
          Math.abs(node.index - maxNodeIndex(a)) - Math.abs(node.index - maxNodeIndex(b)) ||
          b.score - a.score,
      )[0] ?? storyComponents[0]
  );
}

function maxNodeIndex(component: Component): number {
  return Math.max(...component.nodes.map((node) => node.index));
}

function pullWeakAttachmentsClose(
  positionById: Map<string, Position>,
  components: Component[],
  edges: VisualNotesEdge[],
): void {
  const componentIndexById = new Map<string, number>();
  components.forEach((component, componentIndex) => {
    component.nodes.forEach((node) => componentIndexById.set(node.id, componentIndex));
  });

  components.forEach((component, componentIndex) => {
    if (component.nodes.length > 1) {
      return;
    }

    const targetComponent = findWeakAttachmentTarget(component, componentIndex, components, edges, componentIndexById);
    if (!targetComponent) {
      return;
    }

    const componentPositions = component.nodes
      .map((node) => positionById.get(node.id))
      .filter((position): position is Position => Boolean(position));
    const targetPositions = targetComponent.nodes
      .map((node) => positionById.get(node.id))
      .filter((position): position is Position => Boolean(position));

    if (componentPositions.length === 0 || targetPositions.length === 0) {
      return;
    }

    const relativePositions = relativeToTopLeft(componentPositions);
    const componentBounds = boundsForPositions(componentPositions);
    const targetBounds = boundsForPositions(targetPositions);
    const occupied = Array.from(positionById.entries()).filter(
      ([id]) => component.nodes.every((node) => node.id !== id),
    );
    const candidate = attachmentCandidates(targetBounds, componentBounds).find((candidatePosition) =>
      canPlaceAt(candidatePosition, relativePositions, occupied),
    );

    if (!candidate) {
      return;
    }

    component.nodes.forEach((node, nodeIndex) => {
      const relativePosition = relativePositions[nodeIndex];
      positionById.set(
        node.id,
        clampPosition({
          x: candidate.x + relativePosition.x,
          y: candidate.y + relativePosition.y,
        }),
      );
    });
  });
}

function findWeakAttachmentTarget(
  component: Component,
  componentIndex: number,
  components: Component[],
  edges: VisualNotesEdge[],
  componentIndexById: Map<string, number>,
): Component | null {
  const componentIds = new Set(component.nodes.map((node) => node.id));
  const targetIndexes = edges
    .filter((edge) => edge.classes === "weak-edge")
    .map((edge) => {
      if (componentIds.has(edge.data.source)) {
        return componentIndexById.get(edge.data.target);
      }

      if (componentIds.has(edge.data.target)) {
        return componentIndexById.get(edge.data.source);
      }

      return undefined;
    })
    .filter(
      (targetIndex): targetIndex is number =>
        targetIndex !== undefined && targetIndex !== componentIndex,
    );

  if (targetIndexes.length === 0) {
    return null;
  }

  return [...new Set(targetIndexes)]
    .map((targetIndex) => components[targetIndex])
    .sort((a, b) => b.nodes.length - a.nodes.length || b.score - a.score)[0];
}

function attachmentCandidates(targetBounds: Bounds, componentBounds: Bounds): Position[] {
  const width = Math.max(componentBounds.width, STORY_SLOT_X);
  const height = Math.max(componentBounds.height, STORY_SLOT_Y);
  const belowY = targetBounds.maxY + COMPONENT_GAP_Y;
  const rightX = targetBounds.maxX + COMPONENT_GAP_X;
  const leftX = targetBounds.minX - COMPONENT_GAP_X - width;
  const aboveY = targetBounds.minY - COMPONENT_GAP_Y - height;

  return [
    { x: rightX, y: targetBounds.minY },
    { x: leftX, y: targetBounds.minY },
    { x: targetBounds.minX, y: aboveY },
    { x: rightX, y: targetBounds.maxY },
    { x: targetBounds.minX, y: belowY },
    { x: targetBounds.maxX - width, y: belowY },
  ].filter(
    (position) =>
      position.x >= CANVAS_START_X &&
      position.y >= CANVAS_START_Y &&
      position.x + width <= CANVAS_START_X + READABLE_CARD_WIDTH &&
      position.y + height <= CANVAS_START_Y + READABLE_CARD_HEIGHT,
  );
}

function canPlaceAt(
  topLeft: Position,
  relativePositions: Position[],
  occupied: Array<[string, Position]>,
): boolean {
  return relativePositions.every((relativePosition) => {
    const candidate = {
      x: topLeft.x + relativePosition.x,
      y: topLeft.y + relativePosition.y,
    };

    return occupied.every(([, occupiedPosition]) => {
      return (
        Math.abs(candidate.x - occupiedPosition.x) >= COLLISION_RADIUS_X ||
        Math.abs(candidate.y - occupiedPosition.y) >= COLLISION_RADIUS_Y
      );
    });
  });
}

function relativeToTopLeft(positions: Position[]): Position[] {
  const bounds = boundsForPositions(positions);

  return positions.map((position) => ({
    x: position.x - bounds.minX,
    y: position.y - bounds.minY,
  }));
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
    if (!idSet.has(source) || !idSet.has(target)) {
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
        score: componentScore(sortedNodes),
        anchorId: sortedNodes[0]?.id ?? "",
      };
    })
    .sort(
      (a, b) =>
        b.nodes.length - a.nodes.length ||
        b.score - a.score ||
        a.anchorId.localeCompare(b.anchorId),
    );
}

function sortNodes(nodes: NodeInfo[]): NodeInfo[] {
  return [...nodes].sort((a, b) => scoreNode(b) - scoreNode(a) || a.id.localeCompare(b.id));
}

function orderNodesForStory(nodes: NodeInfo[]): NodeInfo[] {
  const anchor = selectStoryAnchor(nodes);
  return [anchor, ...sortNodes(nodes.filter((node) => node.id !== anchor.id))];
}

function selectStoryAnchor(nodes: NodeInfo[]): NodeInfo {
  return (
    [...nodes]
      .filter((node) => node.type === "system")
      .sort((a, b) => a.index - b.index)[0] ?? sortNodes(nodes)[0]
  );
}

function componentScore(nodes: NodeInfo[]): number {
  return nodes.reduce((sum, node) => sum + scoreNode(node), 0);
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

      const minX = Math.min(...positions.map((position) => position.x));
      const maxX = Math.max(...positions.map((position) => position.x));
      const minY = Math.min(...positions.map((position) => position.y));
      const maxY = Math.max(...positions.map((position) => position.y));

      return {
        maxWidth: Math.max(stats.maxWidth, maxX - minX),
        maxHeight: Math.max(stats.maxHeight, maxY - minY),
      };
    },
    { maxWidth: 0, maxHeight: 0 },
  );
}

function countEdgeCrossings(nodes: VisualNotesNode[], edges: VisualNotesEdge[]): number {
  const positionById = new Map(nodes.map((node): [string, Position] => [node.data.id, node.position]));
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
