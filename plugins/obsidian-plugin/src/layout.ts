import type { VisualNotesEdge, VisualNotesNode, VisualNotesSidecar } from "./schema";

const CANVAS_START_X = 90;
const CANVAS_START_Y = 90;
const SEMANTIC_COLUMN_SPACING_X = 170;
const SEMANTIC_ROW_SPACING_Y = 102;
const COMPONENT_GAP_X = 190;
const COMPONENT_GAP_Y = 112;
const SEMANTIC_COLUMN_COUNT = 4;
const MAX_ROWS_PER_COMPONENT_COLUMN = 5;
const COLLISION_RADIUS_X = 155;
const COLLISION_RADIUS_Y = 88;
const READABLE_CARD_WIDTH = 1000;
const READABLE_CARD_HEIGHT = 560;
const FIT_PADDING_X = 120;
const FIT_PADDING_Y = 96;
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
  minNodeDistance: number;
  closePairCount: number;
  edgeCrossingCount: number;
  cardFitScale: number;
}

export function applyDeterministicLayout(sidecar: VisualNotesSidecar): VisualNotesSidecar {
  if (sidecar._pinned) {
    return sidecar;
  }

  const positionedNodes = layoutNodes(sidecar.nodes, sidecar.edges, sidecar.kind);

  return {
    ...sidecar,
    nodes: positionedNodes,
  };
}

export function calculateLayoutMetrics(sidecar: VisualNotesSidecar): LayoutMetrics {
  const positions = sidecar.nodes.map((node) => node.position);

  if (positions.length === 0) {
    return {
      nodeCount: 0,
      edgeCount: sidecar.edges.length,
      componentCount: 0,
      weakEdgeCount: sidecar.edges.filter((edge) => edge.classes === "weak-edge").length,
      minX: 0,
      maxX: 0,
      minY: 0,
      maxY: 0,
      width: 0,
      height: 0,
      aspectRatio: 0,
      averageDistanceFromCentroid: 0,
      maxDistanceFromCentroid: 0,
      minNodeDistance: 0,
      closePairCount: 0,
      edgeCrossingCount: 0,
      cardFitScale: 1,
    };
  }

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
  const proximity = calculateProximityStats(positions);

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
    minNodeDistance: proximity.minNodeDistance,
    closePairCount: proximity.closePairCount,
    edgeCrossingCount: countEdgeCrossings(
      sidecar.nodes,
      sidecar.edges.filter((edge) => edge.classes !== "weak-edge"),
    ),
    cardFitScale: Math.min(
      READABLE_CARD_WIDTH / Math.max(width + FIT_PADDING_X, 1),
      READABLE_CARD_HEIGHT / Math.max(height + FIT_PADDING_Y, 1),
    ),
  };
}

