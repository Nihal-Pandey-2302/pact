// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPactReputation} from "./interfaces/IPactReputation.sol";
import {IERC3009} from "./interfaces/IERC3009.sol";

/// @title PactEscrow
/// @notice Conditional settlement for the x402 `escrow` payment scheme.
///         A payer locks funds against a specific request; the provider delivers
///         a result hash; funds release on the payer's ack (or after a review
///         window), refund if the provider no-shows, or split via the arbiter on
///         dispute. Every terminal state writes reputation.
///
///         This is the piece x402's `exact` scheme is missing: `exact` is a push
///         payment, irreversible once executed — the payer pays first and prays.
///         `escrow` makes the payment conditional on delivery.
contract PactEscrow is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    enum State {
        None,
        Open,
        Delivered,
        Released,
        Refunded,
        Disputed,
        Resolved
    }

    struct Deal {
        address payer;
        address provider;
        address token;
        uint256 amount;
        bytes32 requestHash; // binds the deal to a specific x402 request
        bytes32 resultHash; // provider's proof of delivery
        uint64 deliverBy; // provider must deliver before this
        uint64 reviewUntil; // payer may dispute until this (set on delivery)
        uint64 resolveBy; // arbiter must rule before this (set on dispute)
        uint32 reviewWindow; // seconds the payer gets to review a delivery
        State state;
    }

    uint16 public constant MAX_FEE_BPS = 250; // 2.5% ceiling

    IPactReputation public immutable reputation;

    address public arbiter;
    address public feeRecipient;
    uint16 public feeBps; // protocol fee, taken from the provider's payout
    uint32 public arbiterWindow = 3 days;

    uint256 public lastDealId;
    mapping(uint256 => Deal) private _deals;

    event DealOpened(
        uint256 indexed id,
        address indexed payer,
        address indexed provider,
        address token,
        uint256 amount,
        bytes32 requestHash,
        uint64 deliverBy,
        uint32 reviewWindow
    );
    event Delivered(uint256 indexed id, bytes32 resultHash, uint64 reviewUntil);
    event Released(uint256 indexed id, address indexed provider, uint256 net, uint256 fee);
    event Refunded(uint256 indexed id, address indexed payer, uint256 amount);
    event Disputed(uint256 indexed id, uint64 resolveBy);
    event Resolved(uint256 indexed id, uint16 payerBps, uint256 toPayer, uint256 toProvider, uint256 fee);
    event ReputationCallFailed(uint256 indexed id);

    error BadParams();
    error NotProvider();
    error NotPayer();
    error NotArbiter();
    error WrongState();
    error DeadlinePassed();
    error TooEarly();

    constructor(address owner_, address reputation_, address feeRecipient_, uint16 feeBps_) Ownable(owner_) {
        if (reputation_ == address(0) || feeRecipient_ == address(0)) revert BadParams();
        if (feeBps_ > MAX_FEE_BPS) revert BadParams();
        reputation = IPactReputation(reputation_);
        feeRecipient = feeRecipient_;
        feeBps = feeBps_;
        arbiter = owner_; // replaced with the PactArbiter after deployment
    }

    // --- admin ---

    function setArbiter(address a) external onlyOwner {
        if (a == address(0)) revert BadParams();
        arbiter = a;
    }

    function setFee(uint16 bps) external onlyOwner {
        if (bps > MAX_FEE_BPS) revert BadParams();
        feeBps = bps;
    }

    function setFeeRecipient(address r) external onlyOwner {
        if (r == address(0)) revert BadParams();
        feeRecipient = r;
    }

    function setArbiterWindow(uint32 w) external onlyOwner {
        arbiterWindow = w;
    }

    // --- opening a deal ---

    /// @notice Open and fund a deal directly (payer must have approved `amount`).
    function open(
        address provider,
        address token,
        uint256 amount,
        bytes32 requestHash,
        uint64 deliverBy,
        uint32 reviewWindow
    ) external nonReentrant returns (uint256 id) {
        id = _open(msg.sender, provider, token, amount, requestHash, deliverBy, reviewWindow);
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Open and fund a deal from the payer's EIP-3009 signature, relayed
    ///         by anyone (the facilitator). The signed nonce is bound to the exact
    ///         deal parameters, so a relayer cannot redirect the pulled funds.
    function openWithAuthorization(
        address provider,
        address token,
        uint256 amount,
        bytes32 requestHash,
        uint64 deliverBy,
        uint32 reviewWindow,
        address payer,
        uint256 validAfter,
        uint256 validBefore,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant returns (uint256 id) {
        bytes32 nonce = authNonce(payer, provider, token, amount, requestHash, deliverBy, reviewWindow);
        // Pulls exactly `amount` from payer into this contract; reverts unless the
        // signature, recipient (this contract), and bound nonce all match.
        IERC3009(token).receiveWithAuthorization(
            payer, address(this), amount, validAfter, validBefore, nonce, v, r, s
        );
        id = _open(payer, provider, token, amount, requestHash, deliverBy, reviewWindow);
    }

    function _open(
        address payer,
        address provider,
        address token,
        uint256 amount,
        bytes32 requestHash,
        uint64 deliverBy,
        uint32 reviewWindow
    ) internal returns (uint256 id) {
        if (provider == address(0) || provider == payer || amount == 0) revert BadParams();
        if (deliverBy <= block.timestamp) revert BadParams();
        id = ++lastDealId;
        _deals[id] = Deal({
            payer: payer,
            provider: provider,
            token: token,
            amount: amount,
            requestHash: requestHash,
            resultHash: bytes32(0),
            deliverBy: deliverBy,
            reviewUntil: 0,
            resolveBy: 0,
            reviewWindow: reviewWindow,
            state: State.Open
        });
        emit DealOpened(id, payer, provider, token, amount, requestHash, deliverBy, reviewWindow);
    }

    // --- lifecycle ---

    function deliver(uint256 id, bytes32 resultHash) external {
        Deal storage d = _deals[id];
        if (d.state != State.Open) revert WrongState();
        if (msg.sender != d.provider) revert NotProvider();
        if (block.timestamp > d.deliverBy) revert DeadlinePassed();
        d.resultHash = resultHash;
        d.reviewUntil = uint64(block.timestamp) + d.reviewWindow;
        d.state = State.Delivered;
        emit Delivered(id, resultHash, d.reviewUntil);
    }

    /// @notice Release funds to the provider. Callable by the payer any time after
    ///         delivery, or by anyone once the review window has elapsed.
    function release(uint256 id) external nonReentrant {
        Deal storage d = _deals[id];
        if (d.state != State.Delivered) revert WrongState();
        if (msg.sender != d.payer && block.timestamp < d.reviewUntil) revert TooEarly();
        d.state = State.Released;
        (uint256 net, uint256 fee) = _payout(d.token, d.provider, d.amount);
        _recordReleased(id, d.provider, d.payer, d.amount);
        emit Released(id, d.provider, net, fee);
    }

    /// @notice Refund the payer if the provider failed to deliver in time.
    ///         Permissionless — funds always return to the payer.
    function refundExpired(uint256 id) external nonReentrant {
        Deal storage d = _deals[id];
        if (d.state != State.Open) revert WrongState();
        if (block.timestamp <= d.deliverBy) revert TooEarly();
        d.state = State.Refunded;
        IERC20(d.token).safeTransfer(d.payer, d.amount);
        _recordRefunded(id, d.provider, d.payer, d.amount);
        emit Refunded(id, d.payer, d.amount);
    }

    /// @notice Payer disputes a delivery during the review window.
    function dispute(uint256 id) external {
        Deal storage d = _deals[id];
        if (d.state != State.Delivered) revert WrongState();
        if (msg.sender != d.payer) revert NotPayer();
        if (block.timestamp >= d.reviewUntil) revert TooEarly(); // window already closed
        d.state = State.Disputed;
        d.resolveBy = uint64(block.timestamp) + arbiterWindow;
        emit Disputed(id, d.resolveBy);
    }

    /// @notice Arbiter splits a disputed deal: `payerBps` to payer, rest to provider.
    function resolve(uint256 id, uint16 payerBps) external nonReentrant {
        if (msg.sender != arbiter) revert NotArbiter();
        _resolve(id, payerBps);
    }

    /// @notice Fallback if the arbiter never rules: split 50/50 so funds can never
    ///         be locked permanently by an absent arbiter.
    function resolveTimeout(uint256 id) external nonReentrant {
        Deal storage d = _deals[id];
        if (d.state != State.Disputed) revert WrongState();
        if (block.timestamp <= d.resolveBy) revert TooEarly();
        _resolve(id, 5_000);
    }

    function _resolve(uint256 id, uint16 payerBps) internal {
        Deal storage d = _deals[id];
        if (d.state != State.Disputed) revert WrongState();
        if (payerBps > 10_000) revert BadParams();
        d.state = State.Resolved;
        uint256 toPayer = (d.amount * payerBps) / 10_000;
        uint256 providerGross = d.amount - toPayer;
        uint256 toProvider;
        uint256 fee;
        if (toPayer > 0) IERC20(d.token).safeTransfer(d.payer, toPayer);
        if (providerGross > 0) (toProvider, fee) = _payout(d.token, d.provider, providerGross);
        _recordResolved(id, d.provider, d.payer, d.amount, payerBps);
        emit Resolved(id, payerBps, toPayer, toProvider, fee);
    }

    function _payout(address token, address provider, uint256 gross)
        internal
        returns (uint256 net, uint256 fee)
    {
        fee = (gross * feeBps) / 10_000;
        net = gross - fee;
        if (fee > 0) IERC20(token).safeTransfer(feeRecipient, fee);
        if (net > 0) IERC20(token).safeTransfer(provider, net);
    }

    // Reputation is best-effort: a reverting reputation hook must never be able to
    // freeze a settlement and trap user funds.
    function _recordReleased(uint256 id, address provider, address payer, uint256 amount) internal {
        try reputation.recordReleased(provider, payer, amount) {}
        catch {
            emit ReputationCallFailed(id);
        }
    }

    function _recordRefunded(uint256 id, address provider, address payer, uint256 amount) internal {
        try reputation.recordRefunded(provider, payer, amount) {}
        catch {
            emit ReputationCallFailed(id);
        }
    }

    function _recordResolved(uint256 id, address provider, address payer, uint256 amount, uint16 payerBps)
        internal
    {
        try reputation.recordResolved(provider, payer, amount, payerBps) {}
        catch {
            emit ReputationCallFailed(id);
        }
    }

    // --- views ---

    function getDeal(uint256 id) external view returns (Deal memory) {
        return _deals[id];
    }

    /// @notice The EIP-3009 nonce a payer signs to fund a deal gaslessly. Binding
    ///         the nonce to the parameters makes the authorization usable for this
    ///         exact deal and nothing else.
    function authNonce(
        address payer,
        address provider,
        address token,
        uint256 amount,
        bytes32 requestHash,
        uint64 deliverBy,
        uint32 reviewWindow
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                block.chainid,
                address(this),
                payer,
                provider,
                token,
                amount,
                requestHash,
                deliverBy,
                reviewWindow
            )
        );
    }
}
