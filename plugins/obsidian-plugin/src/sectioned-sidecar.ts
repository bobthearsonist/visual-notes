import type { MarkdownSectionSummary } from "./sections";
import type { VisualNotesEdge, VisualNotesNode, VisualNotesSectionMetadata, VisualNotesSidecar } from "./schema";

interface MergeSectionedGraphOptions {
  extracted: Pick<VisualNotesSidecar, "nodes" | "edges">;
  existing: VisualNotesSidecar | null;
  sections: MarkdownSectionSummary[];
  force: boolean;
}

interface MergeSectionedGraphResult {
  nodes: VisualNotesNode[];
  edges: VisualNotesEdge[];
  sections: VisualNotesSectionMetadata[];
}

export function mergeSectionedGraph(options: MergeSectionedGraphOptions): MergeSectionedGraphResult {
  const sectionIds = new Set(options.sections.map((section) => section.id));
  const fallbackSectionId = fallbackSectionIdFor(options.sections);
  const extractedNodes = normalizeNodeSectionReferences(
    cloneNodes(options.extracted.nodes),
    sectionIds,
    fallbackSectionId,
  );
  const extractedEdges = withStableEdgeIds(
    normalizeEdgeSectionReferences(options.extracted.edges, sectionIds, fallbackSectionId),
  );
  const existingSections = options.existing?._sections ?? null;

  if (!options.existing || !existingSections || options.force) {
    return buildResult(options.sections, extractedNodes, extractedEdges);
  }

  const currentSectionsById = new Map(options.sections.map((section) => [section.id, section]));
  const unchangedSectionIds = new Set(
    existingSections
      .filter((section) => currentSectionsById.get(section.id)?.hash === section.hash)
      .map((section) => section.id),
  );

  if (unchangedSectionIds.size === 0) {
    return buildResult(options.sections, extractedNodes, extractedEdges);
  }

  const existingNodesById = new Map(options.existing.nodes.map((node) => [node.data.id, node]));
  const existingEdgesById = new Map(withStableEdgeIds(options.existing.edges).map((edge) => [edgeId(edge), edge]));
  const preservedAssignments = assignmentsFromSectionMetadata(existingSections);
  const retainedNodeIds = new Set<string>();
  const nodes: VisualNotesNode[] = [];

  for (const section of existingSections) {
    if (!unchangedSectionIds.has(section.id)) {
      continue;
    }

    for (const nodeId of section.nodeIds) {
      const node = existingNodesById.get(nodeId);
      if (node && !retainedNodeIds.has(node.data.id)) {
        nodes.push(cloneNode(node));
        retainedNodeIds.add(node.data.id);
      }
    }
  }

  for (const node of extractedNodes) {
    const sectionId = sectionIdFromData(node.data);
    if (sectionId && unchangedSectionIds.has(sectionId)) {
      continue;
    }

    if (!retainedNodeIds.has(node.data.id)) {
      nodes.push(node);
      retainedNodeIds.add(node.data.id);
    }
  }

  const retainedEdgeIds = new Set<string>();
  const edges: VisualNotesEdge[] = [];

  for (const section of existingSections) {
    if (!unchangedSectionIds.has(section.id)) {
      continue;
    }

    for (const id of section.edgeIds) {
      const edge = existingEdgesById.get(id);
      if (edge && hasRetainedEndpoints(edge, retainedNodeIds) && !retainedEdgeIds.has(edgeId(edge))) {
        edges.push(cloneEdge(edge));
        retainedEdgeIds.add(edgeId(edge));
      }
    }
  }

  const extractedAssignments = assignmentsFromNodeData(extractedNodes);
  const nodeAssignments = new Map([...preservedAssignments, ...extractedAssignments]);

  for (const edge of extractedEdges) {
    if (!hasRetainedEndpoints(edge, retainedNodeIds)) {
      continue;
    }

    const sectionId = sectionIdFromData(edge.data) ?? nodeAssignments.get(edge.data.source) ?? null;
    if (sectionId && unchangedSectionIds.has(sectionId)) {
      continue;
    }

    if (!retainedEdgeIds.has(edgeId(edge))) {
      edges.push(edge);
      retainedEdgeIds.add(edgeId(edge));
    }
  }

  if (nodes.length > 50 || edges.length > 100) {
    return buildResult(options.sections, extractedNodes, extractedEdges);
  }

  return buildResult(options.sections, nodes, edges, preservedAssignments);
}

