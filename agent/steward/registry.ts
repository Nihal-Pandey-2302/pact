// Provider discovery. In production this is a lookup against Anvita Flow's agent
// registry (the on-chain agentic collaboration network Pharos builds on); here it's
// a static list the demo populates. Each entry is an escrow-protected endpoint the
// Steward can buy from, plus the on-chain address whose reputation it carries.

import {type Address} from "viem";

export interface Provider {
  name: string;
  url: string; // escrow-protected resource, e.g. http://host/price
  address: Address; // provider's on-chain identity (reputation is keyed on this)
}
