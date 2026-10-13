/** Read only: relay identity, balance and the configured contract addresses. */
import nextEnv from "@next/env";
import { chain, addresses } from "../lib/chain";
nextEnv.loadEnvConfig(process.cwd());
const client = chain();
const relay = client.account!.address;
console.log("relay", relay);
console.log(
  "balance",
  (await client.getBalance({ address: relay })).toString(),
);
console.log("configured", JSON.stringify(addresses()));