function buildResult(
  sections: MarkdownSectionSummary[],
  nodes: VisualNotesNode[],
  edges: VisualNotesEdge[],
  preservedAssignments = new Map<string, string>(),
): MergeSectionedGraphResult {
  const nodeAssignments = new Map([...preservedAssignments, ...assignmentsFromNodeData(nodes)]);
  const edgeAssignments = assignmentsFromEdgeData(edges, nodeAssignments);

  return {
    nodes,
    edges,
    sections: sections.map((section) => ({
      id: section.id,
      title: section.title,
      level: section.level,
      ordinal: section.ordinal,
      startLine: section.startLine,
      endLine: section.endLine,
      hash: section.hash,
      nodeIds: nodes
        .filter((node) => nodeAssignments.get(node.data.id) === section.id)
        .map((node) => node.data.id),
      edgeIds: edges.filter((edge) => edgeAssignments.get(edgeId(edge)) === section.id).map((edge) => edgeId(edge)),
    })),
  };
}

function assignmentsFromSectionMetadata(sections: VisualNotesSectionMetadata[]): Map<string, string> {
  const assignments = new Map<string, string>();
  for (const section of sections) {
    for (const nodeId of section.nodeIds) {
      assignments.set(nodeId, section.id);
    }
  }

  return assignments;
}

function assignmentsFromNodeData(nodes: VisualNotesNode[]): Map<string, string> {
  const assignments = new Map<string, string>();
  for (const node of nodes) {
    const sectionId = sectionIdFromData(node.data);
    if (sectionId) {
      assignments.set(node.data.id, sectionId);
    }
  }

  return assignments;
}

function assignmentsFromEdgeData(edges: VisualNotesEdge[], nodeAssignments: Map<string, string>): Map<string, string> {
  const assignments = new Map<string, string>();
  for (const edge of edges) {
    const sectionId = sectionIdFromData(edge.data) ?? nodeAssignments.get(edge.data.source);
    if (sectionId) {
      assignments.set(edgeId(edge), sectionId);
    }
  }

  return assignments;
}

function withStableEdgeIds(edges: VisualNotesEdge[]): VisualNotesEdge[] {
  const used = new Set<string>();
  return edges.map((edge) => {
    const existingId = stringFromData(edge.data, "id");
    const baseId = existingId && isSlug(existingId) ? existingId : edgeBaseId(edge);
    const id = uniqueSlug(baseId, used);
    return {
      ...edge,
      data: {
        ...edge.data,
        id,
      },
    };
  });
}

function edgeBaseId(edge: VisualNotesEdge): string {
  return slugify(`edge-${edge.data.source}-${edge.data.target}-${edge.data.label}`);
}

function uniqueSlug(baseId: string, used: Set<string>): string {
  let id = baseId || "edge";
  let suffix = 2;
  while (used.has(id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

function hasRetainedEndpoints(edge: VisualNotesEdge, retainedNodeIds: Set<string>): boolean {
  return retainedNodeIds.has(edge.data.source) && retainedNodeIds.has(edge.data.target);
}

function edgeId(edge: VisualNotesEdge): string {
  return stringFromData(edge.data, "id") ?? edgeBaseId(edge);
}

function sectionIdFromData(data: object): string | null {
  const sectionId = stringFromData(data, "sectionId");
  return sectionId && isSlug(sectionId) ? sectionId : null;
}

function normalizeNodeSectionReferences(
  nodes: VisualNotesNode[],
  sectionIds: Set<string>,
  fallbackSectionId: string | null,
): VisualNotesNode[] {
  return nodes.map((node) => {
    const sectionId = sectionIdFromData(node.data);
    if (sectionId && sectionIds.has(sectionId)) {
      return node;
    }

    const data = { ...node.data };
    delete data.sectionId;
    if (fallbackSectionId) {
      data.sectionId = fallbackSectionId;
    }

    return { ...node, data };
  });
}

function normalizeEdgeSectionReferences(
  edges: VisualNotesEdge[],
  sectionIds: Set<string>,
  fallbackSectionId: string | null,
): VisualNotesEdge[] {
  return edges.map((edge) => {
    const sectionId = sectionIdFromData(edge.data);
    if (sectionId && sectionIds.has(sectionId)) {
      return cloneEdge(edge);
    }

    const data = { ...edge.data };
    delete data.sectionId;
    if (fallbackSectionId) {
      data.sectionId = fallbackSectionId;
    }

    return { ...edge, data };
  });
}

function fallbackSectionIdFor(sections: MarkdownSectionSummary[]): string | null {
  if (sections.length === 1) {
    return sections[0].id;
  }

  const nonDocumentSections = sections.filter((section) => section.id !== "document");
  return nonDocumentSections.length === 1 ? nonDocumentSections[0].id : null;
}

function stringFromData(data: object, key: string): string | null {
  const value = (data as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function cloneNodes(nodes: VisualNotesNode[]): VisualNotesNode[] {
  return nodes.map((node) => cloneNode(node));
}

function cloneNode(node: VisualNotesNode): VisualNotesNode {
  return {
    ...node,
    data: { ...node.data },
    position: { ...node.position },
  };
}

function cloneEdge(edge: VisualNotesEdge): VisualNotesEdge {
  return {
    ...edge,
    data: { ...edge.data },
  };
}

function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "edge";
}

function isSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}
