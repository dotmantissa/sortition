import { z } from "zod";
import { maximumSponsoredPayment } from "./sponsor-limits";
export const sourceSchema = z.object({
  content_sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  name: z.string().trim().min(1).max(120),
  url: z
    .url()
    .max(2048)
    .refine((u) => new URL(u).protocol === "https:", "Use an HTTPS source"),
});
export const specificationSchema = z
  .object({
    question: z.string().trim().min(10).max(1000),
    criteria: z.string().trim().min(10).max(10000),
    unresolvable_definition: z.string().trim().min(10).max(10000),
    sources: z.array(sourceSchema).min(2).max(5),
    tie_break_url: z.url(),
    disagreement_rule: z.enum(["unanimous", "majority", "tie_break"]),
    close_timestamp: z.number().int().positive(),
    observation_timestamp: z.number().int().positive().optional(),
    resolution_timestamp: z.number().int().positive().optional(),
    evidence_mode: z
      .enum(["event_outcome", "historical_state"])
      .default("event_outcome"),
    venue: z
      .object({
        name: z.string().max(100),
        market_id: z.string().max(200),
        url: z.url().refine((u) => new URL(u).protocol === "https:"),
        open_interest_usd: z.number().nonnegative().optional(),
      })
      .optional(),
  })
  .superRefine((s, c) => {
    const observation = s.observation_timestamp ?? s.close_timestamp;
    const resolution = s.resolution_timestamp ?? observation;
    if (observation < s.close_timestamp || resolution < observation)
      c.addIssue({
        code: "custom",
        message:
          "Trading close, observation and resolution times must be ordered",
        path: ["resolution_timestamp"],
      });
    if (
      s.evidence_mode === "historical_state" &&
      s.sources.some((source) => !source.content_sha256)
    )
      c.addIssue({
        code: "custom",
        message: "Historical state requires immutable source snapshot hashes",
        path: ["sources"],
      });
    if (new Set(s.sources.map((x) => x.url)).size !== s.sources.length)
      c.addIssue({
        code: "custom",
        message: "Each source must be different",
        path: ["sources"],
      });
    if (!s.sources.some((x) => x.url === s.tie_break_url))
      c.addIssue({
        code: "custom",
        message: "Choose a registered tie source",
        path: ["tie_break_url"],
      });
  })
  .transform((s) => ({
    ...s,
    observation_timestamp: s.observation_timestamp ?? s.close_timestamp,
    resolution_timestamp:
      s.resolution_timestamp ?? s.observation_timestamp ?? s.close_timestamp,
  }));
export const registrationSchema = z
  .object({
    specification: specificationSchema,
    fee: z.string().regex(/^\d+$/).default("0"),
    base_bond: z
      .string()
      .regex(/^[1-9]\d*$/)
      .default("1"),
    webhook: z
      .object({ url: z.url(), secret: z.string().min(24).max(256) })
      .optional(),
  })
  .superRefine((s, c) => {
    if (
      /^\d+$/.test(s.fee) &&
      /^[1-9]\d*$/.test(s.base_bond) &&
      (BigInt(s.fee) > maximumSponsoredPayment ||
        BigInt(s.base_bond) > maximumSponsoredPayment)
    )
      c.addIssue({
        code: "custom",
        message: "Fee or bond exceeds the relay limit",
      });
  });
export function closingIsFuture(timestamp: number, now = Date.now()) {
  return timestamp >= Math.floor(now / 1000) + 60;
}
