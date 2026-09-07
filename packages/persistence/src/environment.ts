import { z } from "zod";
const optionalUrl = (protocols: string[]) => z.preprocess((x) => x === "" ? undefined : x, z.url().refine((x) => protocols.includes(new URL(x).protocol), "Unsupported connection protocol").optional());
export const EnvironmentSchema = z.object({
  MONGODB_URI: optionalUrl(["mongodb:", "mongodb+srv:"]),
  MONGODB_DATABASE: z.string().regex(/^[a-zA-Z0-9_-]+$/).default("cyberpunk_tcg_content"),
  DATABASE_URL: optionalUrl(["postgres:", "postgresql:"]),
  GRAPHQL_INTERNAL_URL: z.url().default("http://localhost:3000/api/graphql")
});
export type Environment = z.infer<typeof EnvironmentSchema>;
export function parseEnvironment(input: unknown): Environment {
  const result = EnvironmentSchema.safeParse(input);
  if (!result.success) throw new Error("Invalid environment: " + result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return result.data;
}
