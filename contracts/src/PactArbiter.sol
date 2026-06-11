// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IPactEscrow} from "./interfaces/IPactEscrow.sol";

/// @title PactArbiter
/// @notice Dispute resolver for PactEscrow. A whitelisted juror rules on a
///         disputed deal by setting the payer's share in basis points, with an
///         on-chain reason. Deliberately swappable for a staked / multi-juror
///         panel later without touching the escrow (escrow only knows `arbiter`).
contract PactArbiter is Ownable {
    IPactEscrow public immutable escrow;
    mapping(address => bool) public isJuror;

    event JurorSet(address indexed juror, bool allowed);
    event Ruling(uint256 indexed dealId, address indexed juror, uint16 payerBps, string reason);

    error NotJuror();

    constructor(address escrow_, address owner_) Ownable(owner_) {
        escrow = IPactEscrow(escrow_);
        isJuror[owner_] = true;
        emit JurorSet(owner_, true);
    }

    function setJuror(address juror, bool allowed) external onlyOwner {
        isJuror[juror] = allowed;
        emit JurorSet(juror, allowed);
    }

    /// @param payerBps share returned to the payer (0 = provider wins, 10000 = payer wins).
    function rule(uint256 dealId, uint16 payerBps, string calldata reason) external {
        if (!isJuror[msg.sender]) revert NotJuror();
        escrow.resolve(dealId, payerBps);
        emit Ruling(dealId, msg.sender, payerBps, reason);
    }
}
