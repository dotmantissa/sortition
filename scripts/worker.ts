import nextEnv from "@next/env";
import { workerTick } from "../lib/worker";
nextEnv.loadEnvConfig(process.cwd());
console.log(
  "Sortition worker started. One serialized network operation per tick.",
);
let stop = false;
process.on("SIGINT", () => {
  stop = true;
});
process.on("SIGTERM", () => {
  stop = true;
});
while (!stop) {
  try {
    const r = await workerTick();
    if (r.processed) console.log("Processed operation", r.processed);
  } catch {
    console.error(
      "Worker tick failed. No credentials or raw RPC errors were logged.",
    );
  }
  if (!stop) await new Promise((r) => setTimeout(r, 10000));
}
