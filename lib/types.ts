export interface Product {
  id: string;
  name: string;
  category: string;
  color: string;
  price: number;
  image: string;
  caption: string;
}

export interface EditSpec {
  source: { category: string; color: string; pattern: string; details: string[] };
  keep: string[];
  remove: string[];
  change: Record<string, string>;
  add: string[];
  maxPrice?: number;
  targetCaption: string;
  label: string;
}

export interface Wish {
  id: string;
  deviceId: string;
  spec: EditSpec;
  label: string;
  nearestProductId: string;
  maxPay?: number;
  status: "open" | "found";
  foundProductId?: string;
  demo?: boolean;
  /** Seeded aggregate rows stand in for many shoppers; never shown as live. */
  demoCount?: number;
  ts: number;
}

export interface Event {
  deviceId: string;
  kind: "search" | "full_match" | "no_match" | "wish" | "order";
  label?: string;
  ts: number;
}

export interface Check {
  text: string;
  pass: boolean;
  reason: string;
}

export interface VerifiedResult {
  product: Product;
  checks: Check[];
  allPass: boolean;
  similarity: number;
  retrievalScore: number;
  /** true when the verifier failed/timed out and this is plain retrieval order */
  unverified?: boolean;
}

export type SearchEvent =
  | { stage: "parse" }
  | { stage: "retrieve"; count: number }
  | { stage: "verify"; count: number }
  | {
      stage: "done";
      spec: EditSpec;
      results: VerifiedResult[];
      fullMatchCount: number;
      nearestProductId: string | null;
      verified: boolean;
      timings: Record<string, number>;
      photoDiscarded: boolean;
    }
  | { stage: "error"; error: string; code?: string };
