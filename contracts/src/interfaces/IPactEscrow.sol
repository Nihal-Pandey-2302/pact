// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IPactEscrow {
    function resolve(uint256 dealId, uint16 payerBps) external;
}
