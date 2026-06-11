// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PactEscrow} from "../src/PactEscrow.sol";
import {PactReputation} from "../src/PactReputation.sol";
import {PactArbiter} from "../src/PactArbiter.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

contract PactTest is Test {
    PactReputation rep;
    PactEscrow escrow;
    PactArbiter arbiter;
    MockUSDC usdc;

    uint256 payerPk = 0xA11CE;
    address payer;
    address provider = address(0xB0B);
    address feeRecipient = address(0xFEE);
    address relayer = address(0xCAFE); // the facilitator, in the gasless path

    bytes32 reqHash = keccak256("x402:GET /price?symbol=BTC");
    bytes32 resultHash = keccak256("{\"price\":\"64000.00\"}");

    uint256 constant AMT = 100e6; // 100 USDC
    uint64 deliverBy;
    uint32 constant REVIEW = 1 hours;

    function setUp() public {
        payer = vm.addr(payerPk);
        deliverBy = uint64(block.timestamp + 1 days);

        rep = new PactReputation(address(this));
        escrow = new PactEscrow(address(this), address(rep), feeRecipient, 0);
        arbiter = new PactArbiter(address(escrow), address(this));

        rep.setWriter(address(escrow), true);
        escrow.setArbiter(address(arbiter));

        usdc = new MockUSDC();
        usdc.mint(payer, 1_000_000e6);
    }

    // --- helpers ---

    function _openDirect() internal returns (uint256 id) {
        vm.startPrank(payer);
        usdc.approve(address(escrow), AMT);
        id = escrow.open(provider, address(usdc), AMT, reqHash, deliverBy, REVIEW);
        vm.stopPrank();
    }

    function _signReceive(uint256 value, bytes32 nonce, uint256 validBefore)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                usdc.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(),
                payer,
                address(escrow),
                value,
                uint256(0),
                validBefore,
                nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(payerPk, digest);
    }

    // --- happy path: direct funding ---

    function test_directFlow_release() public {
        uint256 id = _openDirect();
        assertEq(usdc.balanceOf(address(escrow)), AMT, "escrow funded");

        vm.prank(provider);
        escrow.deliver(id, resultHash);

        vm.prank(payer);
        escrow.release(id);

        assertEq(usdc.balanceOf(provider), AMT, "provider paid in full");
        assertEq(usdc.balanceOf(address(escrow)), 0, "no funds stuck");
        assertEq(rep.score(provider), 10_000, "perfect score");
        assertEq(rep.recordOf(provider).completed, 1);
        assertEq(rep.recordOf(payer).paid, 1);
    }

    // --- gasless path: EIP-3009, relayed by the facilitator ---

    function test_gaslessFlow_release() public {
        bytes32 nonce = escrow.authNonce(payer, provider, address(usdc), AMT, reqHash, deliverBy, REVIEW);
        (uint8 v, bytes32 r, bytes32 s) = _signReceive(AMT, nonce, block.timestamp + 1 hours);

        // Payer signs nothing on-chain; the relayer submits the funding tx.
        vm.prank(relayer);
        uint256 id = escrow.openWithAuthorization(
            provider, address(usdc), AMT, reqHash, deliverBy, REVIEW, payer, 0, block.timestamp + 1 hours, v, r, s
        );

        assertEq(usdc.balanceOf(address(escrow)), AMT, "pulled via signature");
        assertEq(escrow.getDeal(id).payer, payer);

        vm.prank(provider);
        escrow.deliver(id, resultHash);
        vm.prank(payer);
        escrow.release(id);

        assertEq(usdc.balanceOf(provider), AMT);
    }

    function test_gasless_nonceBindingRejectsTamper() public {
        // Sign for AMT, but the relayer tries to open a deal for 2*AMT.
        bytes32 nonce = escrow.authNonce(payer, provider, address(usdc), AMT, reqHash, deliverBy, REVIEW);
        (uint8 v, bytes32 r, bytes32 s) = _signReceive(AMT, nonce, block.timestamp + 1 hours);

        vm.prank(relayer);
        vm.expectRevert(MockUSDC.InvalidSignature.selector); // recomputed nonce != signed nonce
        escrow.openWithAuthorization(
            provider, address(usdc), 2 * AMT, reqHash, deliverBy, REVIEW, payer, 0, block.timestamp + 1 hours, v, r, s
        );
    }

    // --- provider no-show ---

    function test_refundExpired() public {
        uint256 id = _openDirect();
        vm.warp(deliverBy + 1);

        escrow.refundExpired(id); // permissionless
        assertEq(usdc.balanceOf(payer), 1_000_000e6, "payer made whole");
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(rep.recordOf(provider).noShows, 1);
        assertEq(rep.score(provider), 0);
    }

    function test_cannotRefundBeforeDeadline() public {
        uint256 id = _openDirect();
        vm.expectRevert(PactEscrow.TooEarly.selector);
        escrow.refundExpired(id);
    }

    // --- auto-release after the review window ---

    function test_autoReleaseAfterReviewWindow() public {
        uint256 id = _openDirect();
        vm.prank(provider);
        escrow.deliver(id, resultHash);

        vm.warp(block.timestamp + REVIEW + 1);
        vm.prank(relayer); // anyone can finalise once the window passes
        escrow.release(id);
        assertEq(usdc.balanceOf(provider), AMT);
    }

    function test_strangerCannotReleaseDuringReview() public {
        uint256 id = _openDirect();
        vm.prank(provider);
        escrow.deliver(id, resultHash);

        vm.prank(relayer);
        vm.expectRevert(PactEscrow.TooEarly.selector);
        escrow.release(id);
    }

    // --- dispute + arbiter ruling ---

    function test_disputeResolvedForPayer() public {
        uint256 id = _openDirect();
        vm.prank(provider);
        escrow.deliver(id, resultHash);
        vm.prank(payer);
        escrow.dispute(id);

        // Juror rules 70% back to the payer.
        arbiter.rule(id, 7_000, "result did not match request");

        assertEq(usdc.balanceOf(payer), 1_000_000e6 - AMT + (AMT * 7_000 / 10_000));
        assertEq(usdc.balanceOf(provider), AMT * 3_000 / 10_000);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(rep.recordOf(provider).faulted, 1, "provider at fault");
    }

    function test_disputeResolvedForProvider() public {
        uint256 id = _openDirect();
        vm.prank(provider);
        escrow.deliver(id, resultHash);
        vm.prank(payer);
        escrow.dispute(id);

        arbiter.rule(id, 0, "delivery was valid; payer frivolous");
        assertEq(usdc.balanceOf(provider), AMT);
        assertEq(rep.recordOf(provider).completed, 1);
        assertEq(rep.recordOf(payer).frivolous, 1);
    }

    function test_resolveTimeoutSplits5050() public {
        uint256 id = _openDirect();
        vm.prank(provider);
        escrow.deliver(id, resultHash);
        vm.prank(payer);
        escrow.dispute(id);

        vm.warp(block.timestamp + escrow.arbiterWindow() + 1);
        escrow.resolveTimeout(id); // permissionless safety valve
        assertEq(usdc.balanceOf(provider), AMT / 2);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    // --- access control ---

    function test_onlyProviderDelivers() public {
        uint256 id = _openDirect();
        vm.prank(relayer);
        vm.expectRevert(PactEscrow.NotProvider.selector);
        escrow.deliver(id, resultHash);
    }

    function test_onlyPayerDisputes() public {
        uint256 id = _openDirect();
        vm.prank(provider);
        escrow.deliver(id, resultHash);
        vm.prank(relayer);
        vm.expectRevert(PactEscrow.NotPayer.selector);
        escrow.dispute(id);
    }

    function test_onlyArbiterResolves() public {
        uint256 id = _openDirect();
        vm.prank(provider);
        escrow.deliver(id, resultHash);
        vm.prank(payer);
        escrow.dispute(id);

        vm.prank(relayer);
        vm.expectRevert(PactEscrow.NotArbiter.selector);
        escrow.resolve(id, 5_000);
    }

    function test_deliverAfterDeadlineReverts() public {
        uint256 id = _openDirect();
        vm.warp(deliverBy + 1);
        vm.prank(provider);
        vm.expectRevert(PactEscrow.DeadlinePassed.selector);
        escrow.deliver(id, resultHash);
    }

    function test_reputationOnlyWriter() public {
        vm.expectRevert(PactReputation.NotWriter.selector);
        rep.recordReleased(provider, payer, AMT);
    }

    // --- protocol fee ---

    function test_protocolFeeOnRelease() public {
        escrow.setFee(100); // 1%
        uint256 id = _openDirect();
        vm.prank(provider);
        escrow.deliver(id, resultHash);
        vm.prank(payer);
        escrow.release(id);

        assertEq(usdc.balanceOf(feeRecipient), AMT * 100 / 10_000);
        assertEq(usdc.balanceOf(provider), AMT - (AMT * 100 / 10_000));
    }

    function test_feeCappedAtMax() public {
        uint16 tooHigh = escrow.MAX_FEE_BPS() + 1; // hoist: expectRevert binds to the very next call
        vm.expectRevert(PactEscrow.BadParams.selector);
        escrow.setFee(tooHigh);
    }

    // --- fuzz ---

    function testFuzz_directRelease(uint256 amount) public {
        amount = bound(amount, 1, 1_000_000e6);
        vm.startPrank(payer);
        usdc.approve(address(escrow), amount);
        uint256 id = escrow.open(provider, address(usdc), amount, reqHash, deliverBy, REVIEW);
        vm.stopPrank();

        vm.prank(provider);
        escrow.deliver(id, resultHash);
        vm.prank(payer);
        escrow.release(id);
        assertEq(usdc.balanceOf(provider), amount);
    }

    function testFuzz_disputeConservesFunds(uint256 amount, uint16 payerBps) public {
        amount = bound(amount, 1, 1_000_000e6);
        payerBps = uint16(bound(payerBps, 0, 10_000));

        vm.startPrank(payer);
        usdc.approve(address(escrow), amount);
        uint256 id = escrow.open(provider, address(usdc), amount, reqHash, deliverBy, REVIEW);
        vm.stopPrank();

        vm.prank(provider);
        escrow.deliver(id, resultHash);
        vm.prank(payer);
        escrow.dispute(id);
        arbiter.rule(id, payerBps, "fuzz");

        // every unit accounted for, nothing trapped (fee is 0 in this fixture)
        assertEq(usdc.balanceOf(address(escrow)), 0, "no dust trapped");
        assertEq(usdc.balanceOf(payer) - (1_000_000e6 - amount) + usdc.balanceOf(provider), amount);
    }
}
