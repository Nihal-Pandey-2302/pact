// Hand-written ABI fragments (as const for viem type inference). Only the
// functions/events Pact's TypeScript actually calls — kept in sync with the
// Solidity in contracts/src.

export const mockUsdcAbi = [
  {type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{type: "string"}]},
  {type: "function", name: "decimals", stateMutability: "pure", inputs: [], outputs: [{type: "uint8"}]},
  {type: "function", name: "DOMAIN_SEPARATOR", stateMutability: "view", inputs: [], outputs: [{type: "bytes32"}]},
  {type: "function", name: "balanceOf", stateMutability: "view", inputs: [{name: "a", type: "address"}], outputs: [{type: "uint256"}]},
  {type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{name: "spender", type: "address"}, {name: "value", type: "uint256"}], outputs: [{type: "bool"}]},
  {type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{name: "to", type: "address"}, {name: "amount", type: "uint256"}], outputs: []},
] as const;

export const pactEscrowAbi = [
  {
    type: "function",
    name: "open",
    stateMutability: "nonpayable",
    inputs: [
      {name: "provider", type: "address"},
      {name: "token", type: "address"},
      {name: "amount", type: "uint256"},
      {name: "requestHash", type: "bytes32"},
      {name: "deliverBy", type: "uint64"},
      {name: "reviewWindow", type: "uint32"},
    ],
    outputs: [{name: "id", type: "uint256"}],
  },
  {
    type: "function",
    name: "openWithAuthorization",
    stateMutability: "nonpayable",
    inputs: [
      {name: "provider", type: "address"},
      {name: "token", type: "address"},
      {name: "amount", type: "uint256"},
      {name: "requestHash", type: "bytes32"},
      {name: "deliverBy", type: "uint64"},
      {name: "reviewWindow", type: "uint32"},
      {name: "payer", type: "address"},
      {name: "validAfter", type: "uint256"},
      {name: "validBefore", type: "uint256"},
      {name: "v", type: "uint8"},
      {name: "r", type: "bytes32"},
      {name: "s", type: "bytes32"},
    ],
    outputs: [{name: "id", type: "uint256"}],
  },
  {type: "function", name: "deliver", stateMutability: "nonpayable", inputs: [{name: "id", type: "uint256"}, {name: "resultHash", type: "bytes32"}], outputs: []},
  {type: "function", name: "release", stateMutability: "nonpayable", inputs: [{name: "id", type: "uint256"}], outputs: []},
  {type: "function", name: "refundExpired", stateMutability: "nonpayable", inputs: [{name: "id", type: "uint256"}], outputs: []},
  {type: "function", name: "dispute", stateMutability: "nonpayable", inputs: [{name: "id", type: "uint256"}], outputs: []},
  {type: "function", name: "resolveTimeout", stateMutability: "nonpayable", inputs: [{name: "id", type: "uint256"}], outputs: []},
  {type: "function", name: "lastDealId", stateMutability: "view", inputs: [], outputs: [{type: "uint256"}]},
  {type: "function", name: "arbiterWindow", stateMutability: "view", inputs: [], outputs: [{type: "uint32"}]},
  {type: "function", name: "feeBps", stateMutability: "view", inputs: [], outputs: [{type: "uint16"}]},
  {
    type: "function",
    name: "authNonce",
    stateMutability: "view",
    inputs: [
      {name: "payer", type: "address"},
      {name: "provider", type: "address"},
      {name: "token", type: "address"},
      {name: "amount", type: "uint256"},
      {name: "requestHash", type: "bytes32"},
      {name: "deliverBy", type: "uint64"},
      {name: "reviewWindow", type: "uint32"},
    ],
    outputs: [{type: "bytes32"}],
  },
  {
    type: "function",
    name: "getDeal",
    stateMutability: "view",
    inputs: [{name: "id", type: "uint256"}],
    outputs: [
      {
        type: "tuple",
        components: [
          {name: "payer", type: "address"},
          {name: "provider", type: "address"},
          {name: "token", type: "address"},
          {name: "amount", type: "uint256"},
          {name: "requestHash", type: "bytes32"},
          {name: "resultHash", type: "bytes32"},
          {name: "deliverBy", type: "uint64"},
          {name: "reviewUntil", type: "uint64"},
          {name: "resolveBy", type: "uint64"},
          {name: "reviewWindow", type: "uint32"},
          {name: "state", type: "uint8"},
        ],
      },
    ],
  },
  {
    type: "event",
    name: "DealOpened",
    inputs: [
      {name: "id", type: "uint256", indexed: true},
      {name: "payer", type: "address", indexed: true},
      {name: "provider", type: "address", indexed: true},
      {name: "token", type: "address", indexed: false},
      {name: "amount", type: "uint256", indexed: false},
      {name: "requestHash", type: "bytes32", indexed: false},
      {name: "deliverBy", type: "uint64", indexed: false},
      {name: "reviewWindow", type: "uint32", indexed: false},
    ],
  },
  {type: "event", name: "Delivered", inputs: [{name: "id", type: "uint256", indexed: true}, {name: "resultHash", type: "bytes32", indexed: false}, {name: "reviewUntil", type: "uint64", indexed: false}]},
  {type: "event", name: "Released", inputs: [{name: "id", type: "uint256", indexed: true}, {name: "provider", type: "address", indexed: true}, {name: "net", type: "uint256", indexed: false}, {name: "fee", type: "uint256", indexed: false}]},
  {type: "event", name: "Refunded", inputs: [{name: "id", type: "uint256", indexed: true}, {name: "payer", type: "address", indexed: true}, {name: "amount", type: "uint256", indexed: false}]},
  {type: "event", name: "Disputed", inputs: [{name: "id", type: "uint256", indexed: true}, {name: "resolveBy", type: "uint64", indexed: false}]},
  {type: "event", name: "Resolved", inputs: [{name: "id", type: "uint256", indexed: true}, {name: "payerBps", type: "uint16", indexed: false}, {name: "toPayer", type: "uint256", indexed: false}, {name: "toProvider", type: "uint256", indexed: false}, {name: "fee", type: "uint256", indexed: false}]},
] as const;

export const pactReputationAbi = [
  {type: "function", name: "score", stateMutability: "view", inputs: [{name: "agent", type: "address"}], outputs: [{type: "uint16"}]},
  {type: "function", name: "isWriter", stateMutability: "view", inputs: [{name: "w", type: "address"}], outputs: [{type: "bool"}]},
  {
    type: "function",
    name: "recordOf",
    stateMutability: "view",
    inputs: [{name: "agent", type: "address"}],
    outputs: [
      {
        type: "tuple",
        components: [
          {name: "completed", type: "uint64"},
          {name: "noShows", type: "uint64"},
          {name: "faulted", type: "uint64"},
          {name: "volume", type: "uint128"},
          {name: "paid", type: "uint64"},
          {name: "frivolous", type: "uint64"},
        ],
      },
    ],
  },
] as const;

export const pactArbiterAbi = [
  {type: "function", name: "rule", stateMutability: "nonpayable", inputs: [{name: "dealId", type: "uint256"}, {name: "payerBps", type: "uint16"}, {name: "reason", type: "string"}], outputs: []},
  {type: "function", name: "setJuror", stateMutability: "nonpayable", inputs: [{name: "juror", type: "address"}, {name: "allowed", type: "bool"}], outputs: []},
  {type: "function", name: "isJuror", stateMutability: "view", inputs: [{name: "j", type: "address"}], outputs: [{type: "bool"}]},
] as const;
