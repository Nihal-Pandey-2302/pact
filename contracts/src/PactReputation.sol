// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IPactReputation} from "./interfaces/IPactReputation.sol";

/// @title PactReputation
/// @notice On-chain reputation for agents, earned purely through settled escrow
///         deals. Only authorised writers (the PactEscrow contract) may mutate
///         it, so a score cannot be faked, bought, or self-attested.
contract PactReputation is IPactReputation, Ownable {
    struct Record {
        // provider side
        uint64 completed; // delivered and released (incl. disputes won)
        uint64 noShows; // refunded because nothing was delivered in time
        uint64 faulted; // disputes resolved mostly in the payer's favour
        uint128 volume; // total token value settled to this provider
        // payer side
        uint64 paid; // deals funded as a payer
        uint64 frivolous; // disputes this payer raised and lost
    }

    mapping(address => bool) public isWriter;
    mapping(address => Record) private _rep;

    event WriterSet(address indexed writer, bool allowed);
    event Released(address indexed provider, address indexed payer, uint256 amount);
    event Refunded(address indexed provider, address indexed payer, uint256 amount);
    event Resolved(address indexed provider, address indexed payer, uint256 amount, uint16 payerBps);

    error NotWriter();

    modifier onlyWriter() {
        if (!isWriter[msg.sender]) revert NotWriter();
        _;
    }

    constructor(address owner_) Ownable(owner_) {}

    function setWriter(address writer, bool allowed) external onlyOwner {
        isWriter[writer] = allowed;
        emit WriterSet(writer, allowed);
    }

    function recordReleased(address provider, address payer, uint256 amount) external onlyWriter {
        Record storage p = _rep[provider];
        p.completed += 1;
        p.volume += uint128(amount);
        _rep[payer].paid += 1;
        emit Released(provider, payer, amount);
    }

    function recordRefunded(address provider, address payer, uint256 amount) external onlyWriter {
        _rep[provider].noShows += 1;
        _rep[payer].paid += 1;
        emit Refunded(provider, payer, amount);
    }

    function recordResolved(address provider, address payer, uint256 amount, uint16 payerBps)
        external
        onlyWriter
    {
        Record storage p = _rep[provider];
        uint256 providerShare = (amount * (10_000 - payerBps)) / 10_000;
        if (providerShare > 0) p.volume += uint128(providerShare);
        if (payerBps >= 5_000) {
            p.faulted += 1; // provider mostly at fault
        } else {
            p.completed += 1; // provider largely delivered
            _rep[payer].frivolous += 1;
        }
        _rep[payer].paid += 1;
        emit Resolved(provider, payer, amount, payerBps);
    }

    /// @notice Reputation as a 0–10000 score (basis points). 0 == no history.
    /// @dev completed counts positively; no-shows and faults are weighted 2x
    ///      negatively, so one failure costs more than one success earns.
    function score(address agent) public view returns (uint16) {
        Record memory r = _rep[agent];
        uint256 good = r.completed;
        uint256 bad = uint256(r.noShows) + r.faulted;
        if (good + bad == 0) return 0;
        uint256 denom = good + 2 * bad;
        return uint16((good * 10_000) / denom);
    }

    function recordOf(address agent) external view returns (Record memory) {
        return _rep[agent];
    }
}
