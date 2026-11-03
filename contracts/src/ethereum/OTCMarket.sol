// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IKycRegistry} from "../interfaces/IKycRegistry.sol";

/// @title OTCMarket
/// @notice Anyone lists token X for token Y at a fixed price. X is escrowed, fills are atomic and partial.
/// No fee, no admin, no token allow-list: a broken token can only affect listings that use it.
contract OTCMarket is ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    enum Status {
        Open,
        Filled,
        Cancelled,
        Expired
    }

    struct Listing {
        address maker;
        IERC20 tokenX;
        IERC20 tokenY;
        uint256 totalX;
        uint256 totalY;
        uint256 filledX;
        uint256 minFillX;
        uint64 expiry;
        Status status;
        address privateTaker;
        IKycRegistry registry;
    }

    Listing[] internal _listings;
    mapping(address maker => uint256[]) internal _byMaker;

    event ListingCreated(
        uint256 indexed id,
        address indexed maker,
        address tokenX,
        address tokenY,
        uint256 totalX,
        uint256 totalY,
        uint64 expiry,
        address privateTaker,
        address registry
    );
    event Filled(uint256 indexed id, address indexed taker, uint256 amountX, uint256 amountY);
    event Cancelled(uint256 indexed id, uint256 returnedX);
    event Expired(uint256 indexed id, uint256 returnedX);

    error InvalidListing();
    error NotOpen();
    error ListingExpired();
    error NotExpired();
    error NotMaker();
    error TakerNotAllowed();
    error BadFillAmount();
    error SlippageExceeded(uint256 amountY, uint256 maxY);

    /// @notice Escrows `amountX` of `tokenX`. The listing records what actually arrived.
    function createListing(
        IERC20 tokenX,
        uint256 amountX,
        IERC20 tokenY,
        uint256 totalY,
        uint256 minFillX,
        uint64 expiry,
        address privateTaker,
        IKycRegistry registry
    ) external nonReentrant returns (uint256 id) {
        if (address(tokenX) == address(tokenY) || amountX == 0 || totalY == 0) revert InvalidListing();
        if (expiry != 0 && expiry <= block.timestamp) revert InvalidListing();

        uint256 before = tokenX.balanceOf(address(this));
        tokenX.safeTransferFrom(msg.sender, address(this), amountX);
        uint256 received = tokenX.balanceOf(address(this)) - before;
        if (received == 0 || minFillX > received) revert InvalidListing();

        id = _listings.length;
        _listings.push(
            Listing({
                maker: msg.sender,
                tokenX: tokenX,
                tokenY: tokenY,
                totalX: received,
                totalY: totalY,
                filledX: 0,
                minFillX: minFillX,
                expiry: expiry,
                status: Status.Open,
                privateTaker: privateTaker,
                registry: registry
            })
        );
        _byMaker[msg.sender].push(id);
        emit ListingCreated(id, msg.sender, address(tokenX), address(tokenY), received, totalY, expiry, privateTaker, address(registry));
    }

    /// @notice Buys `amountX` of the listing. Pays `ceil(amountX * totalY / totalX)` of Y straight to the maker.
    function fill(uint256 id, uint256 amountX, uint256 maxY) external nonReentrant returns (uint256 amountY) {
        Listing storage l = _listings[id];
        if (l.status != Status.Open) revert NotOpen();
        if (l.expiry != 0 && block.timestamp >= l.expiry) revert ListingExpired();
        if (l.privateTaker != address(0) && msg.sender != l.privateTaker) revert TakerNotAllowed();
        if (address(l.registry) != address(0) && !l.registry.isAllowed(msg.sender)) revert TakerNotAllowed();

        uint256 remaining = l.totalX - l.filledX;
        // The last piece of a listing may be smaller than minFillX.
        if (amountX == 0 || amountX > remaining || (amountX < l.minFillX && amountX != remaining)) {
            revert BadFillAmount();
        }
        amountY = Math.mulDiv(amountX, l.totalY, l.totalX, Math.Rounding.Ceil);
        if (amountY > maxY) revert SlippageExceeded(amountY, maxY);

        l.filledX += amountX;
        if (l.filledX == l.totalX) l.status = Status.Filled;

        l.tokenY.safeTransferFrom(msg.sender, l.maker, amountY);
        l.tokenX.safeTransfer(msg.sender, amountX);
        emit Filled(id, msg.sender, amountX, amountY);
    }

    function cancel(uint256 id) external nonReentrant {
        Listing storage l = _listings[id];
        if (msg.sender != l.maker) revert NotMaker();
        if (l.status != Status.Open) revert NotOpen();
        l.status = Status.Cancelled;
        uint256 rest = l.totalX - l.filledX;
        if (rest > 0) l.tokenX.safeTransfer(l.maker, rest);
        emit Cancelled(id, rest);
    }

    /// @notice Anyone can return an expired listing's unfilled X to its maker.
    function reclaimExpired(uint256 id) external nonReentrant {
        Listing storage l = _listings[id];
        if (l.status != Status.Open) revert NotOpen();
        if (l.expiry == 0 || block.timestamp < l.expiry) revert NotExpired();
        l.status = Status.Expired;
        uint256 rest = l.totalX - l.filledX;
        if (rest > 0) l.tokenX.safeTransfer(l.maker, rest);
        emit Expired(id, rest);
    }

    function listing(uint256 id) external view returns (Listing memory) {
        return _listings[id];
    }

    function listingCount() external view returns (uint256) {
        return _listings.length;
    }

    function quote(uint256 id, uint256 amountX) external view returns (uint256) {
        Listing storage l = _listings[id];
        return Math.mulDiv(amountX, l.totalY, l.totalX, Math.Rounding.Ceil);
    }

    function listingsByMaker(address maker) external view returns (uint256[] memory) {
        return _byMaker[maker];
    }
}