function layoutNodes(
  nodes: VisualNotesNode[],
  edges: VisualNotesEdge[],
  _kind?: VisualNotesSidecar["kind"],
): VisualNotesNode[] {
  if (nodes.length === 0) {
    return [];
  }

  const infoById = buildInfoById(nodes, edges);
  const components = findComponents(nodes, edges, infoById);
  const packedPositions = packComponentLayouts(
    components.map((component) => layoutComponent(component, edges, infoById)),
  );

  return nodes.map((node) => ({
    ...node,
    position: packedPositions.get(node.data.id) ?? node.position,
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
  edges: VisualNotesEdge[],
  infoById: Map<string, NodeInfo>,
): ComponentLayout {
  const positions = new Map<string, Position>();

  if (component.nodes.length === 0) {
    return { positions, width: 0, height: 0 };
  }

  const laneById = assignSemanticLanes(component, edges, infoById);
  const rowLimit = Math.min(
    MAX_ROWS_PER_COMPONENT_COLUMN,
    Math.max(1, Math.ceil(component.nodes.length / SEMANTIC_COLUMN_COUNT)),
  );
  const columns = distributeNodesIntoColumns(component.nodes, laneById, rowLimit);
  orderColumnsByNeighborProximity(columns, edges);
  optimizeColumnOrderForCrossings(
    columns,
    edges.filter((edge) => edge.classes !== "weak-edge"),
  );

  columns.forEach((column, columnIndex) => {
    column.forEach((node, rowIndex) => {
      positions.set(node.id, {
        x: columnIndex * SEMANTIC_COLUMN_SPACING_X,
        y: rowIndex * SEMANTIC_ROW_SPACING_Y,
      });
    });
  });

  return {
    positions,
    width: Math.max(0, (columns.length - 1) * SEMANTIC_COLUMN_SPACING_X),
    height: Math.max(0, (Math.max(...columns.map((column) => column.length), 1) - 1) * SEMANTIC_ROW_SPACING_Y),
  };
}

function packComponentLayouts(layouts: ComponentLayout[]): Map<string, Position> {
  const packedPositions = new Map<string, Position>();
  let rowX = CANVAS_START_X;
  let rowY = CANVAS_START_Y;
  let rowHeight = 0;

  layouts.forEach((layout) => {
    const wouldExceedRow =
      rowX > CANVAS_START_X && rowX + layout.width - CANVAS_START_X > READABLE_CARD_WIDTH;

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

    rowX += layout.width + COMPONENT_GAP_X;
    rowHeight = Math.max(rowHeight, layout.height);
  });

  return packedPositions;
}

function assignSemanticLanes(
  component: Component,
  edges: VisualNotesEdge[],
  infoById: Map<string, NodeInfo>,
): Map<string, number> {
  const componentIds = new Set(component.nodes.map((node) => node.id));
  const laneById = new Map(component.nodes.map((node): [string, number] => [node.id, baseLaneForNode(node)]));

  for (let pass = 0; pass < 3; pass += 1) {
    edges.forEach((edge) => {
      const { source, target } = edge.data;
      if (!componentIds.has(source) || !componentIds.has(target)) {
        return;
      }

      const targetInfo = infoById.get(target);
      if (!targetInfo || targetInfo.type === "system") {
        return;
      }

      const sourceLane = laneById.get(source) ?? 0;
      const targetLane = laneById.get(target) ?? 0;
      laneById.set(target, Math.max(targetLane, Math.min(sourceLane + 1, SEMANTIC_COLUMN_COUNT - 1)));
    });
  }

  return laneById;
}

function baseLaneForNode(node: NodeInfo): number {
  if (node.type === "system") {
    return 0;
  }

  if (node.status === "blocked") {
    return 3;
  }

  if (node.type === "decision") {
    return 2;
  }

  if (node.status === "context") {
    return 3;
  }

  return 1;
}

function distributeNodesIntoColumns(
  nodes: NodeInfo[],
  laneById: Map<string, number>,
  rowLimit: number,
): NodeInfo[][] {
  const columns: NodeInfo[][] = Array.from({ length: SEMANTIC_COLUMN_COUNT }, () => []);
  const overflow: NodeInfo[] = [];
  const orderedNodes = [...nodes].sort(
    (a, b) =>
      (laneById.get(a.id) ?? 0) - (laneById.get(b.id) ?? 0) ||
      scoreNode(b) - scoreNode(a) ||
      a.id.localeCompare(b.id),
  );

  orderedNodes.forEach((node) => {
    const preferredColumn = laneById.get(node.id) ?? 0;
    if (columns[preferredColumn].length < rowLimit) {
      columns[preferredColumn].push(node);
      return;
    }

    overflow.push(node);
  });

  overflow.forEach((node) => {
    const preferredColumn = laneById.get(node.id) ?? 0;
    const column = findColumnForOverflow(columns, preferredColumn, rowLimit);
    columns[column].push(node);
  });

  return trimEmptyTrailingColumns(columns);
}

function findColumnForOverflow(columns: NodeInfo[][], preferredColumn: number, rowLimit: number): number {
  for (let column = preferredColumn + 1; column < columns.length; column += 1) {
    if (columns[column].length < rowLimit) {
      return column;
    }
  }

  for (let column = preferredColumn - 1; column >= 0; column -= 1) {
    if (columns[column].length < rowLimit) {
      return column;
    }
  }

  columns.push([]);
  return columns.length - 1;
}

function trimEmptyTrailingColumns(columns: NodeInfo[][]): NodeInfo[][] {
  const firstNonEmptyColumn = columns.findIndex((column) => column.length > 0);
  if (firstNonEmptyColumn === -1) {
    return [[]];
  }

  let lastNonEmptyColumn = columns.length - 1;
  while (lastNonEmptyColumn > 0 && columns[lastNonEmptyColumn].length === 0) {
    lastNonEmptyColumn -= 1;
  }

  return columns.slice(firstNonEmptyColumn, lastNonEmptyColumn + 1);
}

function orderColumnsByNeighborProximity(columns: NodeInfo[][], edges: VisualNotesEdge[]): void {
  for (let pass = 0; pass < 3; pass += 1) {
    for (let column = 1; column < columns.length; column += 1) {
      sortColumnByNeighborRows(columns[column], columns, edges, column, -1);
    }

    for (let column = columns.length - 2; column >= 0; column -= 1) {
      sortColumnByNeighborRows(columns[column], columns, edges, column, 1);
    }
  }
}

function sortColumnByNeighborRows(
  columnNodes: NodeInfo[],
  columns: NodeInfo[][],
  edges: VisualNotesEdge[],
  columnIndex: number,
  direction: -1 | 1,
): void {
  const rowById = buildColumnRowIndex(columns);
  const idToColumn = buildColumnIndex(columns);

  columnNodes.sort((a, b) => {
    const aNeighborRow = averageNeighborRow(a.id, edges, rowById, idToColumn, columnIndex, direction);
    const bNeighborRow = averageNeighborRow(b.id, edges, rowById, idToColumn, columnIndex, direction);

    if (aNeighborRow !== bNeighborRow) {
      return aNeighborRow - bNeighborRow;
    }

    return scoreNode(b) - scoreNode(a) || a.id.localeCompare(b.id);
  });
}

function buildColumnRowIndex(columns: NodeInfo[][]): Map<string, number> {
  const rowById = new Map<string, number>();
  columns.forEach((column) => {
    column.forEach((node, rowIndex) => rowById.set(node.id, rowIndex));
  });
  return rowById;
}

function buildColumnIndex(columns: NodeInfo[][]): Map<string, number> {
  const columnById = new Map<string, number>();
  columns.forEach((column, columnIndex) => {
    column.forEach((node) => columnById.set(node.id, columnIndex));
  });
  return columnById;
}

function averageNeighborRow(
  id: string,
  edges: VisualNotesEdge[],
  rowById: Map<string, number>,
  columnById: Map<string, number>,
  currentColumn: number,
  direction: -1 | 1,
): number {
  const rows: number[] = [];

  edges.forEach((edge) => {
    const neighborId = edge.data.source === id ? edge.data.target : edge.data.target === id ? edge.data.source : null;
    if (!neighborId) {
      return;
    }

    const neighborColumn = columnById.get(neighborId);
    const neighborRow = rowById.get(neighborId);
    if (neighborColumn === undefined || neighborRow === undefined) {
      return;
    }

    if ((direction === -1 && neighborColumn < currentColumn) || (direction === 1 && neighborColumn > currentColumn)) {
      rows.push(neighborRow);
    }
  });

  if (rows.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  return rows.reduce((sum, row) => sum + row, 0) / rows.length;
}

function optimizeColumnOrderForCrossings(columns: NodeInfo[][], edges: VisualNotesEdge[]): void {
  for (let pass = 0; pass < 4; pass += 1) {
    let improved = false;

    columns.forEach((column) => {
      for (let leftIndex = 0; leftIndex < column.length - 1; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < column.length; rightIndex += 1) {
          const before = countColumnEdgeCrossings(columns, edges);
          swap(column, leftIndex, rightIndex);
          const after = countColumnEdgeCrossings(columns, edges);

          if (after < before) {
            improved = true;
          } else {
            swap(column, leftIndex, rightIndex);
          }
        }
      }
    });

    if (!improved) {
      return;
    }
  }
}

function countColumnEdgeCrossings(columns: NodeInfo[][], edges: VisualNotesEdge[]): number {
  const positionById = new Map<string, Position>();
  columns.forEach((column, columnIndex) => {
    column.forEach((node, rowIndex) => {
      positionById.set(node.id, { x: columnIndex, y: rowIndex });
    });
  });

  let crossings = 0;
  edges.forEach((leftEdge, leftIndex) => {
    const leftSource = positionById.get(leftEdge.data.source);
    const leftTarget = positionById.get(leftEdge.data.target);
    if (!leftSource || !leftTarget) {
      return;
    }

    edges.slice(leftIndex + 1).forEach((rightEdge) => {
      const rightSource = positionById.get(rightEdge.data.source);
      const rightTarget = positionById.get(rightEdge.data.target);
      if (
        rightSource &&
        rightTarget &&
        !edgesShareEndpoint(leftEdge, rightEdge) &&
        segmentsCross(leftSource, leftTarget, rightSource, rightTarget)
      ) {
        crossings += 1;
      }
    });
  });

  return crossings;
}

function swap<T>(items: T[], leftIndex: number, rightIndex: number): void {
  const left = items[leftIndex];
  items[leftIndex] = items[rightIndex];
  items[rightIndex] = left;
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clampPosition(position: Position): Position {
  return {
    x: clamp(Math.round(position.x), VISIBLE_MIN_X, MAX_X),
    y: clamp(Math.round(position.y), VISIBLE_MIN_Y, MAX_Y),
  };
}
