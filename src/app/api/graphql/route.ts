import { startServerAndCreateNextHandler } from "@as-integrations/next";
import type { NextRequest } from "next/server";
import { apolloServer } from "@/graphql/server";

const handler = startServerAndCreateNextHandler<NextRequest>(apolloServer);

// Export only the App Router signature; do not forward its context as a Pages response.
export function GET(request: NextRequest): Promise<Response> {
  return handler(request);
}

export function POST(request: NextRequest): Promise<Response> {
  return handler(request);
}
