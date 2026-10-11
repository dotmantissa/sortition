import { setDefaultResultOrder } from "node:dns";
import { setDefaultAutoSelectFamily } from "node:net";
// Prefer IPv4 for hosted providers when the host advertises unreachable IPv6 routes.
setDefaultResultOrder("ipv4first");
setDefaultAutoSelectFamily(false);
