// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {PactReputation} from "../src/PactReputation.sol";
import {PactEscrow} from "../src/PactEscrow.sol";
import {PactArbiter} from "../src/PactArbiter.sol";

/// Deploys the full Pact stack and wires it up.
/// Usage:
///   forge script script/Deploy.s.sol --rpc-url pharos_atlantic --broadcast
contract Deploy is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPk);
        uint16 feeBps = uint16(vm.envOr("FEE_BPS", uint256(0)));

        vm.startBroadcast(deployerPk);

        MockUSDC usdc = new MockUSDC();
        PactReputation reputation = new PactReputation(deployer);
        PactEscrow escrow = new PactEscrow(deployer, address(reputation), deployer, feeBps);
        PactArbiter arbiter = new PactArbiter(address(escrow), deployer);

        reputation.setWriter(address(escrow), true);
        escrow.setArbiter(address(arbiter));

        // Seed test USDC so the demo can run immediately.
        usdc.mint(deployer, 1_000e6);
        address payer = vm.envOr("PAYER_ADDRESS", address(0));
        if (payer != address(0)) usdc.mint(payer, 1_000e6);

        vm.stopBroadcast();

        console2.log("# Copy these into .env");
        console2.log("USDC_ADDRESS=%s", address(usdc));
        console2.log("PACT_REPUTATION=%s", address(reputation));
        console2.log("PACT_ESCROW=%s", address(escrow));
        console2.log("PACT_ARBITER=%s", address(arbiter));
    }
}
