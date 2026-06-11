// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Reputation hooks invoked by PactEscrow on terminal deal states.
/// @dev Scores are a side effect of real, settled escrow deals — never
///      self-reported. Only the escrow is authorised to call these.
interface IPactReputation {
    function recordReleased(address provider, address payer, uint256 amount) external;
    function recordRefunded(address provider, address payer, uint256 amount) external;
    function recordResolved(address provider, address payer, uint256 amount, uint16 payerBps) external;
}
