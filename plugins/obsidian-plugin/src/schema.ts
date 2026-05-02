import { z } from "zod";

const nodeClassSchema = z
  .string()
  .regex(/^(system|task|decision) (completed|active|context|blocked)$/);

const nodeIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const edgeClassSchema = z.enum(["strong-edge", "weak-edge"]);
const sidecarKindSchema = z.enum(["daily-overview", "session-whiteboard", "rollup"]);

export const graphNodeSchema = z
  .object({
    data: z
      .object({
        id: nodeIdSchema,
        label: z.string().min(1),
      })
      .catchall(z.unknown()),
    classes: nodeClassSchema,
    position: z
      .object({
        x: z.number().min(-200).max(5000),
        y: z.number().min(-200).max(3000),
      })
      .strict(),
  })
  .strict();

export const graphEdgeSchema = z
  .object({
    data: z
      .object({
        source: nodeIdSchema,
        target: nodeIdSchema,
        label: z.string().min(1),
      })
      .catchall(z.unknown()),
    classes: edgeClassSchema.optional(),
  })
  .strict();

export const sidecarSchema = z
  .object({
    kind: sidecarKindSchema.optional(),
    title: z.string().optional(),
    header: z.string().optional(),
    subtitle: z.string().optional(),
    _lastProcessedHash: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
    _extractedBy: z
      .string()
      .regex(/^[a-z][a-z0-9-]*@\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/)
      .optional(),
    _schemaVersion: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
    _pinned: z.boolean().optional(),
    nodes: z.array(graphNodeSchema).min(1).max(50),
    edges: z.array(graphEdgeSchema).max(100),
  })
  .strict()
  .superRefine((graph, ctx) => {
    const ids = new Set(graph.nodes.map((node) => node.data.id));

    graph.edges.forEach((edge, index) => {
      if (!ids.has(edge.data.source)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["edges", index, "data", "source"],
          message: `Unknown source node '${edge.data.source}'.`,
        });
      }

      if (!ids.has(edge.data.target)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["edges", index, "data", "target"],
          message: `Unknown target node '${edge.data.target}'.`,
        });
      }
    });
  });

export type VisualNotesSidecar = z.infer<typeof sidecarSchema>;
export type VisualNotesNode = z.infer<typeof graphNodeSchema>;
export type VisualNotesEdge = z.infer<typeof graphEdgeSchema>;

export function parseSidecar(value: unknown): VisualNotesSidecar {
  return sidecarSchema.parse(value);
}
