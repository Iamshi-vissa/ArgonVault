// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ArgonVault timestamps
/// @notice Records when the SHA-256 fingerprint of a locked file was first seen.
/// @dev Only the 32-byte hash of the *locked* (encrypted) file is stored, so the chain learns nothing
///      about the contents, the name or the password. A stamp proves the locked file existed no later
///      than the block that recorded it. It does not prove who made the file: anyone who has the locked
///      file (or sees its hash) can stamp it, and the earliest stamp is the one that counts.
contract ArgonVaultTimestamps {
    struct Stamp {
        uint64 time; // block timestamp, seconds since 1970
        uint64 blockNumber;
        address by;
    }

    mapping(bytes32 => Stamp) private stamps;

    event Stamped(bytes32 indexed fileHash, address indexed by, uint64 time, uint64 blockNumber);

    error AlreadyStamped(bytes32 fileHash, uint64 time, uint64 blockNumber);
    error EmptyHash();

    /// @notice Record `fileHash` now. Reverts if it was already recorded, so the first time stands.
    function stamp(bytes32 fileHash) external {
        if (fileHash == bytes32(0)) revert EmptyHash();
        Stamp memory existing = stamps[fileHash];
        if (existing.by != address(0)) revert AlreadyStamped(fileHash, existing.time, existing.blockNumber);
        Stamp memory s = Stamp(uint64(block.timestamp), uint64(block.number), msg.sender);
        stamps[fileHash] = s;
        emit Stamped(fileHash, msg.sender, s.time, s.blockNumber);
    }

    /// @notice When `fileHash` was first recorded. All zero (including `by`) if never.
    function stampOf(bytes32 fileHash) external view returns (uint64 time, uint64 blockNumber, address by) {
        Stamp memory s = stamps[fileHash];
        return (s.time, s.blockNumber, s.by);
    }
}
